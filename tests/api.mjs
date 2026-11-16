#!/usr/bin/env node
// tests/api.mjs — the backend's gate: real SQLite, real SQL, real handler, fake Safaricom.
//
// Why it executes the migration instead of describing it: every failure this project has had lived in
// arithmetic or in a string that looked right — a light rig that read `isOpen(13)` as milliseconds, a
// price quoted from memory, a plus-code whose rounding was off by a grid. A mocked database cannot catch
// a wrong column name, a foreign key that points at the wrong thing, or a `key` column that SQLite turns
// out to reserve. So this file runs `backend/migrations/20261116_0001_init.sql` and the build's own
// `backend/seed.sql` through `node:sqlite`, behind an adapter that models only the D1 methods the server
// uses (`prepare().bind().all() / .first()`, `batch()`), and then calls the Worker's `fetch` export the
// way Cloudflare would.
//
// What the adapter does NOT prove: that a D1 binding exists, that D1's defaults match SQLite's, or that
// wrangler applies the migration. That is what the post-deploy probe is for (`/health` then a POST then a
// GET), and it is a different kind of evidence.
//
// Payments are exercised against a `fetchImpl` we supply: the STK-push request builder, the audit writes
// and all four callback checks run for real, against a Daraja that is a function in this file. No
// credential is anywhere near it.
//
// Dependency-free like tests/run.mjs: `node tests/api.mjs`, exit 0 or exit 1.

import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const lib = (p) => import(pathToFileURL(join(ROOT, p)).href);

/* ------------------------------------------------- node:sqlite, and Node 22 */

// Node 22 has SQLite but hides it behind a flag; Node 24 does not need one. Rather than assume which CI
// image runs this file, try the honest import first and, once only, re-exec this same file with the flag.
// If neither works the file says so loudly instead of reporting a green run that tested nothing.

let DatabaseSync = null;
let sqliteError = null;
try {
  // A bare specifier, not `lib()`: that helper resolves against the repository root, and `node:sqlite` is
  // a builtin. Resolving it as a path would fail on every Node and then re-exec forever.
  ({ DatabaseSync } = await import("node:sqlite"));
} catch (error) {
  sqliteError = error;
}

if (!DatabaseSync) {
  if (!process.env.HH_SQLITE_REEXEC) {
    const self = fileURLToPath(import.meta.url);
    const child = spawnSync(process.execPath, ["--no-warnings", "--experimental-sqlite", self, ...process.argv.slice(2)], {
      stdio: "inherit",
      env: { ...process.env, HH_SQLITE_REEXEC: "1" },
    });
    process.exit(child.status ?? 1);
  }
  console.log(`SKIP api tests: node:sqlite is unavailable here (${sqliteError?.message ?? "no DatabaseSync"})`);
  console.log("::warning:: backend tests skipped — node:sqlite unavailable on this runner");
  process.exit(0);
}

const api = await lib("backend/src/index.mjs");
const store = await lib("backend/src/store.mjs");
const validate = await lib("backend/src/validate.mjs");
const mpesa = await lib("backend/src/mpesa.mjs");
const hours = await lib("site/src/lib/hours.mjs");

const MIGRATION_PATH = join(ROOT, "backend/migrations/20261116_0001_init.sql");
const catalog = JSON.parse(await readFile(join(ROOT, "backend/catalog.json"), "utf8"));
const siteMenu = JSON.parse(await readFile(join(ROOT, "site/src/data/menu.json"), "utf8"));
const migrationSql = await readFile(MIGRATION_PATH, "utf8");
const seedSql = await readFile(join(ROOT, "backend/seed.sql"), "utf8");

const SITE_ITEMS = new Map(
  siteMenu.families.flatMap((f) => f.sections.flatMap((s) => s.items)).map((i) => [i.id, i]),
);

/* ------------------------------------------------------- the D1-shaped half */

const READ_FIRST = /^\s*(select|with|pragma)\b/i;

const toParams = (args) =>
  args.map((value, i) => {
    if (value === undefined) return null;
    if (typeof value === "boolean") return value ? 1 : 0;
    if (typeof value === "number" && !Number.isInteger(value))
      throw new Error(`bound a fractional number at parameter ${i + 1}: ${value}`);
    return value;
  });

/** Models D1PreparedStatement: nothing executes until all()/first()/run(), or until batch() reaches it. */
class Statement {
  constructor(conn, sql, args = []) {
    this.conn = conn;
    this.sql = sql;
    this.args = args;
  }

  bind(...args) {
    return new Statement(this.conn, this.sql, args);
  }

  async all() {
    return { results: this._all(), meta: { changes: 0 } };
  }

  async first() {
    return this._get();
  }

  async run() {
    return { meta: this._run() };
  }

  _all() {
    return this.conn.prepare(this.sql).all(...toParams(this.args));
  }

  _get() {
    return this.conn.prepare(this.sql).get(...toParams(this.args)) ?? null;
  }

  _run() {
    return this.conn.prepare(this.sql).run(...toParams(this.args));
  }
}

/**
 * The D1 surface the server actually touches. `batch()` is a transaction here and on D1, which is the one
 * behaviour the whole "no half a record" argument rests on — so the adapter has to implement it rather
 * than let each statement autocommit and have the test pass for the wrong reason.
 */
class D1 {
  constructor(conn) {
    this.conn = conn;
  }

  prepare(sql) {
    return new Statement(this.conn, sql);
  }

  exec(text) {
    this.conn.exec(text);
  }

  async batch(statements) {
    this.conn.exec("BEGIN");
    const out = [];
    try {
      for (const statement of statements) {
        if (!(statement instanceof Statement)) throw new Error("batch() only takes prepared statements");
        if (READ_FIRST.test(statement.sql)) out.push({ results: statement._all(), meta: {} });
        else {
          const info = statement._run();
          out.push({ results: [], meta: { changes: info.changes, last_row_id: Number(info.lastInsertRowid) } });
        }
      }
      this.conn.exec("COMMIT");
    } catch (error) {
      try {
        this.conn.exec("ROLLBACK");
      } catch {
        /* the rollback failing is not the failure under test */
      }
      throw error;
    }
    return out;
  }
}

function freshDb({ seed = true } = {}) {
  const conn = new DatabaseSync(":memory:");
  // D1 runs with foreign keys on; :memory: SQLite runs with them off unless asked. Without this line the
  // orphan-bill test below would pass on a behaviour the production database does not have.
  conn.exec("PRAGMA foreign_keys = ON");
  const db = new D1(conn);
  db.exec(migrationSql);
  if (seed) db.exec(seedSql);
  return { db, conn, sql: (text, ...args) => conn.prepare(text).all(...args) };
}

/* ------------------------------------------------------------------ harness */

let passed = 0;
const failures = [];
let group = "";

function describe(name) {
  group = name;
  console.log(`\n${name}`);
}

async function check(what, fn) {
  try {
    const result = await fn();
    if (result !== true && result !== undefined) {
      throw new Error(typeof result === "string" ? result : `got ${JSON.stringify(result)}`);
    }
    passed += 1;
    console.log(`  ok   ${what}`);
  } catch (err) {
    failures.push({ group, what, message: err.message });
    console.log(`  FAIL ${what}\n       ${err.message}`);
  }
}

const eq = (actual, expected, label) =>
  actual === expected || `${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`;

const SOURCE = "https://habibihavenpreview.pages.dev/table?t=4|chips-plainx2";
const ORIGIN = "https://habibihavenpreview.pages.dev";

