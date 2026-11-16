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
    this.one = new Map();
    this.many = new Map();
  }
  addEventListener(type, fn) {
    if (!this.handlers.has(type)) this.handlers.set(type, []);
    this.handlers.get(type).push(fn);
  }
  // Stable per selector, the way a real document is: two `querySelector` calls in the same DOM state hand
  // back the same node. A fake that minted a fresh object per call would make every identity check in the
  // module look like a replaced host, and the tests would then be asserting a property of the fake.
  querySelector(sel) {
    return this.one.get(sel) ?? null;
  }
  querySelectorAll(sel) {
    return this.many.get(sel) ?? [];
  }
  // Put a host at this selector, or replace the one already there. Replacing returns a NEW node object,
  // which is what a view-transition swap does: the incoming page's markup is different elements that
  // match the same selectors.
  setHost(sel) {
    const node = { sel };
    this.one.set(sel, node);
    return node;
  }
  clearHost(sel) {
    this.one.delete(sel);
  }
  // Swap the live set for a selector, the way a body swap replaces the nodes under it. Returns the new
  // node objects so a test can hold one of them and prove identity survives.
  setHosts(sel, count) {
    const nodes = Array.from({ length: count }, (_, i) => ({ sel, i }));
    this.many.set(sel, nodes);
    return nodes;
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
  doc.setHost("[data-door]");
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
  doc.setHost("[data-door]");
  const page = createPage(doc);
  let mounts = 0;
  let unmounts = 0;
  const c = page.component("[data-door]", {
    mount: () => (mounts += 1),
    unmount: () => (unmounts += 1),
  });
  doc.clearHost("[data-door]");
  doc.fire("astro:after-swap");
  doc.fire("astro:after-swap");
  if (eq(unmounts, 1, "unmounts") !== true) return eq(unmounts, 1, "unmounts");
  if (eq(c.isLive(), false, "live") !== true) return eq(c.isLive(), false, "live");
  return true;
});

check("navigating back home rebuilds it, because the module will not run again", () => {
  const doc = new FakeDoc();
  doc.setHost("[data-door]");
  const page = createPage(doc);
  let mounts = 0;
  const c = page.component("[data-door]", { mount: () => (mounts += 1) });
  doc.clearHost("[data-door]");
  doc.fire("astro:after-swap");
  doc.setHost("[data-door]");
  doc.fire("astro:page-load");
  const rebuilt = eq(mounts, 2, "mounts after returning home");
  if (rebuilt !== true) return rebuilt;
  return eq(c.isLive(), true, "live");
});

check("a host replaced in one step is released and rebuilt, not left on the detached node", () => {
  // The case "navigating back home" above cannot reach. A view-transition swap never offers a moment where
  // the selector matches nothing: `astro:after-swap` fires once, with the incoming body already installed,
  // so `find()` goes from the old element straight to a different element. A component keyed on "is there a
  // host at all" stays mounted to the node that just left the document — which is an explorer whose filters
  // stop answering after one click, and a clock whose interval repaints nothing. Keying on the element is
  // what turns that into a disposal followed by a fresh mount.
  const doc = new FakeDoc();
  const first = doc.setHost("[data-explorer]");
  const page = createPage(doc);
  const order = [];
  const c = page.component("[data-explorer]", {
    mount: (el) => {
      order.push(`mount ${el === first ? "first" : "second"}`);
      return el;
    },
    unmount: (api) => order.push(`unmount ${api === first ? "first" : "second"}`),
  });
  const second = doc.setHost("[data-explorer]"); // same selector, different element: the swap
  doc.fire("astro:after-swap");
  // Three entries and the middle pair is the claim: the departing instance is released before the incoming
  // one is built, so a door never has two WebGL contexts alive at once on a gated device.
  if (eq(order.join(" → "), "mount first → unmount first → mount second", "order") !== true)
    return eq(order.join(" → "), "mount first → unmount first → mount second", "order");
  return eq(c.host(), second, "the live instance is bound to the incoming element");
});

check("a host that survives the swap untouched is not remounted", () => {
  // The other half of identity: `data-astro-transition-persist` keeps an element across a swap, and a
  // primitive that rebuilt on every event would tear down a running scene for no reason.
  const doc = new FakeDoc();
  const kept = doc.setHost("[data-explorer]");
  const page = createPage(doc);
  let mounts = 0;
  page.component("[data-explorer]", {
    mount: () => {
      mounts += 1;
      return kept;
    },
    unmount: () => (mounts -= 100),
  });
  doc.fire("astro:after-swap");
  doc.fire("astro:page-load");
  return eq(mounts, 1, "mounts across a swap that kept the element");
});

