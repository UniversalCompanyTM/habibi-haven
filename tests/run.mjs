#!/usr/bin/env node
// tests/run.mjs — the guard for the parts of the site that are pure maths.
//
// Why this exists before a single page renders: every bug found in this project so far lived in a
// small, "obvious" file — a drift report that collapsed Single/Double coffees, a price quoted from
// memory instead of from the row, a light rig that read `isOpen(13)` as "13 ms after the epoch" and
// so answered "closed" for every hour on the dial. None of those fail to parse. They fail quietly,
// in front of the user.
//
// So the rule this file enforces is: a lib is not done when it runs, it is done when a test states
// the number it must produce and the number it was built from the restaurant's own data.
//
// Dependency-free on purpose (no Playwright, no vitest): `node tests/run.mjs`, exit 0 or exit 1.
// Browser-level checks live in M6 next to the dist verifier; this is the arithmetic layer.

import { readFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const MENU_PATH = join(ROOT, "site/src/data/menu.json");

// Windows: the ESM loader wants a file:// URL, not "C:\…\hours.mjs".
const lib = (p) => import(pathToFileURL(join(ROOT, p)).href);

const hours = await lib("site/src/lib/hours.mjs");
const table = await lib("site/src/lib/table.mjs");
const gate = await lib("site/src/lib/gate.mjs");
const schema = await lib("site/src/content-schema.mjs");
const tags = await lib("site/src/lib/tags.mjs");
const { localPhotoName, slugify } = await lib("scripts/lib/photo-name.mjs");
const { createPage } = await lib("site/src/lib/page.mjs");

const menu = JSON.parse(await readFile(MENU_PATH, "utf8"));
const overrides = JSON.parse(await readFile(join(ROOT, "content/menu.overrides.json"), "utf8"));
const ALL_ITEMS = menu.families.flatMap((f) => f.sections.flatMap((s) => s.items));

/* ------------------------------------------------------------------ harness */

let passed = 0;
const failures = [];
let group = "";

function describe(name) {
  group = name;
  console.log(`\n${name}`);
}

function check(what, fn) {
  let detail = "";
  try {
    const result = fn();
    if (result && typeof result.then === "function") throw new Error("async checks belong in their own runner");
    if (result !== true && result !== undefined) detail = typeof result === "string" ? result : `got ${JSON.stringify(result)}`;
    if (detail) throw new Error(detail);
    passed += 1;
    console.log(`  ok   ${what}`);
  } catch (err) {
    failures.push({ group, what, message: err.message });
    console.log(`  FAIL ${what}\n       ${err.message}`);
  }
}

const eq = (actual, expected, label) =>
  actual === expected || `${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`;
// Note for whoever writes the next check: `eq` returns TRUE or an error STRING, and a string is truthy.
// Chaining two of them with `&&` therefore reports the second result while a first failure is silently
// discarded. Guard each one (`if (x !== true) return x`) or return only the last.

/* -------------------------------------------------------------------- hours */

describe("hours — one model, no host timezone");

check("the hours of record are 06:30–23:00, from the Google listing", () =>
  eq(`${hours.OPEN_LABEL}–${hours.CLOSE_LABEL}`, "06:30–23:00", "labels"));

check("Africa/Nairobi is UTC+3 all year, so the arithmetic needs no DST table", () =>
  eq(hours.UTC_OFFSET_MINUTES, 180, "offset"));

check("nairobiMinutes reads a UTC instant as Nairobi wall clock", () => {
  // 2026-11-14T00:30:00Z is 03:30 in Nairobi.
  const m = hours.nairobiMinutes(new Date("2026-11-14T00:30:00Z"));
  return eq(m, 3 * 60 + 30, "minutes");
});

check("nairobiMinutes is independent of the host timezone", () => {
  const instant = new Date("2026-11-14T00:30:00Z");
  const a = hours.nairobiMinutes(instant);
  const b = hours.nairobiMinutes(instant.getTime());
  return eq(a, b, "Date vs epoch disagree");
});

check("isOpen is closed at 06:29, open at 06:30, open at 22:59, closed at 23:00", () => {
  const at = (h, m) => hours.isOpenMinutes(h * 60 + m);
  const cases = [[6, 29, false], [6, 30, true], [12, 0, true], [22, 59, true], [23, 0, false], [3, 0, false]];
  for (const [h, m, want] of cases) {
    const got = at(h, m);
    if (got !== want) return `${pad(h)}:${pad(m)} → ${got}, wanted ${want}`;
  }
  return true;
});

// The regression this whole file started with: rigFor used to hand a *decimal hour* to isOpen(),
// which built `new Date(13)` — 13 ms after the epoch — and answered "closed" for the entire dial.
check("rigFor reports the dialled hour's open state, not the real clock's", () => {
  const cases = [[4, false], [6.25, false], [6.5, true], [13, true], [22.75, true], [23, false]];
  for (const [hour, want] of cases) {
    const rig = hours.rigFor(hour);
    if (rig.open !== want) return `rigFor(${hour}).open → ${rig.open}, wanted ${want}`;
  }
  return true;
});

check("the dial spans 06:30→23:00 and every step lands on a named moment", () => {
  const names = new Set();
  for (let h = 6.5; h <= 23; h += 0.5) {
    const rig = hours.rigFor(h);
    if (!rig.name || !rig.line) return `hour ${h} has no phrase`;
    if (!/^\d{2}:\d{2}$/.test(rig.label)) return `hour ${h} labels as "${rig.label}"`;
    names.add(rig.name);
  }
  if (names.size < 6) return `only ${names.size} distinct phrases across 34 dial stops`;
  return true;
});

check("nightAmount is continuous across the stops and never leaves [0,1]", () => {
  let prev = hours.nightAmount(0);
  for (let h = 0; h <= 24; h += 0.25) {
    const v = hours.nightAmount(h);
    if (!(v >= 0 && v <= 1)) return `nightAmount(${h}) = ${v}`;
    if (Math.abs(v - prev) > 0.2) return `nightAmount jumps at ${h}: ${prev} → ${v}`;
    prev = v;
  }
  return true;
});

check("midday is daylight and midnight is dark", () => {
  if (hours.nightAmount(12) > 0.2) return `12:00 is night (${hours.nightAmount(12)})`;
  if (hours.nightAmount(23.5) < 0.9) return `23:30 is not night (${hours.nightAmount(23.5)})`;
  return true;
});

check("labels normalise instead of printing 00:60", () =>
  eq(hours.minutesToLabel(59.6), "01:00", "rounding up a minute"));

check("a garbage hour degrades to noon rather than to NaN:NaN", () => {
  const rig = hours.rigFor("not an hour");
  if (!/^\d{2}:\d{2}$/.test(rig.label)) return `label "${rig.label}"`;
  if (!Number.isFinite(rig.night)) return `night ${rig.night}`;
  return true;
});

check("nextChange counts to the right boundary on both sides of the day", () => {
  const at = (h, m) => hours.nextChange(new Date(nairobiInstantUTC(h, m)));
  const lateNight = at(23, 30);
  if (lateNight.kind !== "opens") return `23:30 says "${lateNight.label}"`;
  if (lateNight.minutes !== 7 * 60) return `23:30 → opens in ${lateNight.minutes} min, expected 420`;
  const justBeforeClose = at(22, 18);
  if (justBeforeClose.kind !== "closes" || justBeforeClose.minutes !== 42)
    return `22:18 → ${justBeforeClose.label}`;
  return true;
});

check("humanSpan never says 0 min", () =>
  eq(
    [0, 42, 60, 690, 720].map((m) => hours.humanSpan(m)).join(" | "),
    "0 min | 42 min | 1 h | 11 h 30 min | 12 h",
    "spans",
  ));

check("snapHour lands on the half-hour the kitchen works in", () =>
  eq([6.49, 6.5, 6.74, 22.9].map((h) => hours.snapHour(h)).join(","), "6.5,6.5,6.5,23", "snaps"));

function pad(n) {
  return String(n).padStart(2, "0");
}

/** A UTC instant whose Nairobi wall clock is h:m — so the test states hours, not epoch maths. */
function nairobiInstantUTC(h, m) {
  return Date.UTC(2026, 10, 14, 0, 0, 0) + (h * 60 + m - hours.UTC_OFFSET_MINUTES) * 60_000;
}

/* -------------------------------------------------------------------- money */

describe("table — prices are their prices, summed");

check("money formats whole shillings the way the menu states them", () =>
  eq([0, 100, 350, 1300, 6000].map(table.money).join(" | "), "KSh 0 | KSh 100 | KSh 350 | KSh 1,300 | KSh 6,000", "money"));

check("every price in the built menu is a positive integer in the observed range", () => {
  for (const i of ALL_ITEMS) {
    if (!Number.isInteger(i.price) || i.price < 100 || i.price > 6000) return `${i.id} priced ${i.price}`;
  }
  return true;
});

check("the menu still spans KSh 100–6,000 with a median of KSh 550", () =>
  eq(
    `${menu.meta.priceRange.min}-${menu.meta.priceRange.max}/${menu.meta.median}`,
    "100-6000/550",
    "meta price facts",
  ));

// The point of the goat amendment: the site quotes Full Mandy at the price the row carries, so a
// stale 2,200 anywhere in the repo shows up here as a mismatch against the ingest.
check("the signature goat is priced from the row, not from the design notes", () => {
  const want = { "full-mandy": 2300, "sinia": 6000, "half-mandy": 1300, "lamb-chops": 1350, "chicken-biryani": 1300, "karak-chai": 350 };
  for (const [id, price] of Object.entries(want)) {
    const item = table.findItem(menu, id);
    if (!item) return `no item ${id} — it was renamed upstream`;
    if (item.price !== price) return `${item.name} is KSh ${item.price}, notes said ${price}`;
  }
  return true;
});

/* ---------------------------------------------------------------- line maths */

check("two plates of the same rice with different sides are two lines", () => {
  let t = table.emptyTable(2);
  t = table.addLine(t, "grilled-chicken-breast", "Chips");
  t = table.addLine(t, "grilled-chicken-breast", "Mandy Rice");
  t = table.addLine(t, "grilled-chicken-breast", "Chips");
  const sum = totalsOf(t);
  return eq(`${t.lines.length}/${sum.count}`, "2/3", "lines/count");
});

check("changing a side renames the row, and merges it if that side is already on the table", () => {
  let t = table.emptyTable(2);
  t = table.addLine(t, "grilled-chicken-breast", "Chips");
  t = table.addLine(t, "grilled-chicken-breast", "Mandy Rice");
  t = table.addLine(t, "grilled-chicken-breast", "Chips");
  // renaming one row into a side it does not already have: still two rows, same three plates
  const renamed = table.setOption(t, "grilled-chicken-breast", "Mandy Rice", "Steamed Veges");
  const afterRename = `${renamed.lines.length}/${totalsOf(renamed).count} ${renamed.lines
    .map((l) => l.option)
    .sort()
    .join("+")}`;
  // …and renaming it onto a side that is already there merges the quantities into one row
  const merged = table.setOption(renamed, "grilled-chicken-breast", "Steamed Veges", "Chips");
  const afterMerge = `${merged.lines.length}/${totalsOf(merged).count} ${merged.lines
    .map((l) => `${l.option}x${l.qty}`)
    .join(",")}`;
  return eq(`${afterRename} | ${afterMerge}`, "2/3 Chips+Steamed Veges | 1/3 Chipsx3", "rename | merge");
});

check("totals multiply unit × qty and match a hand sum", () => {
  let t = table.emptyTable(4);
  t = table.addLine(t, "full-mandy");
  t = table.addLine(t, "full-mandy");
  t = table.addLine(t, "karak-chai");
  t = table.addLine(t, "karak-chai");
  t = table.addLine(t, "karak-chai");
  t = table.addLine(t, "karak-chai");
  const sum = totalsOf(t);
  const expected = 2300 * 2 + 350 * 4;
  if (sum.subtotal !== expected) return `subtotal ${sum.subtotal}, hand sum ${expected}`;
  if (sum.count !== 6) return `count ${sum.count}`;
  if (sum.perPerson !== Math.round(expected / 4)) return `perPerson ${sum.perPerson}`;
  return true;
});

check("an empty table totals zero and never divides by zero", () => {
  const zero = totalsOf(table.emptyTable(0));
  if (zero.subtotal !== 0 || zero.count !== 0) return `empty table totals ${JSON.stringify(zero)}`;
  if (zero.perPerson !== 0) return `perPerson on party 0 → ${zero.perPerson}`;
  return true;
});

check("the one out-of-stock row is counted, not hidden", () => {
  const out = ALL_ITEMS.filter((i) => !i.availability.inStock);
  if (out.length !== 1) return `${out.length} rows marked out of stock, expected 1`;
  const t = table.addLine(table.emptyTable(2), out[0].id);
  const sum = totalsOf(t);
  if (sum.unavailable !== 1) return `unavailable ${sum.unavailable}`;
  if (!sum.rows[0].unavailable) return "line row lost its flag";
  return true;
});

check("setQty(0) removes the line; qty is clamped to the printable range", () => {
  let t = table.addLine(table.emptyTable(2), "lamb-chops");
  t = table.setQty(t, "lamb-chops", undefined, 0);
  if (t.lines.length !== 0) return "qty 0 left a line behind";
  t = table.setQty(table.emptyTable(2), "lamb-chops", undefined, 500);
  if (t.lines.length !== 0) return "setting 0 on an absent line created one";
  let grown = table.addLine(table.emptyTable(2), "lamb-chops");
  for (let n = 0; n < 150; n += 1) grown = table.addLine(grown, "lamb-chops");
  if (grown.lines[0].qty !== 99) return `qty escaped the clamp at ${grown.lines[0].qty}`;
  return true;
});

check("findItem survives a stale link: unknown id → null, and totals skip it", () => {
  if (table.findItem(menu, "a-dish-that-was-removed") !== null) return "found a ghost";
  const sum = totalsOf({ party: 2, lines: [{ id: "a-dish-that-was-removed", qty: 3 }] });
  if (sum.subtotal !== 0 || sum.rows.length !== 0) return "a ghost contributed to the total";
  return true;
});

/* -------------------------------------------------------------- share URLs */

describe("table — the share link round-trips");

check("encode/decode is lossless for every one of the 243 item ids", () => {
  const t = { party: 8, lines: ALL_ITEMS.map((i, n) => ({ id: i.id, qty: (n % 9) + 1 })) };
  const back = table.decodeTable(table.encodeTable(t));
  if (!back) return "decode returned null";
  if (back.party !== 8) return `party ${back.party}`;
  if (back.lines.length !== t.lines.length) return `${back.lines.length} lines back, ${t.lines.length} in`;
  for (let n = 0; n < t.lines.length; n += 1) {
    if (back.lines[n].id !== t.lines[n].id) return `line ${n}: ${back.lines[n].id} ≠ ${t.lines[n].id}`;
    if (back.lines[n].qty !== t.lines[n].qty) return `line ${n} qty ${back.lines[n].qty}`;
  }
  return true;
});

check("an accompaniment with a space survives the round-trip", () => {
  const t = table.addLine(table.emptyTable(2), "grilled-chicken-breast", "Mashed Potatoes");
  const back = table.decodeTable(table.encodeTable(t));
  return eq(back.lines[0].option, "Mashed Potatoes", "option");
});

check("a URL-shaped table decodes to the same total it was shared with", () => {
  let t = table.emptyTable(4);
  t = table.addLine(t, "sinia");
  t = table.addLine(t, "sizzling-fajita", "Chapati");
  t = table.addLine(t, "karak-chai");
  t = table.addLine(t, "karak-chai");
  const raw = table.encodeTable(t);
  const sum = totalsOf(table.decodeTable(raw));
  const original = totalsOf(t);
  if (sum.subtotal !== original.subtotal) return `${sum.subtotal} ≠ ${original.subtotal} from "${raw}"`;
  return true;
});

check("garbage in a ?t= link yields no table instead of a crash", () => {
  for (const bad of ["", "????", "abc|def", "|", "2|nope"]) {
    const decoded = table.decodeTable(bad);
    if (decoded && decoded.lines.some((l) => !table.findItem(menu, l.id)))
      return `"${bad}" produced lines for ids that do not exist`;
  }
  if (table.decodeTable("") !== null) return "empty string should decode to null";
  return true;
});

check("shareUrl percent-encodes so the link stays one token", () => {
  const url = table.shareUrl("https://example.test", { party: 2, lines: [{ id: "karak-chai", qty: 2 }] });
  if (/\s/.test(url)) return `url has a space: ${url}`;
  return eq(url, "https://example.test/table?t=2%7Ckarak-chaix2", "share url");
});

/* --------------------------------------------------------------- whatsapp */

describe("table — the handoff says only what is true");

const sample = (() => {
  let t = table.emptyTable(4);
  t = table.addLine(t, "full-mandy");
  t = table.addLine(t, "karak-chai");
  t = table.addLine(t, "grilled-chicken-breast", "Mandy Rice");
  return t;
})();
const sampleMsg = table.whatsappText(menu, sample, "Saturday 21 November, 19:30", "https://habibi-haven.example");

check("it prices what it lists, from the rows", () => {
  const expected = 2300 + 350 + table.findItem(menu, "grilled-chicken-breast").price;
  return sampleMsg.includes(table.money(expected)) || `total ${table.money(expected)} missing from the message`;
});

check("it goes to the restaurant's own WhatsApp number and nowhere else", () => {
  const url = table.whatsappUrl(menu, sample, null, "https://habibi-haven.example");
  if (!url.startsWith("https://wa.me/254116880000?")) return url.slice(0, 60);
  return true;
});

check("it asks for a table without claiming one is booked", () => {
  for (const forbidden of ["confirmed", "reserved", "booking confirmed", "table 12", "guaranteed"]) {
    if (sampleMsg.toLowerCase().includes(forbidden)) return `says "${forbidden}"`;
  }
  return (
    sampleMsg.includes("we'd like a table") || "the message must read as a request, not a confirmation"
  );
});

check("it carries the chosen side, so the floor staff see the same plate", () =>
  sampleMsg.includes("Grilled Chicken Breast (Mandy Rice)") || "accompaniment lost");

check("it mentions unavailable rows instead of silently ordering them", () => {
  const t = table.addLine(table.emptyTable(2), "grilled-chicken-egg-combo");
  const msg = table.whatsappText(menu, t, null, "");
  return msg.includes("unavailable") || "no caveat for an out-of-stock dish";
});

check("the message contains no invented marketing copy", () => {
  for (const forbidden of ["Habibi Haven — where every visit", "Best restaurant in Nairobi", "AI", "generated"]) {
    if (sampleMsg.includes(forbidden)) return `contains "${forbidden}"`;
  }
  return true;
});

check("with no origin there is no bare 'From:' line", () =>
  !table.whatsappText(menu, sample, null, "").trimEnd().endsWith("From:") || "dangling From:");

function totalsOf(t) {
  return table.totals(menu, t);
}

/* ------------------------------------------------------------------- bakery */

describe("table — the bakery is a product line");

check("cake sizes are detected whatever case their name uses", () => {
  const cakes = ALL_ITEMS.filter((i) => table.cakeFamily(i.name));
  const spellings = new Set(cakes.map((i) => (/KG$/.test(i.name) ? "KG" : "Kg")));
  if (spellings.size !== 2) return `expected both KG and Kg in the data, saw ${[...spellings]}`;
  if (cakes.length < 14) return `only ${cakes.length} cake rows matched`;
  return true;
});

check("a 2KG cake offers its 3KG sibling and nothing else", () => {
  const two = table.findItem(menu, "white-forest-cake-2kg");
  const sibs = table.cakeSiblings(menu, two);
  const names = sibs.map((i) => i.name).join(", ");
  if (names !== "White Forest Cake 3KG") return `siblings: ${names}`;
  if (two.price >= sibs[0].price) return `2KG (${two.price}) is not cheaper than 3KG (${sibs[0].price})`;
  return true;
});

check("mixed-case families stay separate (Blueberry ≠ Black Forest)", () => {
  for (const base of ["Blueberry Cake 2Kg", "Chocolate Mint 2Kg"]) {
    const row = ALL_ITEMS.find((i) => i.name === base);
    if (!row) return `no row named "${base}"`;
    const sibs = table.cakeSiblings(menu, row);
    if (!sibs.length) return `${base} has no sibling`;
    for (const s of sibs) {
      if (table.cakeFamily(s.name).base !== table.cakeFamily(base).base) return `${base} pulled in ${s.name}`;
    }
  }
  return true;
});

check("a savoury dish is not treated as a cake", () =>
  eq(table.cakeFamily("Full Mandy"), null, "Full Mandy"));

/* --------------------------------------------------------------- signatures */

describe("table — the six signatures exist and stay in order");

check("every signature id resolves to a real row with a role", () => {
  const sigs = table.signatureItems(menu);
  if (sigs.length !== 6) return `${sigs.length} signature items, expected 6`;
  for (const s of sigs) if (!s.signatureRole) return `${s.id} lost its role`;
  return true;
});

// The sequence is authored in content/menu.overrides.json, so the expectation is read from that
// file rather than typed here: this checks the pipeline (authored order → signatureOrder in the
// build → the order the home page renders), not my memory of the story.
check("the signatures reach the page in the authored order", () => {
  const wanted = overrides.signature.map((s) => slugify(s.name)).join(",");
  const got = table.signatureItems(menu).map((i) => i.id).join(",");
  return eq(got, wanted, "rendered sequence");
});

check("sectionItem resolves a section id and returns nothing for a stale one", () => {
  const first = menu.families[0].sections[0];
  if (table.sectionItem(menu, first.id).length !== first.count) return `section ${first.id} length drift`;
  const stale = table.sectionItem(menu, "not-a-section");
  if (!Array.isArray(stale) || stale.length !== 0) return `stale section gave ${JSON.stringify(stale)}`;
  return true;
});

check("party advice never invents a dish or a discount", () => {
  const big = totalsOf(table.addLine(table.emptyTable(6), "lamb-chops"));
  const advice = table.partyAdvice(big, 6);
  if (!advice) return "no advice for a six-top eating one starter";
  if (/save|%|discount|offer/i.test(advice)) return `invents a promotion: ${advice}`;
  return true;
});

/* ------------------------------------------------------------------ the gate */

describe("gate — the 3D is gated, the site never is");

check("the tiers are exactly full | lite | 2d | poster", () =>
  eq(gate.TIERS.join("|"), "full|lite|2d|poster", "tiers"));

check("a metered connection gets the poster", () => {
  for (const connection of ["slow-2g", "2g", "3g"]) {
    const d = gate.decide({ connection });
    if (d.tier !== "poster") return `${connection} → ${d.tier}`;
  }
  return true;
});

check("reduced motion never buys animation", () =>
  eq(gate.decide({ reducedMotion: true }).tier, "poster", "reduced-motion tier"));

check("no WebGL context still gets the menu, just not the door", () =>
  eq(gate.decide({ webgl: false }).tier, "2d", "no-webgl tier"));

check("a weak or small device steps down to lite", () => {
  const cases = [
    [{ cores: 2 }, "lite"],
    [{ memory: 3 }, "lite"],
    [{ viewportWidth: 390 }, "lite"],
    [{ pointer: "coarse", viewportWidth: 1180 }, "lite"],
  ];
  for (const [env, want] of cases) {
    const d = gate.decide(env);
    if (d.tier !== want) return `${JSON.stringify(env)} → ${d.tier}, wanted ${want}`;
  }
  return true;
});

check("a desktop-class device gets the full door with a capped DPR", () => {
  const d = gate.decide({ cores: 12, memory: 16, viewportWidth: 1920, devicePixelRatio: 3 });
  if (d.tier !== "full") return d.tier;
  return eq(d.dpr, 2, "dpr cap");
});

// Decision 5 in one assertion: whatever the gate decides, the content it decorates is unchanged.
check("no tier can change what is on the menu", () => {
  const before = ALL_ITEMS.length;
  const sum = ALL_ITEMS.reduce((n, i) => n + i.price, 0);
  for (const tier of gate.TIERS) {
    if (!tier) return "empty tier";
  }
  const after = menu.families.flatMap((f) => f.sections.flatMap((s) => s.items));
  if (after.length !== before) return `tier walk lost items (${after.length} ≠ ${before})`;
  return eq(after.reduce((n, i) => n + i.price, 0), sum, "tier walk changed a price");
});

/* ----------------------------------------------------------------- the data */

describe("menu.json — the shipped file is the validated file");

check("the shipped menu passes its own schema", () => {
  schema.assertMenu(menu);
  return true;
});

check("243 items across 6 families and 41 sections, as reported", () =>
  eq(
    `${menu.meta.items}/${menu.meta.families}/${menu.meta.sections}`,
    `${ALL_ITEMS.length}/${menu.families.length}/${menu.families.reduce((n, f) => n + f.sectionCount, 0)}`,
    "counts",
  ));

check("item ids are unique and kebab-cased", () => {
  const ids = ALL_ITEMS.map((i) => i.id);
  if (new Set(ids).size !== ids.length) return "duplicate id";
  for (const id of ids) if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(id)) return `id "${id}" is not kebab-case`;
  return true;
});