// The handler reads a per-isolate IP bucket and a per-phone window out of real time and real headers, so
// every case gets its own address and its own number. A test that inherits another test's bucket is a test
// that fails for reasons that have nothing to do with the code.
let phoneSeed = 5000;
const nextPhone = () => `071234${phoneSeed++}`;
let ipSeed = 1;
const nextIp = () => `203.0.113.${ipSeed++}`;

/** The exact first dish the kitchen lists, and what the server is allowed to charge for it. */
const [FIRST_ITEM, SECOND_ITEM] = catalog.items;
const SOLD_OUT_ITEM = catalog.items.find((i) => i.available === false) ?? null;

function envelope(overrides = {}) {
  return {
    DARAJA_CONSUMER_KEY: "fake-key",
    DARAJA_CONSUMER_SECRET: "fake-secret",
    DARAJA_SHORT_CODE: "174379",
    DARAJA_PASSKEY: "fake-passkey",
    DARAJA_CALLBACK_TOKEN: "fake-callback-token",
    PUBLIC_BASE_URL: "https://api.example.workers.dev",
    ...overrides,
  };
}

async function post(db, body, { ip = nextIp(), origin = ORIGIN, path = "/v1/requests" } = {}) {
  const request = new Request(`https://habibi-api.test${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", origin, "cf-connecting-ip": ip },
    body: JSON.stringify(body),
  });
  const response = await api.default.fetch(request, { DB: db }, {});
  return { status: response.status, body: await response.json().catch(() => null), headers: response.headers };
}

async function get(db, path, { origin = ORIGIN, ip = nextIp() } = {}) {
  const request = new Request(`https://habibi-api.test${path}`, {
    method: "GET",
    headers: { origin, "cf-connecting-ip": ip },
  });
  const response = await api.default.fetch(request, { DB: db }, {});
  return { status: response.status, body: await response.json().catch(() => null), headers: response.headers };
}

/**
 * Writes a record straight through the store, bypassing the handler so a test cannot trip a rate limit.
 * `reference` is overridable because one test has to put a chosen reference through the URL router;
 * everything else leaves it to the generator.
 */
async function record(db, payload, { now = new Date(), reference = null } = {}) {
  const read = await store.readCatalog(db);
  const parsed = validate.parseRequest(payload, { items: read.items, hours: read.hours, now });
  if (!parsed.ok) throw new Error(`fixture payload rejected: ${JSON.stringify(parsed.errors)}`);
  const chosen = reference ?? store.makeReference();
  const written = await store.insertRequest(db, parsed.value, { reference: chosen, createdAt: now.toISOString() });
  if (!written) throw new Error(`fixture insert returned null for ${chosen}`);
  return { reference: chosen, value: parsed.value };
}

const nairobiDateOffset = (days) => {
  const shifted = new Date(Date.now() + 180 * 60_000 + days * 86_400_000);
  const pad = (n) => String(n).padStart(2, "0");
  return `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}`;
};

/* ------------------------------------------------- the money on the shelves */

describe("catalog: the migration and the build's seed");

const seeded = freshDb();

await check("the migration and seed.sql execute as written, against real SQLite", () => {
  const rows = seeded.sql("SELECT COUNT(*) AS n FROM prices")[0].n;
  return eq(rows, catalog.items.length, "prices rows");
});

await check("nothing was dropped for a quote or a parenthesis", () => {
  const missing = catalog.items.filter((i) => !seeded.sql("SELECT 1 FROM prices WHERE item_id = ?", i.id).length);
  return missing.length === 0 || `${missing.length} items absent, first: ${missing[0].id}`;
});

await check("the server's prices are the site's prices, row for row", () => {
  const rows = seeded.sql("SELECT item_id, name, unit_kes, available FROM prices");
  for (const row of rows) {
    const site = SITE_ITEMS.get(row.item_id);
    if (!site) return `${row.item_id} is in the seed but not in site/src/data/menu.json`;
    if (site.price !== row.unit_kes) return `${row.item_id}: site ${site.price}, server ${row.unit_kes}`;
    const siteAvailable = Boolean(site.availability.open && site.availability.inStock);
    if (siteAvailable !== (row.available === 1)) return `${row.item_id}: site says ${siteAvailable}, server says ${row.available === 1}`;
  }
  return true;
});

await check("`key` and `value` work as column names in this SQLite", () => {
  const row = seeded.sql("SELECT key, value FROM settings WHERE key = 'hoursOfRecord'")[0];
  if (!row) return "settings has no hoursOfRecord row";
  return eq(row.value, JSON.stringify(catalog.hoursOfRecord), "hoursOfRecord literal");
});

await check("the CHECK constraints are the ones the schema claims", () => {
  const rejects = (sql, label) => {
    try {
      seeded.conn.prepare(sql).run();
    } catch {
      return true;
    }
    return `${label} was accepted`;
  };
  const base =
    "INSERT INTO requests (reference, kind, party_size, contact_name, contact_phone, subtotal_kes, line_count, item_count, created_at) VALUES ";
  return (
    rejects(`${base} ('HH-AAAAAA','table',0,'A B','254700000000',0,0,0,'now')`, "party_size 0") &&
    rejects(`${base} ('HH-AAAAAB','booking',2,'A B','254700000000',0,0,0,'now')`, "kind 'booking'") &&
    rejects(`${base} ('HH-AAAAAC','table',2,'A B','254700000000',-1,0,0,'now')`, "a negative subtotal")
  );
});

await check("a bill cannot exist without the request it belongs to", () => {
  try {
    seeded.conn
      .prepare("INSERT INTO request_lines (request_reference, item_id, item_name, unit_kes, qty, amount_kes) VALUES (?,?,?,?,?,?)")
      .run("HH-NOPE11", FIRST_ITEM.id, FIRST_ITEM.name, FIRST_ITEM.priceKes, 1, FIRST_ITEM.priceKes);
  } catch {
    return true;
  }
  return "an orphan bill line was inserted — foreign keys are not on";
});

await check("the reference really is unique", () => {
  const insert = (ref) =>
    seeded.conn
      .prepare("INSERT INTO requests (reference, kind, contact_name, contact_phone, subtotal_kes, line_count, item_count, created_at) VALUES (?,?,?,?,?,?,?,?)")
      .run(ref, "table", "A B", "254700000000", 0, 0, 0, "now");
  insert("HH-UNIQUE");
  try {
    insert("HH-UNIQUE");
  } catch (error) {
    return /UNIQUE constraint failed: requests\.reference/i.test(String(error?.message)) ||
      `wrong message: ${error?.message}`;
  }
  return "the duplicate reference went in";
});

await check("a re-seed updates prices in place and deletes nothing current", () => {
  // Its own database: reseeding mutates `prices`, and a shared fixture would make every later test depend
  // on this one having run first.
  const reseed = freshDb();
  const before = reseed.sql("SELECT COUNT(*) AS n FROM prices")[0].n;
  reseed.conn.prepare("UPDATE prices SET unit_kes = 1 WHERE item_id = ?").run(FIRST_ITEM.id);
  reseed.db.exec(seedSql); // the same file, run again — the UPSERT has to restore it
  return (
    eq(reseed.sql("SELECT unit_kes AS p FROM prices WHERE item_id = ?", FIRST_ITEM.id)[0].p, FIRST_ITEM.priceKes, "price after re-seed") &&
    eq(reseed.sql("SELECT COUNT(*) AS n FROM prices")[0].n, before, "row count after re-seed")
  );
});