check("a mount that returns nothing is still tracked and disposable", () => {
  const doc = new FakeDoc();
  doc.setHost("[data-cursor]");
  const page = createPage(doc);
  let unmounted = "not called";
  const c = page.component("[data-cursor]", {
    mount: () => undefined,
    unmount: (api) => (unmounted = `got ${String(api)}`),
  });
  if (eq(c.isLive(), true, "live after a void mount") !== true) return eq(c.isLive(), true, "live");
  doc.clearHost("[data-cursor]");
  doc.fire("astro:after-swap");
  if (eq(unmounted, "got undefined", "unmount argument") !== true) return eq(unmounted, "got undefined", "unmount");
  return eq(c.isLive(), false, "live after disposal");
});

check("a component with no unmount hook is not an error", () => {
  const doc = new FakeDoc();
  doc.setHost("[data-dial]");
  const page = createPage(doc);
  const c = page.component("[data-dial]", { mount: () => ({ ok: true }) });
  doc.clearHost("[data-dial]");
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
  doc.setHost("[data-menu]");
  doc.fire("astro:page-load");
  return eq(seen, "[data-menu]", "mounted host");
});

// `collection` exists because the home page mounts two dials — a compact one in the hero and a full one in
// the rig section. A single-host primitive wired to `[data-dial]` would take the first and leave the second
// as a slider that moves a handle and changes nothing, which is the exact defect the comment in
// HoursClock.astro already complains about once. These checks are what stop it coming back through the
// router, where the second dial arrives from a swapped-in body rather than from a fresh script.

check("two hosts on one page get two instances", () => {
  const doc = new FakeDoc();
  const page = createPage(doc);
  doc.setHosts("[data-dial]", 2);
  const mounted = [];
  let unmounts = 0;
  const c = page.collection("[data-dial]", {
    mount: (el) => (mounted.push(el.i), el),
    unmount: () => (unmounts += 1),
  });
  if (eq(mounted.join(","), "0,1", "mounted indices") !== true) return eq(mounted.join(","), "0,1", "mounted");
  if (eq(c.size(), 2, "live size") !== true) return eq(c.size(), 2, "live size");
  return eq(unmounts, 0, "unmounts");
});

check("a page with no hosts disposes every instance", () => {
  const doc = new FakeDoc();
  const page = createPage(doc);
  doc.setHosts("[data-dial]", 2);
  const gone = [];
  const c = page.collection("[data-dial]", {
    mount: (el) => el,
    unmount: (api) => gone.push(api.i),
  });
  doc.setHosts("[data-dial]", 0);
  doc.fire("astro:after-swap");
  if (eq(gone.join(","), "0,1", "disposed in order") !== true) return eq(gone.join(","), "0,1", "disposed");
  return eq(c.size(), 0, "live size");
});

check("identity is the element: a surviving host is not remounted, a replaced one is", () => {
  const doc = new FakeDoc();
  const page = createPage(doc);
  const [a] = doc.setHosts("[data-dial]", 2);
  let mounts = 0;
  const unmounted = [];
  const c = page.collection("[data-dial]", {
    mount: (el) => {
      mounts += 1;
      return el;
    },
    unmount: (api) => unmounted.push(api.i),
  });
  if (eq(mounts, 2, "both mounted at registration") !== true) return eq(mounts, 2, "registration mounts");
  // The swap keeps `a` (a persisted host) and replaces `b` with a new node `d`.
  const d = { sel: "[data-dial]", i: 3 };
  doc.many.set("[data-dial]", [a, d]);
  doc.fire("astro:after-swap");
  if (eq(unmounted.length, 1, "only the departed host disposed") !== true)
    return eq(unmounted.length, 1, "disposals");
  if (eq(unmounted[0], 1, "the disposed host was b") !== true) return eq(unmounted[0], 1, "which host");
  if (eq(mounts, 3, "the survivor was not remounted") !== true) return eq(mounts, 3, "mounts");
  return eq(c.size(), 2, "live size");
});

check("disposal runs before the mount that replaces it", () => {
  const doc = new FakeDoc();
  const page = createPage(doc);
  doc.setHosts("[data-door]", 1);
  const order = [];
  // The reason this ordering is pinned: two WebGL contexts alive at once on a device that was gated down
  // to one. Freeing first keeps the peak at one.
  page.collection("[data-door]", {
    mount: (el) => {
      order.push(`mount ${el.i}`);
      return el;
    },
    unmount: (el) => order.push(`unmount ${el.i}`),
  });
  doc.setHosts("[data-door]", 1);
  doc.fire("astro:after-swap");
  // Three entries, not two: registering mounts the host that is already there. The claim under test is
  // the middle pair — the old one is released before the new one is created.
  return eq(order.join(" → "), "mount 0 → unmount 0 → mount 0", "order");
});

check("a collection and a component share the one pair of listeners", () => {
  const doc = new FakeDoc();
  const page = createPage(doc);
  page.collection("[data-dial]", { mount: () => 1 });
  page.component("[data-door]", { mount: () => 1 });
  doc.fire("astro:page-load");
  if (eq(doc.count("astro:page-load"), 1, "page-load listeners") !== true)
    return eq(doc.count("astro:page-load"), 1, "page-load listeners");
  return eq(doc.count("astro:after-swap"), 1, "after-swap listeners");
});