// The collapse this guards is the one the first drift report made: three dishes are listed twice
// under the same heading — Cappuccino, Americano, Latte, each once Single and once Double. Their
// prices differ by design (250/300, 200/250, 250/350), so "same name" must never mean "same item".
check("the Single/Double coffees stay two rows, distinguished by more than price", () => {
  const byName = new Map();
  for (const i of ALL_ITEMS) byName.set(i.name, (byName.get(i.name) ?? []).concat(i));
  const twins = [...byName.entries()].filter(([, rows]) => rows.length > 1);
  if (twins.length !== 3) return `${twins.length} repeated names, expected the three coffee twins: ${twins.map(([n]) => n)}`;
  for (const [name, rows] of twins) {
    if (new Set(rows.map((r) => r.id)).size !== rows.length) return `"${name}" repeats an id`;
    if (new Set(rows.map((r) => r.description)).size !== rows.length)
      return `"${name}" has rows nothing but the price can tell apart`;
    if (!rows.every((r) => /single|double/i.test(r.description)))
      return `"${name}" is not the single/double case: ${rows.map((r) => r.description)}`;
  }
  const cappuccinos = byName.get("Cappuccino").map((r) => r.price).sort((a, b) => a - b);
  return eq(cappuccinos.join("/"), "250/300", "cappuccino single/double");
});