await check("a re-seed deletes the dish the kitchen stopped selling", () => {
  const reseed = freshDb();
  reseed.conn
    .prepare("INSERT INTO prices (item_id, name, unit_kes, available, updated_at) VALUES (?,?,?,?,?)")
    .run("gone-from-the-menu", "Old Dish", 500, 1, "2020-01-01T00:00:00.000Z");
  reseed.db.exec(seedSql);
  return eq(reseed.sql("SELECT COUNT(*) AS n FROM prices WHERE item_id = 'gone-from-the-menu'")[0].n, 0, "the stale row");
});

/* -------------------------------------------------------------- reading it */

describe("catalog: what the server will quote from");

await check("readCatalog returns the whole price list and the hours of record", async () => {
  const c = await store.readCatalog(seeded.db);
  return (
    eq(c.items.size, catalog.items.length, "items") &&
    eq(c.hours.open, hours.OPEN_LABEL, "open") &&
    eq(c.hours.close, hours.CLOSE_LABEL, "close") &&
    eq(c.hours.openMinutes, 6 * 60 + 30, "openMinutes") &&
    eq(c.dataStamp, catalog.dataStamp, "dataStamp")
  );
});

await check("readCatalog names one dish exactly as the build wrote it", async () => {
  const c = await store.readCatalog(seeded.db);
  const item = c.items.get(FIRST_ITEM.id);
  return eq(`${item.name} ${item.price}`, `${FIRST_ITEM.name} ${FIRST_ITEM.priceKes}`, "the first priced row");
});

await check("an unseeded database refuses to quote rather than quoting zero", async () => {
  const empty = freshDb({ seed: false });
  try {
    await store.readCatalog(empty.db);
  } catch (error) {
    return error instanceof store.CatalogProblem || `wrong error type: ${error?.name}`;
  }
  return "readCatalog accepted an empty price list";
});

await check("hours that do not make sense stop the catalog, not the guest", async () => {
  const bad = freshDb();
  bad.conn.prepare("UPDATE settings SET value = ? WHERE key = 'hoursOfRecord'").run('{"open":"23:00","close":"06:30"}');
  try {
    await store.readCatalog(bad.db);
  } catch (error) {
    return /hoursOfRecord/.test(error.message) || `wrong message: ${error.message}`;
  }
  return "a backwards opening window was accepted";
});

await check("a price we cannot trust is left out of the catalog", async () => {
  const broken = freshDb();
  broken.conn.prepare("UPDATE prices SET unit_kes = 999.5 WHERE item_id = ?").run(FIRST_ITEM.id);
  const c = await store.readCatalog(broken.db);
  return (
    eq(c.items.has(FIRST_ITEM.id), false, "the half-shilling item is quoted") &&
    eq(c.items.size, catalog.items.length - 1, "remaining items")
  );
});

/* ------------------------------------------------------------ the two clocks */

describe("validation: the arithmetic, tested against the site's own copy");

await check("the server and the site agree about open/closed for all 1440 minutes", () => {
  const serverHours = { openMinutes: 6 * 60 + 30, closeMinutes: 23 * 60 };
  for (let m = 0; m < 1440; m += 1) {
    if (validate.isOpenAt(m, serverHours) !== hours.isOpenMinutes(m)) return `minute ${m} disagrees`;
  }
  return true;
});

await check("the window the server enforces is built from the labels the site publishes", async () => {
  const c = await store.readCatalog(seeded.db);
  return (
    eq(validate.minutesOfDay(c.hours.open), hours.OPEN_MINUTES, "open minutes") &&
    eq(validate.minutesOfDay(c.hours.close), hours.CLOSE_MINUTES, "close minutes")
  );
});

await check("03:30 is not a table and 06:30 exactly is", () => {
  const h = { openMinutes: 390, closeMinutes: 1380 };
  return (
    eq(validate.isOpenAt(210, h), false, "03:30") &&
    eq(validate.isOpenAt(390, h), true, "06:30") &&
    eq(validate.isOpenAt(1380, h), false, "23:00, half-open") &&
    eq(validate.isOpenAt(1379, h), true, "22:59")
  );
});

await check("a Kenyan number becomes the 254 form the venue needs", () => {
  const errors = [];
  const a = validate.normalizePhone("0712 345 678", { errors });
  const b = validate.normalizePhone("+254 712 345 678", { errors });
  const c = validate.normalizePhone("254712345678", { errors });
  return (
    eq(a, "254712345678", "local form") && eq(b, "254712345678", "plus form") && eq(c, "254712345678", "already 254")
  );
});

await check("a number this restaurant cannot call back is refused, with the shape in the message", () => {
  const errors = [];
  const out = validate.normalizePhone("555-0100", { errors });
  return (
    eq(out, null, "value") &&
    eq(errors[0]?.code, "bad_number", "code") &&
    (/0712 345 678/.test(errors[0].message) || "the message does not name the expected shape")
  );
});

await check("control characters and double spaces never reach the record", () => {
  const errors = [];
  const value = validate.cleanText("  Am\u0000ina\t\tWanjiru  ", { field: "contact.name", max: 80, min: 2, errors });
  return eq(value, "Am ina Wanjiru", "cleaned name") && eq(errors.length, 0, "errors");
});

await check("a date that never happened is an error, not a reservation in March", () => {
  const feb31 = validate.toNairobiInstant("2026-02-31", "19:00");
  const good = validate.toNairobiInstant("2026-12-20", "19:00");
  return (
    eq(feb31, null, "2026-02-31") &&
    eq(good?.iso, "2026-12-20T16:00:00.000Z", "2026-12-20 19:00 EAT as an instant") &&
    eq(good?.minutes, 1140, "minutes")
  );
});

await check("reprice bills the catalog, not the caller", () => {
  const items = new Map([[FIRST_ITEM.id, { ...FIRST_ITEM, price: FIRST_ITEM.priceKes, available: true }]]);
  const errors = [];
  const out = validate.reprice(items, [{ id: FIRST_ITEM.id, qty: 3 }], { errors });
  return (
    eq(out.subtotal, FIRST_ITEM.priceKes * 3, "server subtotal") &&
    eq(out.rows[0].unit, FIRST_ITEM.priceKes, "unit") &&
    eq(out.rows[0].amount, FIRST_ITEM.priceKes * 3, "line amount") &&
    eq(errors.length, 0, "errors")
  );
});

await check("the same dish twice is one line with the quantities added", () => {
  const items = new Map([[FIRST_ITEM.id, { ...FIRST_ITEM, price: FIRST_ITEM.priceKes, available: true }]]);
  const out = validate.reprice(items, [{ id: FIRST_ITEM.id, qty: 2 }, { id: FIRST_ITEM.id, qty: 3 }], { errors: [] });
  return eq(`${out.rows.length}/${out.subtotal}`, `1/${FIRST_ITEM.priceKes * 5}`, "merged line") &&
    eq(out.itemCount, 5, "item count");
});

await check("an accompaniment makes a separate line, and a fake id fails the whole request", () => {
  const items = new Map([
    [FIRST_ITEM.id, { ...FIRST_ITEM, price: FIRST_ITEM.priceKes, available: true }],
    [SECOND_ITEM.id, { ...SECOND_ITEM, price: SECOND_ITEM.priceKes, available: true }],
  ]);
  const errors = [];
  validate.reprice(items, [{ id: "dish-that-was-never-sold", qty: 1 }], { errors });
  const code = errors.find((e) => e.code === "unknown_items")?.code ?? "no unknown_items error";
  const options = validate.reprice(
    items,
    [{ id: FIRST_ITEM.id, option: "Chips", qty: 1 }, { id: FIRST_ITEM.id, option: "Rice", qty: 1 }],
    { errors: [] },
  );
  return eq(code, "unknown_items", "unknown id") && eq(options.rows.length, 2, "two sides of the same dish");
});