/* ------------------------------------------------------- structured data */

describe("structured data — what Google is told about this restaurant");

const { restaurantSchema } = await lib("site/src/lib/schema.mjs");
const ORIGIN = "https://habibihavenpreview.pages.dev";
const built = restaurantSchema({
  menu,
  origin: ORIGIN,
  canonical: `${ORIGIN}/`,
  description: "test",
});

check("every price in the schema block is the price on the menu row", () => {
  const items = built.menu?.hasMenuItem ?? [];
  if (items.length < 5) return `only ${items.length} dishes published — the signature set went missing`;
  for (const entry of items) {
    const source = ALL_ITEMS.find((i) => i.name === entry.name);
    if (!source) return `"${entry.name}" is in the schema and not on the menu`;
    if (entry.offers?.price !== Number(source.price))
      return `${entry.name}: schema says ${entry.offers?.price}, the menu row says ${source.price}`;
    if (entry.offers?.priceCurrency !== menu.meta.currency)
      return `${entry.name}: quoted in ${entry.offers?.priceCurrency}, menu currency is ${menu.meta.currency}`;
  }
  return true;
});

const plus = await lib("site/src/lib/pluscode.mjs");

check("the GPS we publish is the cell the venue's own plus code names", () => {
  const f = menu.meta.facts;
  if (!f.coordinates) return "the facts carry no coordinates, so the structured data publishes no pin";
  // "Publish it, source noted" is two requirements, and this is where the second one is enforced.
  if (!f.coordinatesSource) return `a pin is published with no source: ${JSON.stringify(f.coordinates)}`;
  const pin = plus.agrees(f.coordinates.latitude, f.coordinates.longitude, f.plusCode);
  if (!pin.matches)
    return `${f.coordinates.latitude}, ${f.coordinates.longitude} names cell ${pin.short}, the listing publishes ${f.plusCode} — two different doors`;
  return eq(
    JSON.stringify(built.geo),
    JSON.stringify({ "@type": "GeoCoordinates", latitude: f.coordinates.latitude, longitude: f.coordinates.longitude }),
    "geo equals the sourced cell centre",
  );
});

check("that guard can fail — a pin 30 m off is not the published cell", () => {
  // A test that only ever passes is a comment with extra steps. One cell north-east is ~14 m; two is
  // ~28 m, and at that distance the point has left the doorway whatever the map data says.
  const shifted = plus.agrees(-1.281407, 36.817562, menu.meta.facts.plusCode);
  if (shifted.matches) return `a coordinate 30 m from the venue still matched ${menu.meta.facts.plusCode}`;
  const back = plus.decode(plus.encodeFull(menu.meta.facts.coordinates.latitude, menu.meta.facts.coordinates.longitude));
  const metres = Math.hypot(
    (back.centre.lat - menu.meta.facts.coordinates.latitude) * 111320,
    (back.centre.lon - menu.meta.facts.coordinates.longitude) * 111320 * Math.cos((back.centre.lat * Math.PI) / 180),
  );
  if (metres > 1) return `the published coordinate is ${metres.toFixed(1)} m from the cell centre it claims`;
  return true;
});

check("geo stays dark when the facts carry no coordinates", () => {
  const unpinned = restaurantSchema({
    menu: {
      ...menu,
      meta: { ...menu.meta, facts: { ...menu.meta.facts, coordinates: undefined, coordinatesSource: undefined } },
    },
    origin: ORIGIN,
    canonical: `${ORIGIN}/`,
    description: "test",
  });
  return unpinned.geo === undefined ? true : `geo appeared without a coordinate: ${JSON.stringify(unpinned.geo)}`;
});

check("the content schema refuses a pin it cannot stand behind", () => {
  const cases = [
    [{ latitude: 0, longitude: 0 }, "Null Island"],
    [{ latitude: -1.281687, longitude: 200 }, "longitude off the edge of the map"],
    [{ latitude: "south of the roundabout", longitude: 36.817562 }, "a string where a number belongs"],
  ];
  for (const [coordinates, why] of cases) {
    const m = JSON.parse(JSON.stringify(menu));
    m.meta.facts.coordinates = coordinates;
    const out = schema.validateMenu(m);
    if (out.ok) return `schema accepted ${JSON.stringify(coordinates)} (${why})`;
    if (!out.errors.some((e) => e.startsWith("meta.facts.coordinates")))
      return `${JSON.stringify(coordinates)} (${why}) rejected for the wrong reason: ${out.errors.join(" | ")}`;
  }
  // and the rule with teeth: a coordinate with no sentence naming where it came from is not publishable
  const orphan = JSON.parse(JSON.stringify(menu));
  delete orphan.meta.facts.coordinatesSource;
  const out = schema.validateMenu(orphan);
  if (out.ok) return "schema accepted a published coordinate with no source";
  return out.errors.some((e) => e.includes("coordinatesSource"))
    ? true
    : `sourceless pin rejected for the wrong reason: ${out.errors.join(" | ")}`;
});