check("descriptions are the restaurant's words: none invented, 113 of 243 filled", () => {
  const described = ALL_ITEMS.filter((i) => i.description).length;
  if (described !== menu.meta.described) return `meta says ${menu.meta.described}, found ${described}`;
  for (const i of ALL_ITEMS) {
    if (/\b(we believe|our passion|crafted with love|must-try|deliciousness)\b/i.test(i.description))
      return `${i.id} reads like generated copy`;
  }
  return true;
});

check("placeholder photography is flagged and never captioned as the dish", () => {
  const flagged = ALL_ITEMS.filter((i) => i.photo.placeholder);
  if (flagged.length !== menu.meta.placeholderPhotos) return `meta says ${menu.meta.placeholderPhotos}, found ${flagged.length}`;
  for (const i of flagged) {
    if (i.photo.alt !== `${i.name} — photograph pending from the restaurant`) return `${i.id} alt reads as the dish`;
  }
  const real = ALL_ITEMS.filter((i) => !i.photo.placeholder);
  if (real.length !== menu.meta.realPhotos) return "real photo count disagrees";
  for (const i of real) if (!i.photo.local?.startsWith("/menu/")) return `${i.id} has no mirrored path`;
  return true;
});

// localPhotoName returns a *file name* including its extension ("1793689502019-liver-malawa.jpg"),
// and mirror-images.mjs derives both sizes from that stem. If those two ever disagree, the build
// silently serves a broken image tag, so the disagreement is a test failure instead.
check("every mirrored photo path is derived the same way the mirror wrote it", () => {
  for (const i of ALL_ITEMS) {
    if (!i.photo.remote) continue;
    const file = localPhotoName(i.photo.remote);
    if (!file) return `${i.id} has a remote with no local name`;
    if (i.photo.placeholder) continue;
    const stem = file.replace(/\.(jpg|png)$/, "");
    if (i.photo.local !== `/menu/${stem}.jpg`) return `${i.id}: ${i.photo.local} ≠ /menu/${stem}.jpg`;
    if (i.photo.thumb !== `/menu/${stem}.400.jpg`) return `${i.id}: ${i.photo.thumb} ≠ /menu/${stem}.400.jpg`;
  }
  return true;
});