await check("a sold-out dish is kept and counted, not silently dropped", () => {
  if (!SOLD_OUT_ITEM) return "the kitchen is selling everything today — nothing to test";
  const items = new Map([[SOLD_OUT_ITEM.id, { ...SOLD_OUT_ITEM, price: SOLD_OUT_ITEM.priceKes, available: false }]]);
  const out = validate.reprice(items, [{ id: SOLD_OUT_ITEM.id, qty: 1 }], { errors: [] });
  return (
    eq(out.rows.length, 1, "kept the line") &&
    eq(out.unavailableCount, 1, "flagged it") &&
    eq(out.subtotal, SOLD_OUT_ITEM.priceKes, "still priced it")
  );
});

/* ------------------------------------------------------ the handler, for real */

describe("POST /v1/requests — a built table");

const live = freshDb();

await check("health says the catalog is seeded and payments are off", async () => {
  const { status, body } = await get(live.db, "/health");
  return (
    eq(status, 200, "status") &&
    eq(body.ok, true, "ok") &&
    eq(body.catalog.items, catalog.items.length, "catalog size") &&
    eq(body.payments.mode, "off", "payment mode") &&
    eq(body.payments.configured, false, "configured")
  );
});

let recorded = null;
await check("a legitimate table is recorded and priced by the server", async () => {
  const { status, body } = await post(live.db, {
    kind: "table",
    party: 4,
    contact: { name: "Amina Wanjiru", phone: nextPhone() },
    when: "Fri 19:00",
    notes: "Terrace if possible",
    lines: [{ id: FIRST_ITEM.id, qty: 2 }, { id: SECOND_ITEM.id, qty: 1 }],
    source: SOURCE,
  });
  recorded = body;
  return (
    eq(status, 201, "status") &&
    eq(body.totalKes, FIRST_ITEM.priceKes * 2 + SECOND_ITEM.priceKes, "server total") &&
    eq(body.lineCount, 2, "lines") &&
    eq(body.itemCount, 3, "plates") &&
    eq(body.currency, "KES", "currency") &&
    (new RegExp(`^HH-[${store.REFERENCE_ALPHABET}]{${store.REFERENCE_LENGTH}}$`).test(body.reference) ||
      `reference ${body.reference} is not the shape we hand out`)
  );
});

await check("the guest can read that record back, and it does not carry their name", async () => {
  const { status, body } = await get(live.db, `/v1/requests/${recorded.reference}`);
  return (
    eq(status, 200, "status") &&
    eq(body.totalKes, recorded.totalKes, "total") &&
    eq(body.lines.length, 2, "lines") &&
    eq(body.notes, "Terrace if possible", "notes") &&
    (JSON.stringify(body).includes("Amina") ? "the read-back leaked the guest's name" : true) &&
    (body.contact_name === undefined || "contact_name is in the response")
  );
});

await check("a lowercase reference still finds the record", async () => {
  const { status } = await get(live.db, `/v1/requests/${recorded.reference.toLowerCase()}`);
  return eq(status, 200, "status");
});

await check("the money the page claimed is stored as evidence of drift, not as the bill", async () => {
  const { status, body } = await post(live.db, {
    kind: "table",
    party: 2,
    contact: { name: "Peter Otieno", phone: nextPhone() },
    lines: [{ id: FIRST_ITEM.id, qty: 1 }],
    claimedSubtotal: 1,
  });
  return (
    eq(status, 201, "status") &&
    eq(body.totalKes, FIRST_ITEM.priceKes, "the server's number stands") &&
    eq(body.priceDrift.deltaKes, FIRST_ITEM.priceKes - 1, "drift reported") &&
    eq(body.priceDrift.claimedKes, 1, "the claim kept")
  );
});

await check("a hand-typed total that is not a number is refused outright", async () => {
  const { status, body } = await post(live.db, {
    kind: "table",
    contact: { name: "N. Ane", phone: nextPhone() },
    lines: [{ id: FIRST_ITEM.id, qty: 1 }],
    claimedSubtotal: "999999999999",
  });
  return eq(status, 422, "status") && body.errors.some((e) => e.code === "bad_claim") ? true : `errors: ${JSON.stringify(body.errors)}`;
});

await check("an id from a stale tab fails the request instead of quietly shortening the bill", async () => {
  const before = live.sql("SELECT COUNT(*) AS n FROM requests")[0].n;
  const { status, body } = await post(live.db, {
    kind: "table",
    contact: { name: "Grace Kim", phone: nextPhone() },
    lines: [{ id: FIRST_ITEM.id, qty: 1 }, { id: " removed-from-the-menu ", qty: 2 }],
  });
  const after = live.sql("SELECT COUNT(*) AS n FROM requests")[0].n;
  return (
    eq(status, 422, "status") &&
    eq(body.errors.some((e) => e.code === "unknown_items"), true, "unknown_items reported") &&
    eq(after, before, "nothing written")
  );
});

await check("an empty table is a validation error, not a KSh 0 record", async () => {
  const { status, body } = await post(live.db, {
    kind: "table",
    contact: { name: "Nobody Here", phone: nextPhone() },
    lines: [],
  });
  return eq(status, 422, "status") && body.errors.some((e) => e.field === "lines") ? true : `errors: ${JSON.stringify(body.errors)}`;
});

await check("no phone, no name, no party on a reservation — each named in its own field", async () => {
  const { body } = await post(live.db, { kind: "reservation", lines: [] });
  const fields = new Set(body.errors.map((e) => e.field));
  return (
    ["contact.phone", "contact.name", "party"].every((f) => fields.has(f)) || `missing fields in errors: ${[...fields]}`
  );
});

/* -------------------------------------------------------------- reservations */

describe("POST /v1/requests — a reservation, checked against the hours of record");

await check("a request for tomorrow at 19:00 is inside the day the listing shows", async () => {
  const { status, body } = await post(live.db, {
    kind: "reservation",
    party: 6,
    visitDate: nairobiDateOffset(1),
    visitTime: "19:00",
    contact: { name: "Fatuma Hassan", phone: nextPhone() },
  });
  return (
    eq(status, 201, "status") &&
    eq(body.party, 6, "party") &&
    eq(body.visitAt, `${nairobiDateOffset(1)}T16:00:00.000Z`, "19:00 in Nairobi is 16:00Z") &&
    eq(body.hoursOfRecord.open, "06:30", "hours quoted back")
  );
});

await check("03:00 is refused with the window in the message", async () => {
  const { status, body } = await post(live.db, {
    kind: "reservation",
    party: 2,
    visitDate: nairobiDateOffset(1),
    visitTime: "03:00",
    contact: { name: "Early Bird", phone: nextPhone() },
  });
  return (
    eq(status, 422, "status") &&
    eq(body.errors.some((e) => e.code === "outside_hours"), true, "outside_hours") &&
    (/06:30–23:00/.test(body.errors.find((e) => e.code === "outside_hours")?.message ?? "") ||
      "the message does not quote the window")
  );
});