check("availability follows the kitchen's own inStock flag, both ways", () => {
  const on = built.menu.hasMenuItem.every((i) => i.offers.availability === "https://schema.org/InStock");
  if (!on) return `an in-stock dish was published as ${built.menu.hasMenuItem.map((i) => i.offers.availability).join(", ")}`;
  const flipped = JSON.parse(JSON.stringify(menu));
  const target = table.signatureItems(flipped)[0];
  target.availability = { open: true, inStock: false };
  const out = restaurantSchema({ menu: flipped, origin: ORIGIN, canonical: `${ORIGIN}/`, description: "test" });
  const entry = out.menu.hasMenuItem.find((i) => i.name === target.name);
  return eq(entry.offers.availability, "https://schema.org/OutOfStock", "a sold-out signature stays sold-out in the schema");
});

check("the address, hours and phone the schema claims are the ones on screen", () => {
  const f = menu.meta.facts;
  const problems = [];
  if (built.address.streetAddress !== "Koinange Street") problems.push(`street is ${built.address.streetAddress}`);
  if (built.address.addressCountry !== "KE") problems.push(`country is ${built.address.addressCountry}`);
  if (built.telephone !== f.phone) problems.push(`telephone is ${built.telephone}, facts say ${f.phone}`);
  const spec = built.openingHoursSpecification[0];
  if (spec.opens !== f.hoursOfRecord.open || spec.closes !== f.hoursOfRecord.close)
    problems.push(`hours are ${spec.opens}–${spec.closes}, record says ${f.hoursOfRecord.open}–${f.hoursOfRecord.close}`);
  if (spec.dayOfWeek.length !== 7) problems.push(`${spec.dayOfWeek.length} days published`);
  if (!built.hasMap.includes("google.com/maps")) problems.push(`hasMap is ${built.hasMap}`);
  if (built.aggregateRating.ratingValue !== f.rating || built.aggregateRating.reviewCount !== f.reviews)
    problems.push("the rating is not the rating they have");
  return problems.length ? problems.join("; ") : true;
});

check("the handoff link the kitchen receives points at where the guest was standing", () => {
  const sampleTable = { party: 2, lines: [{ id: ALL_ITEMS[0].id, qty: 1 }] };
  const url = table.shareUrl(ORIGIN, sampleTable);
  if (!url.startsWith(`${ORIGIN}/table?t=`)) return `share link is ${url}`;
  const link = table.whatsappUrl(menu, sampleTable, "Fri 19:00", ORIGIN);
  const from = decodeURIComponent(link).match(/From: (\S+)/)?.[1];
  if (!from?.startsWith(ORIGIN)) return `the WhatsApp message hands out ${from}, not ${ORIGIN}`;
  return true;
});

/* ------------------------------------------------- the interrupted page swap */
// The router aborts an in-flight view transition when a second navigation starts, and leaves the resulting
// rejection unhandled (site/src/lib/transition-guard.mjs). A gate that fails the build on any uncaught
// exception is only worth having if the one thing we swallow is provably that abort, so the swallowing rule
// is a pure predicate with a test rather than a regex buried in an event handler.
const guard = await lib("site/src/lib/transition-guard.mjs");

const fakeRejections = () => {
  const bound = [];
  return {
    addEventListener: (type, fn) => type === "unhandledrejection" && bound.push(fn),
    bound: () => bound.length,
    // Returns whether the event was cancelled, which is the whole observable behaviour.
    fire: (reason) => {
      let cancelled = false;
      for (const fn of bound) fn({ reason, preventDefault: () => (cancelled = true) });
      return cancelled;
    },
  };
};

check("the guard cancels the router's skipped-transition abort", () => {
  const scope = fakeRejections();
  guard.installTransitionGuard(scope);
  const abort = new DOMException("Transition was skipped. skipTransition() called", "AbortError");
  return eq(scope.fire(abort), true, "cancelled");
});

check("the guard cancels nothing else, including the other abort we can cause", () => {
  const scope = fakeRejections();
  guard.installTransitionGuard(scope);
  const kept = [
    new DOMException("The user aborted a request.", "AbortError"), // a superseded fetch
    new TypeError("cannot read property of null"),
    new Error("Transition was skipped"), // right words, wrong kind: not the router's rejection
    null,
    undefined,
  ];
  const cancelled = kept.map((reason) => scope.fire(reason));
  if (cancelled.some(Boolean)) return `cancelled ${cancelled.filter(Boolean).length} of ${kept.length}`;
  return eq(cancelled.length, 5, "cases run");
});