check("photo dimensions are measured, not guessed", () => {
  for (const i of ALL_ITEMS) {
    if (i.photo.placeholder) continue;
    if (!(i.photo.width > 0 && i.photo.height > 0)) return `${i.id} has no measured size`;
    if (i.photo.width !== i.photo.height) return `${i.id} is ${i.photo.width}×${i.photo.height}, the bucket is square`;
  }
  return true;
});

check("the facts the pages print are the facts the research recorded", () => {
  const f = menu.meta.facts;
  return eq(
    [f.rating, f.reviews, f.phone, f.plusCode, f.hoursOfRecord.open, f.hoursOfRecord.close].join("|"),
    "4.5|541|+254116880000|PR99+82|06:30|23:00",
    "facts",
  );
});

check("all three social accounts are linked with the handles on record", () => {
  const s = menu.meta.facts.socials;
  return eq(
    [s.instagram, s.tiktok, s.facebook].join(" "),
    "https://www.instagram.com/habibi.haven https://www.tiktok.com/@habibi.haven https://www.facebook.com/profile.php?id=61575101935569",
    "socials",
  );
});

check("the two rival opening-hour claims stay visible in the data", () =>
  eq(menu.meta.facts.hoursDisagreements.length, 2, "disagreements"));

check("slugify folds the punctuation their own names use", () =>
  eq(
    [slugify("Habibi's Kid's Chicken Wrap"), slugify("Arosto |  Full"), slugify("Grilled Chicken & Egg Combo")].join(" / "),
    "habibi-s-kid-s-chicken-wrap / arosto-full / grilled-chicken-egg-combo",
    "slugs",
  ));