await check("23:00 exactly is closed, because the interval is half-open on both sides", async () => {
  const { body } = await post(live.db, {
    kind: "reservation",
    party: 2,
    visitDate: nairobiDateOffset(1),
    visitTime: "23:00",
    contact: { name: "Just Too Late", phone: nextPhone() },
  });
  return eq(body.errors.some((e) => e.code === "outside_hours"), true, "outside_hours", body.errors);
});

await check("yesterday is in the past, not a time machine", async () => {
  const { body } = await post(live.db, {
    kind: "reservation",
    party: 2,
    visitDate: nairobiDateOffset(-1),
    visitTime: "19:00",
    contact: { name: "Time Traveller", phone: nextPhone() },
  });
  return eq(body.errors.some((e) => e.code === "in_the_past"), true, "in_the_past", body.errors);
});

await check("two hundred years is beyond what this form will hold", async () => {
  const { body } = await post(live.db, {
    kind: "reservation",
    party: 2,
    visitDate: nairobiDateOffset(365 * 200),
    visitTime: "19:00",
    contact: { name: "Very Patient", phone: nextPhone() },
  });
  return eq(body.errors.some((e) => e.code === "too_far_ahead"), true, "too_far_ahead", body.errors);
});

await check("31 February has never been a Sunday", async () => {
  const { body } = await post(live.db, {
    kind: "reservation",
    party: 2,
    visitDate: "2027-02-31",
    visitTime: "19:00",
    contact: { name: "Imaginary Date", phone: nextPhone() },
  });
  return eq(body.errors.some((e) => e.code === "bad_visit"), true, "bad_visit", body.errors);
});

await check("a reservation with dinner pre-agreed is priced like a table", async () => {
  const { status, body } = await post(live.db, {
    kind: "reservation",
    party: 4,
    visitDate: nairobiDateOffset(3),
    visitTime: "20:00",
    contact: { name: "Mwangi Family", phone: nextPhone() },
    lines: [{ id: SECOND_ITEM.id, qty: 4 }],
  });
  return eq(status, 201, "status") && eq(body.totalKes, SECOND_ITEM.priceKes * 4, "priced");
});

await check("a party of 200 is a phone call, not a form submission", async () => {
  const { status, body } = await post(live.db, {
    kind: "reservation",
    party: 200,
    visitDate: nairobiDateOffset(3),
    visitTime: "20:00",
    contact: { name: "Wedding", phone: nextPhone() },
  });
  return (
    eq(status, 422, "status") &&
    eq(body.errors.some((e) => e.code === "bad_party"), true, "bad_party") &&
    eq(validate.LIMITS.partyMax, 30, "the limit we tell guests")
  );
});

/* ------------------------------------------------------------------ the body */

describe("POST /v1/requests — what a hostile or broken client sends");

await check("a non-JSON content type is refused before the database is touched", async () => {
  const request = new Request("https://habibi-api.test/v1/requests", {
    method: "POST",
    headers: { "content-type": "text/plain", origin: ORIGIN, "cf-connecting-ip": nextIp() },
    body: "hello",
  });
  const response = await api.default.fetch(request, { DB: live.db }, {});
  return eq(response.status, 415, "status");
});

await check("malformed JSON is a 400, not a 500", async () => {
  const request = new Request("https://habibi-api.test/v1/requests", {
    method: "POST",
    headers: { "content-type": "application/json", origin: ORIGIN, "cf-connecting-ip": nextIp() },
    body: "{\"kind\": \"table\",",
  });
  const response = await api.default.fetch(request, { DB: live.db }, {});
  const body = await response.json();
  return eq(response.status, 400, "status") && eq(body.code, "bad_json", "code");
});

await check("a body bigger than the endpoint takes is a 413", async () => {
  const { status, body } = await post(live.db, {
    kind: "table",
    contact: { name: "A B", phone: nextPhone() },
    notes: "x".repeat(20000),
    lines: [{ id: FIRST_ITEM.id, qty: 1 }],
  });
  return eq(status, 413, "status") && eq(body.code, "too_large", "code");
});

await check("an array instead of an object is a shape error", async () => {
  const { status, body } = await post(live.db, [{ kind: "table" }]);
  return eq(status, 422, "status") && eq(body.errors[0]?.code, "shape", "code");
});

await check("an http (not https) source link is refused", async () => {
  const { status, body } = await post(live.db, {
    kind: "table",
    contact: { name: "A B", phone: nextPhone() },
    lines: [{ id: FIRST_ITEM.id, qty: 1 }],
    source: "http://example.com/table?t=2",
  });
  return eq(status, 422, "status") && eq(body.errors.some((e) => e.code === "bad_source"), true, "bad_source");
});

await check("a 40-line table is over what one table can be", async () => {
  const { status, body } = await post(live.db, {
    kind: "table",
    contact: { name: "A B", phone: nextPhone() },
    lines: Array.from({ length: 41 }, () => ({ id: FIRST_ITEM.id, option: String(Math.random()), qty: 1 })),
  });
  return eq(status, 422, "status") && eq(body.errors.some((e) => e.code === "too_many"), true, "too_many");
});

await check("a reference that is not shaped like one is answered, not searched", async () => {
  const short = await get(live.db, "/v1/requests/HH-12345");
  const words = await get(live.db, "/v1/requests/please-delete-everything");
  return (
    eq(short.status, 400, "five characters") &&
    eq(short.body.code, "bad_reference", "code") &&
    eq(words.status, 400, "not a reference") &&
    eq(live.sql("SELECT COUNT(*) AS n FROM requests")[0].n > 0, true, "the table is still there")
  );
});

await check("a traversal attempt never reaches a lookup — the URL parser folds it first", async () => {
  // `new Request()` normalises `..` segments, so the handler never sees them. The point of this check is
  // that the answer is a plain 404 for a route that does not exist, not a read of anything outside it.
  const { status, body } = await get(live.db, "/v1/requests/../../etc/passwd");
  return eq(status, 404, "status") && eq(body.code, "not_found", "code");
});

await check("a well-shaped reference nobody used is a 404", async () => {
  const { status, body } = await get(live.db, "/v1/requests/HH-ZZZZZZ");
  return eq(status, 404, "status") && eq(body.code, "not_found", "code");
});

await check("the endpoints that exist answer 405, and the ones that do not answer 404", async () => {
  const list = await get(live.db, "/v1/requests");
  const unknown = await get(live.db, "/v1/nothing");
  return (
    eq(list.status, 405, "GET /v1/requests") &&
    eq(unknown.status, 404, "GET /v1/nothing") &&
    (/list/.test(list.body.message) || "the 405 does not explain that there is nothing to list")
  );
});

/* ------------------------------------------------------------------- the two */

describe("limits: the same guest cannot fill the table log");

await check("the same phone twice in twenty seconds is refused, and the second record is not written", async () => {
  const phone = nextPhone();
  const body = (name) => ({
    kind: "table",
    contact: { name, phone },
    lines: [{ id: FIRST_ITEM.id, qty: 1 }],
  });
  const first = await post(live.db, body("First One"), { ip: nextIp() });
  const before = live.sql("SELECT COUNT(*) AS n FROM requests")[0].n;
  const second = await post(live.db, body("Second One"), { ip: nextIp() });
  const after = live.sql("SELECT COUNT(*) AS n FROM requests")[0].n;
  return (
    eq(first.status, 201, "first") &&
    eq(second.status, 429, "second") &&
    eq(second.body.code, "slow_down", "code") &&
    eq(after, before, "no second row")
  );
});