check("the guard binds one listener however many modules ask for it", () => {
  const scope = fakeRejections();
  const first = guard.installTransitionGuard(scope);
  const second = guard.installTransitionGuard(scope);
  if (eq(first, true, "first install") !== true) return eq(first, true, "first install");
  if (eq(second, false, "second install") !== true) return eq(second, false, "second install");
  return eq(scope.bound(), 1, "listeners");
});

/* ------------------------------------------------ the form that reaches the book */
// The page is the thin part; the thing that can quietly lie is the payload shape and the reading of the
// answer. Both are pinned here because the Worker is the only other judge and it is not in this process.
const rc = await lib("site/src/lib/request-client.mjs");

check("the reservation payload is the shape the Worker reads", () => {
  const p = rc.reservationPayload(
    { name: "  Amina  ", phone: " +254700111222 ", date: "2026-11-22", time: "19:00", party: " 4 ", notes: "   " },
    { origin: "https://habibihavenpreview.pages.dev/" },
  );
  const problems = [];
  if (p.kind !== "reservation") problems.push(`kind ${p.kind}`);
  if (p.party !== 4) problems.push(`party is ${typeof p.party} ${p.party}, must be the number 4`);
  if (p.contact?.name !== "Amina" || p.contact?.phone !== "+254700111222") problems.push("contact is not nested and trimmed");
  if (p.visitDate !== "2026-11-22" || p.visitTime !== "19:00") problems.push("the visit pair did not survive");
  if ("notes" in p) problems.push("a blank notes field was sent");
  if (p.source !== "https://habibihavenpreview.pages.dev/visit") problems.push(`source is ${p.source}`);
  return problems.length ? problems.join("; ") : true;
});

check("the flat contact the Worker would refuse is never built, and no origin means no source", () => {
  const p = rc.reservationPayload({ name: "A", phone: "+254700111222" }, {});
  if ("contactName" in p || "contactPhone" in p) return "contact was flattened";
  if ("source" in p) return `invented a source: ${p.source}`;
  return eq(p.notes, undefined, "absent notes");
});

check("every answer the Worker can give maps to one thing the page says", () => {
  const cases = [
    [{ status: 201, body: { reference: "HH-AMQZN5", totalKes: 3100 } }, "recorded"],
    [{ status: 422, body: { errors: [{ field: "visitTime", code: "outside_hours", message: "Pick a time inside that." }] } }, "invalid"],
    [{ status: 429, body: { retry_after_seconds: 20 } }, "busy"],
    [{ status: 500, body: null }, "failed"],
    [{ status: 0, network: true }, "unreachable"],
  ];
  const seen = cases.map(([input, want]) => {
    const got = rc.outcome(input);
    if (got.kind !== want) return `${input.status} read as ${got.kind}, not ${want}`;
    return null;
  });
  const invalid = rc.outcome(cases[1][0]);
  if (invalid.messages.join() !== "Pick a time inside that.") return `lost the server's own words: ${invalid.messages.join()}`;
  if (invalid.fields.join() !== "visitTime") return `lost the field to focus: ${invalid.fields.join()}`;
  if (rc.outcome(cases[3][0]).messages.length !== 1) return "a bodyless 500 still needs one sentence";
  const found = seen.filter(Boolean);
  return found.length ? found.join("; ") : true;
});

check("a request the book never took still leaves the guest able to send it", () => {
  const p = rc.reservationPayload(
    { name: "Amina", phone: "+254700111222", date: "2026-11-22", time: "19:00", party: "4", notes: "high chair" },
    {},
  );
  const msg = rc.requestMessage(p);
  const missing = ["Amina", "+254700111222", "2026-11-22", "19:00", "4", "high chair"].filter((bit) => !msg.includes(bit));
  if (missing.length) return `the handover message dropped ${missing.join(", ")}`;
  const href = rc.whatsAppHref("254116880000", msg);
  if (!href.startsWith("https://wa.me/254116880000?text=")) return `handoff link is ${href.slice(0, 40)}`;
  if (href.includes(" ")) return "an unencoded space would truncate the link";
  return true;
});

/* ------------------------------------------------------ the sheet that writes itself down */
// /table's record button sends the same `{id, qty}` rows the share link uses, so the two failure modes worth
// pinning are (a) the page's own prices leaking into a payload the Worker is going to reprice, and (b) the
// half-built request a guest would get back as a 422 about a field they never saw on screen.