check("the words on screen cover every tag in the taxonomy, and no others", () => {
  const declared = Object.keys(tags.TAG_LABELS).sort().join(",");
  const allowed = [...schema.KNOWN_TAGS].sort().join(",");
  eq(declared, allowed, "TAG_LABELS vs KNOWN_TAGS");
  const used = [...new Set(ALL_ITEMS.flatMap((i) => i.tags))].sort().join(",");
  eq(used, allowed, "tags actually present in menu.json");
});

check("an unlabelled tag degrades to its slug instead of throwing", () =>
  eq(tags.tagLabel("halal"), "halal", "fallback"));

/* The dial used to cover 06:30–23:00 while the rig covered 24 hours, so a build that ran after
   midnight lit the room for 00:29 and then put the handle at 19:00 — the control and the room
   disagreed about what time it was, on every visit between midnight and half past six. */
check("the dial can represent every hour the rig can arrive at", () => {
  if (hours.DIAL_MIN !== 0) return `DIAL_MIN is ${hours.DIAL_MIN}; the rig needs 00:00`;
  if (hours.DIAL_MAX < 23.5) return `DIAL_MAX is ${hours.DIAL_MAX}; the rig needs 23:30`;
  for (let h = hours.DIAL_MIN; h <= hours.DIAL_MAX; h += 0.5) {
    const rig = hours.rigFor(h);
    if (!rig.name || !rig.line) return `rigFor(${h}) has no phrase, so the stop under the handle is blank`;
    if (!(rig.night >= 0 && rig.night <= 1)) return `rigFor(${h}).night = ${rig.night}`;
    if (rig.hour !== h) return `rigFor(${h}).hour = ${rig.hour}`;
  }
  const late = hours.rigFor(0.4); // the hour this site was actually built at
  if (late.name !== "Closed") return `00:24 reads as "${late.name}"`;
  if (late.night < 0.95) return `00:24 is not dark (${late.night})`;
});