await check("thirteen posts from one address in one minute is twelve records and a 429", async () => {
  const ip = "198.51.100.77";
  const results = [];
  for (let i = 0; i < 13; i += 1) {
    const { status } = await post(
      live.db,
      { kind: "table", contact: { name: `Guest ${i}`, phone: nextPhone() }, lines: [{ id: FIRST_ITEM.id, qty: 1 }] },
      { ip },
    );
    results.push(status);
  }
  const blocked = results.filter((s) => s === 429).length;
  return blocked === 1 && results[12] === 429 ? true : `statuses: ${results.join(",")}`;
});

/* --------------------------------------------------------------- the headers */

describe("CORS: who may read a response");

await check("a preflight from the preview site is answered with that site's origin", async () => {
  const response = await api.default.fetch(
    new Request("https://habibi-api.test/v1/requests", { method: "OPTIONS", headers: { origin: ORIGIN } }),
    { DB: live.db },
    {},
  );
  return (
    eq(response.status, 204, "status") &&
    eq(response.headers.get("access-control-allow-origin"), ORIGIN, "allow-origin") &&
    eq(response.headers.get("vary"), "Origin", "vary")
  );
});

await check("a preview deployment of this project is allowed too", async () => {
  const response = await api.default.fetch(
    new Request("https://habibi-api.test/health", { headers: { origin: "https://abc123.habibihavenpreview.pages.dev" } }),
    { DB: live.db },
    {},
  );
  return eq(response.headers.get("access-control-allow-origin"), "https://abc123.habibihavenpreview.pages.dev", "allow-origin");
});

await check("someone else's page gets no allow-origin and no read", async () => {
  const response = await api.default.fetch(
    new Request("https://habibi-api.test/health", { headers: { origin: "https://evil.example" } }),
    { DB: live.db },
    {},
  );
  return eq(response.headers.get("access-control-allow-origin"), null, "allow-origin");
});

await check("an origin that is not a URL at all is treated as none", async () => {
  const response = await api.default.fetch(
    new Request("https://habibi-api.test/health", { headers: { origin: "not a url" } }),
    { DB: live.db },
    {},
  );
  return eq(response.headers.get("access-control-allow-origin"), null, "allow-origin");
});

await check("every response says do not cache — a receipt is not a shared asset", async () => {
  const { headers } = await get(live.db, "/health");
  return (
    eq(headers.get("cache-control"), "no-store, max-age=0", "cache-control") &&
    eq(headers.get("x-content-type-options"), "nosniff", "nosniff")
  );
});

/* ----------------------------------------------------------------- payments */

describe("payments: dark by configuration, tested as if it were not");

await check("with no credentials the payment route answers 503 and says what is missing", async () => {
  const { status, body } = await post(live.db, { kind: "table", lines: [] }, { path: `/v1/requests/${recorded.reference}/payments` });
  return eq(status, 503, "status") && eq(body.code, "payments_not_configured", "code") && eq(body.missing.length, 6, "six secrets");
});

await check("the callback route is shut too", async () => {
  const { status } = await post(live.db, { Body: { stkCallback: { ResultCode: 0 } } }, { path: "/v1/callbacks/mpesa?token=anything" });
  return eq(status, 503, "status");
});

await check("a confirmation never promises money", async () => {
  const { body } = await get(live.db, `/v1/requests/${recorded.reference}`);
  return eq(body.payments.available, false, "available") && eq(body.paymentState, "none", "payment state");
});

await check("paymentStatus lists exactly the six secrets and never throws", () => {
  const off = mpesa.paymentStatus({ DB: live.db });
  const on = mpesa.paymentStatus(envelope());
  return (
    eq(off.configured, false, "off") &&
    eq(off.missing.join(","), mpesa.REQUIRED_SECRETS.join(","), "missing list") &&
    eq(on.configured, true, "on") &&
    eq(on.mode, "sandbox", "sandbox is the default") &&
    eq(mpesa.paymentStatus(undefined).configured, false, "undefined env")
  );
});

await check("the STK timestamp is Nairobi wall time, three hours ahead of the UTC parts", () => {
  const utc = new Date("2026-11-16T01:30:00.000Z");
  return eq(mpesa.nairobiStamp(utc), "20261116043000", "stamp");
});

await check("the push body carries the server's money and the guest's real number", () => {
  const status = mpesa.paymentStatus(envelope());
  const call = mpesa.buildStkRequest({
    env: envelope(),
    status,
    phone: "254712345678",
    amountKes: 1500,
    reference: "HH-4KQ7MR",
    now: new Date("2026-11-16T01:30:00.000Z"),
  });
  return (
    eq(call.body.Amount, 1500, "amount") &&
    eq(call.body.PartyA, "254712345678", "PartyA") &&
    eq(call.body.PhoneNumber, "254712345678", "PhoneNumber") &&
    eq(call.body.Timestamp, "20261116043000", "timestamp") &&
    eq(call.body.TransactionType, "CustomerPayBillOnline", "default transaction type") &&
    eq(call.body.TransactionDesc, "Habibi Haven HH-4KQ7MR", "description names the reference") &&
    eq(
      call.body.Password,
      btoa(`${envelope().DARAJA_SHORT_CODE}${envelope().DARAJA_PASSKEY}${call.body.Timestamp}`),
      "Password is base64(shortCode + passkey + timestamp)",
    ) &&
    (call.body.Password !== call.body.Timestamp || "the password is not the timestamp") &&
    (call.body.CallBackURL.startsWith("https://api.example.workers.dev/v1/callbacks/mpesa?token=") ||
      `callback url: ${call.body.CallBackURL}`) &&
    (call.tokenUrl.startsWith("https://sandbox.safaricom.co.ke/oauth") || "live/sandbox base picked wrongly")
  );
});

await check("the live base and the PayBill/BuyGoods choice come from configuration, not from a guess", () => {
  const liveEnv = envelope({ DARAJA_ENV: "live", DARAJA_TRANSACTION_TYPE: "CustomerBuyGoodsOnline" });
  const liveCall = mpesa.buildStkRequest({
    env: liveEnv,
    status: mpesa.paymentStatus(liveEnv),
    phone: "254712345678",
    amountKes: 1,
    reference: "HH-AAAAAA",
  });
  const unknown = mpesa.paymentStatus(envelope({ DARAJA_TRANSACTION_TYPE: "WhateverSafaricomSays" }));
  return (
    eq(liveCall.tokenUrl.startsWith("https://api.safaricom.co.ke/"), true, "live base") &&
    eq(liveCall.body.TransactionType, "CustomerBuyGoodsOnline", "Buy Goods honoured") &&
    eq(unknown.transactionType, "CustomerPayBillOnline", "an unrecognised type falls back rather than passing through") &&
    eq(liveCall.body.Amount, 1, "an amount of 1 stays 1")
  );
});

await check("the token compare is length-checked and byte-wise, not a plain ==", () => {
  return (
    eq(mpesa.tokenMatches("abc", "abc"), true, "equal") &&
    eq(mpesa.tokenMatches("abc", "abd"), false, "one byte") &&
    eq(mpesa.tokenMatches("abc", "abcd"), false, "length") &&
    eq(mpesa.tokenMatches(null, "abc"), false, "null") &&
    eq(mpesa.tokenMatches("", ""), true, "both empty")
  );
});

await check("a callback without its nested parameters flattens to nothing rather than throwing", () => {
  const flat = mpesa.readCallback({ Body: { stkCallback: { ResultCode: 1, ResultDesc: "fail" } } });
  return eq(flat.amountKes, null, "amount") && eq(flat.receipt, null, "receipt") && eq(flat.resultCode, 1, "code");
});