check("the table payload sends ids and quantities, never names or prices", () => {
  const sheet = {
    party: 5,
    lines: [
      { id: "grilled-chicken-breast", option: "Mandy Rice", qty: 2 },
      { id: "liver-malawa", qty: 1 },
      { id: "ghost-dish", qty: 0 },
      { id: "", qty: 3 },
    ],
  };
  const p = rc.tablePayload(
    { name: " Amina ", phone: " +254700111222 ", notes: "  " },
    { table: sheet, claimed: 3600, day: "2026-11-22", time: "19:00", when: "Sun 22 Nov, 7:00 pm", origin: "https://habibihavenpreview.pages.dev/" },
  );
  const problems = [];
  if (p.kind !== "table") problems.push(`kind ${p.kind}`);
  if (p.party !== 5) problems.push(`party came from the sheet as ${p.party}`);
  if (p.contact?.name !== "Amina" || p.contact?.phone !== "+254700111222") problems.push("contact is not nested and trimmed");
  // the two dead rows: qty 0 and a missing id. A line the Worker cannot price is a line it 422s on.
  if (p.lines.length !== 2) problems.push(`sent ${p.lines.length} lines, expected the 2 real ones`);
  if (p.lines.some((l) => "price" in l || "amount" in l || "name" in l)) problems.push("a price or name travelled in a line");
  if (p.lines[0]?.option !== "Mandy Rice") problems.push(`the side choice was dropped (${JSON.stringify(p.lines[0])})`);
  if ("option" in (p.lines[1] ?? {})) problems.push("a line without a side grew an undefined option key");
  if (p.claimedSubtotal !== 3600) problems.push(`claimedSubtotal is ${p.claimedSubtotal}`);
  if (p.visitDate !== "2026-11-22" || p.visitTime !== "19:00") problems.push("the day/time pair did not survive together");
  if (p.when !== "Sun 22 Nov, 7:00 pm") problems.push(`when label lost: ${p.when}`);
  if ("notes" in p) problems.push("a blank notes field was sent");
  if (p.source !== "https://habibihavenpreview.pages.dev/table") problems.push(`source is ${p.source}`);
  return problems.length ? problems.join("; ") : true;
});

check("a table payload refuses to invent half a pair, a long label, or a fractional total", () => {
  const base = { party: 2, lines: [{ id: "liver-malawa", qty: 1 }] };
  const onlyTime = rc.tablePayload({ name: "A", phone: "+2547" }, { table: base, time: "19:00" });
  if ("visitTime" in onlyTime || "visitDate" in onlyTime) return "a lone time was sent — the book validates the pair and would 422 about a date the guest never saw";
  const long = rc.tablePayload({ name: "A", phone: "+2547" }, { table: base, when: "x".repeat(61) });
  if ("when" in long) return "a 61-character label was sent instead of dropped; the 60-char limit is the server's";
  const odd = rc.tablePayload({ name: "A", phone: "+2547" }, { table: base, claimed: 3600.5 });
  if ("claimedSubtotal" in odd) return "a non-integer claim was sent, which the book rejects outright";
  const noParty = rc.tablePayload({ name: "A", phone: "+2547" }, { table: { party: 0, lines: [] } });
  if (noParty.party !== null) return `party 0 became ${noParty.party} instead of null`;
  const bare = rc.tablePayload({ name: "A", phone: "+2547" }, { table: base });
  if ("source" in bare) return `invented a source: ${bare.source}`;
  if (bare.lines.length !== 1) return "the one real line was lost";
  return true;
});

check("the drift the book reports back reaches the page as drift, not as a silent correction", () => {
  const withGap = rc.outcome({
    status: 201,
    body: { reference: "HH-AMQZN5", totalKes: 3900, priceDrift: { claimedKes: 3600, serverKes: 3900, deltaKes: 300 } },
  });
  if (withGap.priceDrift?.deltaKes !== 300) return `the gap was flattened away: ${JSON.stringify(withGap.priceDrift)}`;
  if (withGap.totalKes !== 3900) return "the server's total is what the guest should be told";
  const matched = rc.outcome({ status: 201, body: { reference: "HH-AMQZN5", totalKes: 3600, priceDrift: null } });
  if (matched.priceDrift !== null) return "an agreed price came back as something else";
  const noClaim = rc.outcome({ status: 201, body: { reference: "HH-AMQZN5", totalKes: 3600 } });
  if (noClaim.priceDrift !== null) return "a 201 with no drift key read as " + JSON.stringify(noClaim.priceDrift);
  return true;
});

check("the /table fallback says who is calling and leaves the dishes to the sheet's own message", () => {
  const built = { party: 5, lines: [{ id: "grilled-chicken-breast", option: "Mandy Rice", qty: 2 }] };
  const p = rc.tablePayload({ name: "Amina", phone: "+254700111222", notes: "high chair" }, {
    table: built, claimed: 3600, day: "2026-11-22", time: "19:00", when: "Sun 22 Nov, 7:00 pm",
  });
  const contact = rc.requestMessage(p);
  const missing = ["Amina", "+254700111222", "2026-11-22", "19:00", "5", "high chair"].filter((bit) => !contact.includes(bit));
  if (missing.length) return `the handover block dropped ${missing.join(", ")}`;
  // The two halves together must be as complete as the reservation message alone: the sheet's own text carries
  // the dishes and the estimate, so if it stopped doing that this split would be losing the order.
  const sheetMsg = table.whatsappText(menu, built, "Sun 22 Nov, 7:00 pm", "https://habibihavenpreview.pages.dev");
  const joined = `${sheetMsg}\n\n${contact}`;
  const lost = ["Grilled Chicken Breast", "Mandy Rice", "KSh", "Estimated total", "Amina", "+254700111222"].filter((bit) => !joined.includes(bit));
  if (lost.length) return `WhatsApp fallback for a recorded table loses ${lost.join(", ")}`;
  if ((contact.match(/KSh/g) ?? []).length) return "the contact block repeated prices the sheet already sent";
  return true;
});