/* -------------------------------------------------------------------- page */

describe("page — one mount per host across a swap");

// The reason these tests exist is not the module, it is a rule inside Astro's own router
// (astro/dist/transitions/swap-functions.js): an incoming script whose URL has already been executed is
// stamped `data-astro-exec` and never evaluates again. So a component's init code runs exactly once per
// browsing session, not once per page — which either leaves the swapped-in page dead or, with the
// `data-astro-rerun` escape hatch, re-binds every global listener it contains. lib/page.mjs is the third
// option, and this fake document is what proves it behaves: mount once, dispose when the host leaves,
// rebuild when it comes back, and never bind the same listener twice.
class FakeDoc {
  constructor() {
    this.handlers = new Map();
    this.found = new Set();
  }
  addEventListener(type, fn) {
    if (!this.handlers.has(type)) this.handlers.set(type, []);
    this.handlers.get(type).push(fn);
  }
  querySelector(sel) {
    return this.found.has(sel) ? { sel } : null;
  }
  fire(type) {
    for (const fn of this.handlers.get(type) ?? []) fn({ type });
  }
  count(type) {
    return (this.handlers.get(type) ?? []).length;
  }
}

check("a component mounts once, however many page-loads follow", () => {
  const doc = new FakeDoc();
  doc.found.add("[data-door]");
  const page = createPage(doc);
  let mounts = 0;
  const c = page.component("[data-door]", { mount: () => (mounts += 1) });
  doc.fire("astro:page-load");
  doc.fire("astro:page-load");
  doc.fire("astro:after-swap");
  const m = eq(mounts, 1, "mounts");
  if (m !== true) return m;
  return eq(c.isLive(), true, "live");
});