/* the full loop against a Daraja made of functions */

const payDb = freshDb();
const paid = await record(payDb.db, {
  kind: "table",
  party: 2,
  contact: { name: "Joseph Maina", phone: "0712 345 999" },
  lines: [{ id: FIRST_ITEM.id, qty: 2 }],
});
const EXPECTED = FIRST_ITEM.priceKes * 2;

function fakeDaraja({ pushResult = { ResultCode: 0, ResultDesc: "The service request is processed successfully.", CheckoutRequestID: "C-2", MerchantRequestID: "M-2" }, tokenOk = true } = {}) {
  const seen = [];
  const fetchImpl = async (url, init) => {
    seen.push({ url, init });
    if (url.includes("/oauth/"))
      return tokenOk
        ? { ok: true, status: 200, json: async () => ({ access_token: "TOK" }) }
        : { ok: false, status: 401, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => pushResult };
  };
  return { fetchImpl, seen };
}

await check("an STK push writes one audit row and moves the request to initiated", async () => {
  const { fetchImpl, seen } = fakeDaraja();
  const out = await mpesa.initiateStkPush({
    env: envelope(),
    db: payDb.db,
    record: { reference: paid.reference, phone: "254712345999", subtotalKes: EXPECTED },
    now: new Date("2026-11-16T01:30:00.000Z"),
    fetchImpl,
  });
  const payment = payDb.sql("SELECT state, amount_kes, phone FROM payments")[0];
  const request = payDb.sql("SELECT payment_state FROM requests WHERE reference = ?", paid.reference)[0];
  return (
    eq(out.accepted, true, "accepted") &&
    eq(out.checkoutRequestId, "C-2", "checkout id") &&
    eq(seen.length, 2, "two calls: token then push") &&
    eq(seen[1].init.headers.Authorization, "Bearer TOK", "bearer token used") &&
    eq(payment.state, "initiated", "payment row") &&
    eq(payment.amount_kes, EXPECTED, "audit amount is the server's number") &&
    eq(request.payment_state, "initiated", "request row")
  );
});

await check("a Daraja token failure sends no push and writes no audit row", async () => {
  const { fetchImpl, seen } = fakeDaraja({ tokenOk: false });
  try {
    await mpesa.initiateStkPush({
      env: envelope(),
      db: payDb.db,
      record: { reference: paid.reference, phone: "254712345999", subtotalKes: EXPECTED },
      fetchImpl,
    });
  } catch (error) {
    return (
      eq(error.code, "token_failed", "code") &&
      eq(seen.length, 1, "stopped after the token call") &&
      eq(payDb.sql("SELECT COUNT(*) AS n FROM payments")[0].n, 1, "no new audit row")
    );
  }
  return "the push went ahead without a token";
});

await check("HTTP 200 with a rejected ResultCode is recorded as failed, not as initiated", async () => {
  const db2 = freshDb();
  const rec = await record(db2.db, {
    kind: "table",
    contact: { name: "Rejected", phone: "0712 345 888" },
    lines: [{ id: FIRST_ITEM.id, qty: 1 }],
  });
  const { fetchImpl } = fakeDaraja({
    pushResult: {
      ResultCode: 1,
      ResultDesc: "Invalid Mobile Number",
      CheckoutRequestID: "C-rejected",
      MerchantRequestID: "M-rejected",
    },
  });
  const out = await mpesa.initiateStkPush({
    env: envelope(),
    db: db2.db,
    record: { reference: rec.reference, phone: "254712345888", subtotalKes: FIRST_ITEM.priceKes },
    fetchImpl,
  });
  const request = db2.sql("SELECT payment_state FROM requests WHERE reference = ?", rec.reference)[0];
  return (
    eq(out.accepted, false, "not accepted") &&
    eq(db2.sql("SELECT state FROM payments")[0].state, "failed", "payment row") &&
    eq(request.payment_state, "failed", "request row agrees")
  );
});

await check("a push with no CheckoutRequestID is refused before anything is written", async () => {
  const db3 = freshDb();
  const rec = await record(db3.db, {
    kind: "table",
    contact: { name: "No Id", phone: "0712 345 777" },
    lines: [{ id: FIRST_ITEM.id, qty: 1 }],
  });
  const { fetchImpl } = fakeDaraja({ pushResult: { ResultCode: 0, ResultDesc: "ok" } });
  try {
    await mpesa.initiateStkPush({
      env: envelope(),
      db: db3.db,
      record: { reference: rec.reference, phone: "254712345777", subtotalKes: FIRST_ITEM.priceKes },
      fetchImpl,
    });
  } catch (error) {
    return eq(error.code, "push_rejected", "code") && eq(db3.sql("SELECT COUNT(*) AS n FROM payments")[0].n, 0, "nothing written");
  }
  return "a push without an id was treated as initiated";
});

const cbPayload = ({ code = 0, amount = EXPECTED, receipt = "QGH1234", checkout = "C-2" } = {}) => ({
  Body: {
    stkCallback: {
      MerchantRequestID: "M-2",
      CheckoutRequestID: checkout,
      ResultCode: code,
      ResultDesc: code === 0 ? "The service request is processed successfully." : "Insufficient balance.",
      ResultParameters: {
        ResultParameter: [
          ...(amount === null ? [] : [{ Key: "Amount", Value: amount }]),
          ...(receipt === null ? [] : [{ Key: "MpesaReceiptNumber", Value: receipt }]),
        ],
      },
    },
  },
});

const callback = (over, { token = envelope().DARAJA_CALLBACK_TOKEN } = {}) =>
  mpesa.verifyCallback({ env: envelope(), db: payDb.db, token, payload: cbPayload(over), now: new Date("2026-11-16T02:00:00.000Z") });

await check("a callback with the wrong token is refused and changes nothing", async () => {
  const out = await callback({}, { token: "guessed" });
  return eq(out.reason, "bad_token", "reason") && eq(payDb.sql("SELECT state FROM payments")[0].state, "initiated", "state untouched");
});

await check("a token one byte short is refused for the same reason as a different one", async () => {
  const out = await callback({}, { token: "fake-callback-toke" });
  return eq(out.reason, "bad_token", "reason");
});

await check("a CheckoutRequestID nobody asked for is refused, not inserted", async () => {
  const out = await callback({ checkout: "C-999" });
  return eq(out.reason, "unknown_checkout_id", "reason") && eq(payDb.sql("SELECT COUNT(*) AS n FROM payments")[0].n, 1, "no invented row");
});

await check("a success for the wrong amount is refused", async () => {
  const out = await callback({ amount: EXPECTED - 100 });
  return (
    eq(out.reason, "amount_mismatch", "reason") &&
    eq(out.expectedKes, EXPECTED, "the number the server wrote down") &&
    eq(payDb.sql("SELECT state FROM payments")[0].state, "initiated", "still initiated")
  );
});

await check("a success with no receipt is refused", async () => {
  const out = await callback({ receipt: null });
  return eq(out.reason, "no_receipt", "reason");
});

await check("the customer not paying is written as failed on both rows", async () => {
  const out = await callback({ code: 1032, receipt: null, amount: null });
  const payment = payDb.sql("SELECT state, result_desc FROM payments")[0];
  const request = payDb.sql("SELECT payment_state FROM requests WHERE reference = ?", paid.reference)[0];
  return (
    eq(out.reason, "customer_did_not_pay", "reason") &&
    eq(payment.state, "failed", "payment row") &&
    eq(request.payment_state, "failed", "request row cannot still say initiated")
  );
});