check("the party window is one number the browser, the link and the book all read", () => {
  const problems = [];
  // A share link can say anything, because a guest can edit it. Each arm is a different kind of nonsense,
  // and the rule is: come back inside the window, unless there was no number to put there.
  const cases = [
    ["99", table.PARTY_MAX, "over the cap"],
    ["-5", table.PARTY_MIN, "below the floor"],
    ["0", table.PARTY_DEFAULT, "no party at all"],
    ["two", table.PARTY_DEFAULT, "not a number"],
  ];
  for (const [raw, want, why] of cases) {
    const got = table.decodeTable(`${raw}|liver-malawa x1`).party;
    if (got !== want) problems.push(`${why} (${raw}) decoded to ${got}, expected ${want}`);
  }
  // The shape that used to escape: a stored fraction passes a `> 0` test and rounds down out of the window.
  for (const [value, want] of [[0.4, table.PARTY_MIN], [2.6, 3], [undefined, table.PARTY_DEFAULT], [NaN, table.PARTY_DEFAULT]]) {
    if (table.clampParty(value) !== want) problems.push(`clampParty(${String(value)}) gave ${table.clampParty(value)}, expected ${want}`);
  }
  const round = table.encodeTable({ party: table.PARTY_MAX, lines: [] });
  if (table.decodeTable(round).party !== table.PARTY_MAX) problems.push("the cap does not survive an encode/decode round trip");
  if (table.emptyTable().party !== table.PARTY_DEFAULT) problems.push("a fresh sheet does not start at the default party");
  if (table.PARTY_MIN > 1 || table.PARTY_MAX < 30) problems.push(`the policy moved to ${table.PARTY_MIN}–${table.PARTY_MAX} without the book agreeing (tests/api.mjs compares them)`);
  return problems.length ? problems.join("; ") : true;
});

check("a 422 points the guest at a control without ever turning the server's words into a selector", () => {
  const problems = [];
  // What the two forms actually contain. A real `form.elements` also holds the buttons, whose `name` is "",
  // so they are in here on purpose: a blank leaf must not land on one.
  const controls = [
    { name: "name" },
    { name: "phone" },
    { name: "party" },
    { name: "date" },
    { name: "time" },
    { name: "notes" },
    { name: "" },
  ];
  const leaf = (field) => rc.firstBadControl([field], controls)?.name ?? null;
  for (const [field, want] of [
    ["contact.phone", "phone"],
    ["contact.name", "name"],
    ["party", "party"],
    ["visitDate", null],
    ["notes", "notes"],
  ]) {
    if (leaf(field) !== want) problems.push(`${field} landed on ${leaf(field)}, expected ${want}`);
  }
  // The names the deployed book was measured answering on 2026-11-16. The old code interpolated the leaf into
  // `[name=…]`; `lines[0]` is not a CSS identifier, so that string throws in the browser instead of answering.
  for (const field of ["lines[0]", "lines[0].qty", "lines[3].option", "_body", "kind", "source", "claimedSubtotal", "lines"]) {
    let got;
    try {
      got = leaf(field);
    } catch (error) {
      problems.push(`${field} threw ${error.message}`);
      continue;
    }
    if (got !== null) problems.push(`${field} invented the control "${got}"`);
  }
  // Matched by name, not by selector syntax: if a page ever does name a control this way, it is found.
  if (rc.firstBadControl(["lines[0]"], [{ name: "lines[0]" }])?.name !== "lines[0]")
    problems.push("a control whose name needs escaping was not matched — that is the regression this check is for");
  // The first complaint the page can act on wins, no matter how many it cannot.
  if (rc.firstBadControl(["lines[0]", "lines[1].qty", "contact.phone", "party"], controls)?.name !== "phone")
    problems.push("the search stopped at an unactionable complaint instead of moving to the next");
  // A response can be any shape at all — the handler that reads it still has to return, not throw.
  for (const fields of [undefined, null, [], [null], [""], ["."], [[]], [{}], ["a.b.c"], 0, "party"]) {
    try {
      rc.firstBadControl(fields, controls);
    } catch (error) {
      problems.push(`firstBadControl(${JSON.stringify(fields)}) threw ${error.message}`); }
  }
  if (rc.firstBadControl(["phone"], undefined) !== null) problems.push("a missing form collection should answer null");
  return problems.length ? problems.join("; ") : true;
});