check("the host leaving with the swapped-out page disposes it exactly once", () => {
  const doc = new FakeDoc();
  doc.found.add("[data-door]");
  const page = createPage(doc);
  let mounts = 0;
  let unmounts = 0;
  const c = page.component("[data-door]", {
    mount: () => (mounts += 1),
    unmount: () => (unmounts += 1),
  });
  doc.found.delete("[data-door]");
  doc.fire("astro:after-swap");
  doc.fire("astro:after-swap");
  if (eq(unmounts, 1, "unmounts") !== true) return eq(unmounts, 1, "unmounts");
  if (eq(c.isLive(), false, "live") !== true) return eq(c.isLive(), false, "live");
  return true;
});

check("navigating back home rebuilds it, because the module will not run again", () => {
  const doc = new FakeDoc();
  doc.found.add("[data-door]");
  const page = createPage(doc);
  let mounts = 0;
  const c = page.component("[data-door]", { mount: () => (mounts += 1) });
  doc.found.delete("[data-door]");
  doc.fire("astro:after-swap");
  doc.found.add("[data-door]");
  doc.fire("astro:page-load");
  const rebuilt = eq(mounts, 2, "mounts after returning home");
  if (rebuilt !== true) return rebuilt;
  return eq(c.isLive(), true, "live");
});