await check("a moved bill is refused even when the receipt is real", async () => {
  payDb.conn.prepare("UPDATE requests SET subtotal_kes = subtotal_kes + 500 WHERE reference = ?").run(paid.reference);
  const out = await callback({});
  payDb.conn.prepare("UPDATE requests SET subtotal_kes = subtotal_kes - 500 WHERE reference = ?").run(paid.reference);
  return eq(out.reason, "bill_moved", "reason");
});

await check("the real success verifies once, with the receipt", async () => {
  payDb.conn.prepare("UPDATE requests SET payment_state = 'initiated' WHERE reference = ?").run(paid.reference);
  payDb.conn.prepare("UPDATE payments SET state = 'initiated' WHERE checkout_request_id = 'C-2'").run();
  const out = await callback({});
  const payment = payDb.sql("SELECT state, mpesa_receipt, verified_at FROM payments")[0];
  const request = payDb.sql("SELECT payment_state FROM requests WHERE reference = ?", paid.reference)[0];
  return (
    eq(out.accepted, true, "accepted") &&
    eq(payment.state, "verified", "payment row") &&
    eq(payment.mpesa_receipt, "QGH1234", "receipt stored") &&
    (payment.verified_at || "no verified_at stamp") &&
    eq(request.payment_state, "verified", "request row")
  );
});

await check("Safaricom's retry gets the same answer without paying twice", async () => {
  const out = await callback({});
  return eq(out.accepted, true, "still accepted") && eq(out.idempotent, true, "idempotent flag");
});

await check("the handler answers Daraja 200 even when it refused, so it stops retrying", async () => {
  const env = { ...envelope(), DB: payDb.db };
  const request = new Request(
    `https://habibi-api.test/v1/callbacks/mpesa?token=${encodeURIComponent(envelope().DARAJA_CALLBACK_TOKEN)}`,
    { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(cbPayload({ checkout: "C-does-not-exist" })) },
  );
  const response = await api.default.fetch(request, env, {});
  const body = await response.json();
  return eq(response.status, 200, "status") && eq(body.ResultCode, 0, "the envelope Daraja expects");
});

/* ---------------------------------------------------------------- references */

describe("references: what a guest has to type into WhatsApp");

await check("every reference the generator makes is built from its own alphabet, and none from the misread letters", () => {
  const allowed = new Set(store.REFERENCE_ALPHABET);
  for (const char of "ILOUV") {
    if (allowed.has(char)) return `${char} is in the alphabet, which is the letter a waiter mis-hears`;
  }
  for (let i = 0; i < 400; i += 1) {
    const ref = store.makeReference();
    if (!ref.startsWith("HH-")) return `${ref} has no prefix`;
    const body = ref.slice(3);
    if (body.length !== store.REFERENCE_LENGTH) return `${ref} is the wrong length`;
    for (const char of body) if (!allowed.has(char)) return `${ref} emitted ${char}, which is not in the alphabet`;
  }
  return eq(store.REFERENCE_ALPHABET.length, 26, "alphabet size — 26^6 is the guess-resistance argument");
});

await check("the router accepts every character the alphabet contains, in a real URL", async () => {
  // This is the check that caught a real 400: the router's pattern had been written out by hand and did
  // not cover the `S` the generator happily emits. Twenty-six writes and twenty-six reads say so.
  const db7 = freshDb();
  const bad = [];
  for (const char of store.REFERENCE_ALPHABET) {
    const reference = `HH-${char.repeat(store.REFERENCE_LENGTH)}`;
    await record(db7.db, {
      kind: "table",
      contact: { name: "Alphabet Round Trip", phone: nextPhone() },
      lines: [{ id: FIRST_ITEM.id, qty: 1 }],
    }, { reference });
    const { status, body } = await get(db7.db, `/v1/requests/${reference.toLowerCase()}`);
    if (status !== 200 || body?.reference !== reference) bad.push(`${char} → ${status}${body?.code ? ` ${body.code}` : ""}`);
  }
  return bad.length === 0 || `refused: ${bad.join(", ")}`;
});

await check("a collided reference reports null so the caller can draw again, and leaves no half record", async () => {
  const db4 = freshDb();
  const rec = await record(db4.db, {
    kind: "table",
    contact: { name: "First", phone: "0712 345 600" },
    lines: [{ id: FIRST_ITEM.id, qty: 1 }],
  });
  const read = await store.readCatalog(db4.db);
  const value = validate.parseRequest(
    { kind: "table", contact: { name: "Second", phone: "0712 345 601" }, lines: [{ id: FIRST_ITEM.id, qty: 1 }] },
    { items: read.items, hours: read.hours, now: new Date() },
  ).value;
  const again = await store.insertRequest(db4.db, value, { reference: rec.reference, createdAt: new Date().toISOString() });
  return (
    eq(again, null, "duplicate returns null") &&
    eq(db4.sql("SELECT COUNT(*) AS n FROM request_lines WHERE request_reference = ?", rec.reference)[0].n, 1, "the first bill is untouched")
  );
});

await check("a bill line the schema refuses rolls the header back too — no reference with nothing behind it", async () => {
  const db5 = freshDb();
  const read = await store.readCatalog(db5.db);
  const value = validate.parseRequest(
    { kind: "table", contact: { name: "Broken", phone: "0712 345 602" }, lines: [{ id: FIRST_ITEM.id, qty: 1 }] },
    { items: read.items, hours: read.hours, now: new Date() },
  ).value;
  value.rows = [{ ...value.rows[0], qty: 0, amount: 0 }]; // CHECK (qty >= 1) rejects it
  const reference = store.makeReference();
  let threw = false;
  try {
    await store.insertRequest(db5.db, value, { reference, createdAt: new Date().toISOString() });
  } catch (error) {
    threw = /CHECK constraint failed/i.test(String(error?.message)) || `unexpected error: ${error?.message}`;
  }
  return (
    (threw === true || threw) &&
    eq(db5.sql("SELECT COUNT(*) AS n FROM requests WHERE reference = ?", reference)[0].n, 0, "no orphan header") &&
    eq(db5.sql("SELECT COUNT(*) AS n FROM request_lines WHERE request_reference = ?", reference)[0].n, 0, "no orphan line")
  );
});

await check("guest text reaches SQLite as a bound value, quotes and all", async () => {
  const db6 = freshDb();
  const { reference } = await record(db6.db, {
    kind: "table",
    contact: { name: "O'Brien-D'Arcy \"The Rook\"", phone: "0712 345 603" },
    notes: "Table by the window; ignore 'DROP TABLE requests;'",
    lines: [{ id: FIRST_ITEM.id, qty: 1 }],
  });
  const found = await store.readRequest(db6.db, reference);
  return (
    eq(found.record.notes, "Table by the window; ignore 'DROP TABLE requests;'", "notes round trip") &&
    eq(db6.sql("SELECT COUNT(*) AS n FROM requests")[0].n, 1, "the requests table still exists and holds one row")
  );
});

/* -------------------------------------------------------------------- summary */

console.log(`\n${"─".repeat(64)}`);
if (failures.length) {
  console.log(`${failures.length} FAILED · ${passed} passed`);
  for (const f of failures) console.log(`  ${f.group}\n    ${f.what}: ${f.message}`);
  process.exit(1);
}
console.log(`api tests: ${passed} passed — real SQLite over the migration and the build's seed, the handler, both limits, the Daraja path with fake credentials`);