/* ----------------------------------------------------------------- summary */
describe("the When pair and the horizon the book holds");
check("the horizon the pickers stop at is the horizon the book accepts, on the day and on the time", () => {
  const problems = [];
  const dayMs = 86_400_000;
  // The book's rule is an instant comparison, so the test has to compare instants too — 23:00 in Nairobi is
  // 20:00 UTC, and a helper that only got the *date* right would still send a guest to a refusal.
  const eat = (isoDate, label) => Date.parse(`${isoDate}T${label}:00+03:00`);
  const moments = [
    Date.UTC(2026, 10, 16, 0, 5), // just past midnight in Nairobi
    Date.UTC(2026, 10, 16, 7, 0), // mid-morning there, midday elsewhere
    Date.UTC(2026, 10, 16, 20, 55), // minutes before the room closes
    Date.UTC(2027, 1, 29, 12, 0), // a leap February, so the rollover is exercised
    Date.UTC(2026, 10, 16, 15, 30), // where the edge is most likely to be rounded wrong
  ];
  for (const utc of moments) {
    const now = new Date(utc);
    const cutoff = now.getTime() + hours.HORIZON_DAYS * dayMs;
    const last = hours.lastBookableDay(now);
    // Sound: no sitting the picker offers can be refused for being too far ahead, at the latest time on the
    // shelves. This is the half that protects the guest from a 422 the cursor cannot explain (A15).
    if (eat(last, hours.CLOSE_LABEL) > cutoff)
      problems.push(`${last} at ${hours.CLOSE_LABEL} is past the horizon for now=${now.toISOString()}`);
    // Exact, not merely cautious: the very next day must already be too far at that same latest time, or the
    // helper is throwing days away that the book would have taken.
    const after = new Date(`${last}T00:00:00Z`);
    after.setUTCDate(after.getUTCDate() + 1);
    const afterIso = after.toISOString().slice(0, 10);
    if (eat(afterIso, hours.CLOSE_LABEL) <= cutoff)
      problems.push(`${afterIso} at ${hours.CLOSE_LABEL} would be accepted, so the picker stopped short for now=${now.toISOString()}`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(last)) problems.push(`lastBookableDay returned "${last}", not a date`);
  }
  /* What the bound costs, stated instead of assumed. A date input carries no clock, so the last day offered is
     the last day whose *latest* sitting fits. That is exact when the horizon falls at or after closing, and
     costs the early sittings of one day when it falls mid-afternoon. The cost is bounded — the day after the
     next is unreachable even at opening — and it is real, so both halves are asserted rather than reasoned
     about in a comment. The direction is deliberate: a day a guest cannot reach through the form beats a
     request the book records against `visitDate`, a field the form has no control named (A15). */
  const at = (iso, label) => Date.parse(`${iso}T${label}:00+03:00`);
  const plusDays = (iso, n) => {
    const d = new Date(`${iso}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  };
  for (const utc of moments) {
    const now = new Date(utc);
    const cutoff = now.getTime() + hours.HORIZON_DAYS * dayMs;
    const last = hours.lastBookableDay(now);
    if (at(plusDays(last, 2), hours.OPEN_LABEL) <= cutoff)
      problems.push(`${plusDays(last, 2)} is reachable at opening, so the picker is giving up more than one day (now=${now.toISOString()})`);
  }
  // One instant where the cost is actually paid: the horizon lands at 12:00 in Nairobi, so the next day's
  // half-six sitting would have been accepted by the book and the form will not offer it.
  const middayNow = new Date(Date.UTC(2026, 10, 16, 9, 0));
  const middayCut = middayNow.getTime() + hours.HORIZON_DAYS * dayMs;
  const middayLast = hours.lastBookableDay(middayNow);
  if (at(plusDays(middayLast, 1), hours.OPEN_LABEL) > middayCut)
    problems.push("expected this instant to show the one-day cost of the bound; it did not, so the claim above is untested");
  if (at(plusDays(middayLast, 1), hours.CLOSE_LABEL) <= middayCut)
    problems.push(`${plusDays(middayLast, 1)} at closing still fits — lastBookableDay is stopping a day too early`);
  return problems.length ? problems.join("; ") : true;
});

/* ----------------------------------------------------------------- summary */
console.log(`\n${"─".repeat(64)}`);
if (failures.length) {
  console.log(`${failures.length} FAILED · ${passed} passed`);
  for (const f of failures) console.log(`  ${f.group}\n    ${f.what}: ${f.message}`);
  process.exit(1);
}
console.log(`tests: ${passed} passed — hours, table maths, share links, gate, menu integrity, page lifecycle, request payloads`);