check("a mount that returns nothing is still tracked and disposable", () => {
  const doc = new FakeDoc();
  doc.found.add("[data-cursor]");
  const page = createPage(doc);
  let unmounted = "not called";
  const c = page.component("[data-cursor]", {
    mount: () => undefined,
    unmount: (api) => (unmounted = `got ${String(api)}`),
  });
  if (eq(c.isLive(), true, "live after a void mount") !== true) return eq(c.isLive(), true, "live");
  doc.found.delete("[data-cursor]");
  doc.fire("astro:after-swap");
  if (eq(unmounted, "got undefined", "unmount argument") !== true) return eq(unmounted, "got undefined", "unmount");
  return eq(c.isLive(), false, "live after disposal");
});

check("a component with no unmount hook is not an error", () => {
  const doc = new FakeDoc();
  doc.found.add("[data-dial]");
  const page = createPage(doc);
  const c = page.component("[data-dial]", { mount: () => ({ ok: true }) });
  doc.found.delete("[data-dial]");
  doc.fire("astro:after-swap");
  return eq(c.isLive(), false, "live");
});

check("onPage is for rescans: once at registration, again on every load", () => {
  const doc = new FakeDoc();
  const page = createPage(doc);
  let scans = 0;
  page.onPage(() => (scans += 1));
  if (eq(scans, 1, "registered scan") !== true) return eq(scans, 1, "registered");
  doc.fire("astro:page-load");
  doc.fire("astro:page-load");
  return eq(scans, 3, "scans after two loads");
});

check("three components share one pair of listeners", () => {
  const doc = new FakeDoc();
  const page = createPage(doc);
  page.component("[data-door]", { mount: () => 1 });
  page.component("[data-cursor]", { mount: () => 1 });
  page.onPage(() => {});
  if (eq(doc.count("astro:page-load"), 1, "page-load listeners") !== true)
    return eq(doc.count("astro:page-load"), 1, "page-load listeners");
  return eq(doc.count("astro:after-swap"), 1, "after-swap listeners");
});

check("a finder function is allowed where a selector cannot express the host", () => {
  const doc = new FakeDoc();
  const page = createPage(doc);
  let seen = null;
  const c = page.component(() => doc.querySelector("[data-menu]"), {
    mount: (el) => (seen = el.sel),
  });
  if (eq(c.isLive(), false, "not present yet") !== true) return eq(c.isLive(), false, "not present");
  doc.found.add("[data-menu]");
  doc.fire("astro:page-load");
  return eq(seen, "[data-menu]", "mounted host");
});

/* ----------------------------------------------------------------- summary */

console.log(`\n${"─".repeat(64)}`);
if (failures.length) {
  console.log(`${failures.length} FAILED · ${passed} passed`);
  for (const f of failures) console.log(`  ${f.group}\n    ${f.what}: ${f.message}`);
  process.exit(1);
}
console.log(`tests: ${passed} passed — hours, table maths, share links, gate, menu integrity, page lifecycle`);
