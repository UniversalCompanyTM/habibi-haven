#!/usr/bin/env node
// scripts/build-content.mjs — turn the ingest into the only menu the site reads.
//
//   content/menu.source.json ─┐
//   content/taxonomy.json ────┤-> site/src/data/menu.json   (validated by src/content-schema.mjs)
//   content/menu.overrides.json┤                            (hand-authored marks, no invented copy)
//   content/image-manifest.json┘                            (written by scripts/mirror-images.mjs)
//
// It fails instead of guessing. The count assertions are the point: 243 rows in and 243 items out,
// 173 unique photographs, every item carrying a family, a section, an integer price and a photo with
// real pixel dimensions.

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { localPhotoName, slugify } from "./lib/photo-name.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const readJson = async (p) => JSON.parse(await readFile(join(ROOT, p), "utf8"));

const [source, taxonomy, overrides] = await Promise.all([
  readJson("content/menu.source.json"),
  readJson("content/taxonomy.json"),
  readJson("content/menu.overrides.json"),
]);

let manifest = { photos: {} };
try {
  manifest = await readJson("content/image-manifest.json");
} catch {
  // Absent until mirror-images.mjs has run once; the schema will refuse to write without it.
}

const { assertMenu } = await import(pathToFileURL(join(ROOT, "site/src/content-schema.mjs")).href);
const { agrees } = await import(pathToFileURL(join(ROOT, "site/src/lib/pluscode.mjs")).href);

const fail = (msg) => {
  throw new Error(msg);
};

/* ---------------------------------------------------------------- taxonomy */

const categoryToFamily = new Map();
for (const family of taxonomy.families) {
  for (const category of family.categories) {
    if (categoryToFamily.has(category)) fail(`taxonomy: category "${category}" is claimed by two families`);
    categoryToFamily.set(category, family);
  }
}

const pairs = new Map();
for (const item of source.items) {
  const key = `${item.category} > ${item.subcategory}`;
  if (!pairs.has(key)) pairs.set(key, 0);
  pairs.set(key, pairs.get(key) + 1);
}

for (const key of pairs.keys()) {
  if (!taxonomy.sections[key]) fail(`taxonomy.json has no entry for the source group "${key}"`);
  if (!categoryToFamily.has(key.split(" > ")[0])) fail(`taxonomy.families never claims "${key.split(" > ")[0]}"`);
}
for (const key of Object.keys(taxonomy.sections)) {
  if (!pairs.has(key)) fail(`taxonomy.json describes "${key}" but the ingest has no such group`);
}

/* --------------------------------------------------------------------- ids */

// A name repeated inside one group is a variant, never a duplicate: the three clashes in this menu
// are Cappuccino / Americano / Latte, each listed Single and Double. Their own description says
// which, so the id says which too. Anything else falls back to a numeric suffix.
const usedIds = new Set();
function makeId(item) {
  const base = slugify(item.name);
  const candidates = [base, slugify(`${item.name} ${item.description}`)];
  for (const candidate of candidates) {
    if (candidate && !usedIds.has(candidate)) {
      usedIds.add(candidate);
      return candidate;
    }
  }
  let n = 2;
  while (usedIds.has(`${base}-${n}`)) n += 1;
  usedIds.add(`${base}-${n}`);
  return `${base}-${n}`;
}

/* ------------------------------------------------------------------- tags */

const tagFields = (item) => ({
  text: `${item.name} ${item.description}`.toLowerCase(),
  category: item.category.toLowerCase(),
  subcategory: item.subcategory.toLowerCase(),
});

function tagsFor(item) {
  const fields = tagFields(item);
  const tags = [];
  for (const rule of taxonomy.tagRules) {
    const haystack = fields[rule.field] ?? "";
    if (rule.tokens.some((token) => haystack.includes(token))) tags.push(rule.tag);
  }
  return tags;
}

/* -------------------------------------------------------------- overrides */

const byName = new Map();
for (const item of source.items) {
  const list = byName.get(item.name) ?? [];
  list.push(item);
  byName.set(item.name, list);
}
function resolveName(name, what) {
  const hits = byName.get(name) ?? [];
  if (hits.length === 0) fail(`overrides: ${what} names "${name}", which is not in the ingest`);
  if (hits.length > 1)
    fail(`overrides: ${what} names "${name}", which matches ${hits.length} rows — name it more exactly`);
  return hits[0];
}

// The position in `overrides.signature` is the order the home page tells the story in (goat → grill
// → biryani → bakery → chai). Menu traversal order is alphabetical-ish by taxonomy, so the authored
// index has to travel with the row or the sequence is lost at build time.
const signatureByRow = new Map();
(overrides.signature ?? []).forEach((s, order) => {
  signatureByRow.set(resolveName(s.name, "signature").id, { role: s.role, order });
});
const tableFormatByRow = new Map();
for (const t of overrides.tableFormats ?? []) {
  tableFormatByRow.set(resolveName(t.name, "tableFormats").id, t);
}
const overrideDescriptions = overrides.descriptions ?? {};
const extraTags = overrides.extraTags ?? {};

/* ------------------------------------------------------------------ build */

const sectionsByKey = new Map();
const itemsBySection = new Map();
const usedSectionIds = new Set();
const tagTally = new Map();
const missingPhoto = [];

for (const row of source.items) {
  const key = `${row.category} > ${row.subcategory}`;
  const family = categoryToFamily.get(row.category);
  const entry = taxonomy.sections[key];

  if (!sectionsByKey.has(key)) {
    let id = slugify(entry.label);
    if (usedSectionIds.has(id)) id = slugify(`${entry.label} ${row.category}`);
    if (usedSectionIds.has(id)) fail(`section id "${id}" still collides`);
    usedSectionIds.add(id);
    sectionsByKey.set(key, { id, label: entry.label, source: key, family: family.id, items: [] });
    itemsBySection.set(key, []);
  }
  const section = sectionsByKey.get(key);

  const description = overrideDescriptions[row.name] ?? row.description;
  if (typeof description !== "string") fail(`description for "${row.name}" is not a string`);

  const local = localPhotoName(row.image);
  const photo = manifest.photos?.[local];
  if (row.image && !photo) missingPhoto.push(`${row.name} -> ${local}`);
  // 102 of their 243 rows currently point at a placeholder upload named "Image to be updated soon".
  // The byte is mirrored so nothing 404s, but the item is marked so the UI never passes a
  // placeholder off as a photograph of the dish — see docs/OPEN-QUESTIONS.md.
  const placeholder = /image-to-be-updated/i.test(local || "");

  const tags = tagsFor(row);
  const signature = signatureByRow.get(row.id);
  if (signature) tags.push("signature");
  for (const t of extraTags[row.name] ?? []) if (!tags.includes(t)) tags.push(t);
  for (const t of tags) tagTally.set(t, (tagTally.get(t) || 0) + 1);

  section.items.push({
    id: makeId(row),
    name: row.name,
    description,
    price: row.price,
    family: family.id,
    section: section.id,
    source: { category: row.category, subcategory: row.subcategory, row: row.id, sortOrder: row.sortOrder },
    availability: { open: row.available, inStock: row.inStock },
    tags,
    ...(tableFormatByRow.has(row.id) ? { tableFormat: tableFormatByRow.get(row.id) } : {}),
    ...(signature ? { signatureRole: signature.role, signatureOrder: signature.order } : {}),
    accompaniments: row.accompaniments
      ? { pick: row.accompaniments.pick, required: !!row.accompaniments.required, options: row.accompaniments.options }
      : null,
    photo: row.image
      ? {
          local: photo ? `/menu/${photo.file}` : null,
          thumb: photo ? `/menu/${photo.thumb}` : null,
          remote: row.image,
          width: photo?.width ?? null,
          height: photo?.height ?? null,
          placeholder,
          alt: placeholder ? `${row.name} — photograph pending from the restaurant` : row.name,
        }
      : { local: null, thumb: null, remote: null, width: null, height: null, placeholder: true, alt: row.name },
  });
}

if (missingPhoto.length) {
  fail(
    `${missingPhoto.length} photograph(s) referenced by the menu are not in content/image-manifest.json. ` +
      `Run node scripts/mirror-images.mjs first.\n  ${missingPhoto.slice(0, 5).join("\n  ")}`,
  );
}

// Sections appear in the order they are written in taxonomy.json, which is the order of a printed
// menu; a family's categories keep the order they are listed in too.
const orderedKeys = new Map();
for (const key of Object.keys(taxonomy.sections)) {
  const category = key.split(" > ")[0];
  if (!orderedKeys.has(category)) orderedKeys.set(category, []);
  orderedKeys.get(category).push(key);
}

const families = taxonomy.families.map((family) => {
  const sections = family.categories.flatMap((category) => orderedKeys.get(category) ?? []).map((key) =>
    sectionsByKey.get(key),
  ).filter(Boolean).map((s) => ({
    id: s.id,
    label: s.label,
    source: s.source,
    family: s.family,
    count: s.items.length,
    items: s.items,
  }));
  return {
    id: family.id,
    label: family.label,
    ...(family.line ? { line: family.line } : {}),
    ...(family.opens ? { opens: family.opens } : {}),
    sectionCount: sections.length,
    itemCount: sections.reduce((n, s) => n + s.items.length, 0),
    sections,
  };
});

const allItems = families.flatMap((f) => f.sections.flatMap((s) => s.items));
const prices = allItems.map((i) => i.price).sort((a, b) => a - b);
const median = prices.length
  ? prices.length % 2
    ? prices[(prices.length - 1) / 2]
    : Math.round((prices[prices.length / 2 - 1] + prices[prices.length / 2]) / 2)
  : 0;
const uniquePhotos = new Set(allItems.map((i) => i.photo.remote).filter(Boolean));

const menu = {
  meta: {
    name: "Habibi Haven Restaurant",
    sourceEndpoint: source.meta.endpoint,
    sourcePage: source.meta.livePage,
    capturedAt: source.meta.capturedAt,
    sourceFingerprint: source.meta.fingerprint,
    newestSourceUpdate: source.meta.newestRowUpdatedAt,
    items: allItems.length,
    photos: uniquePhotos.size,
    families: families.length,
    sections: families.reduce((n, f) => n + f.sectionCount, 0),
    described: allItems.filter((i) => i.description).length,
    placeholderPhotos: allItems.filter((i) => i.photo.placeholder).length,
    realPhotos: allItems.filter((i) => !i.photo.placeholder).length,
    priceRange: { min: prices[0], max: prices[prices.length - 1] },
    median,
    currency: "KES",
    // Every factual line here traces to research/BRAND-FACTS.md; the site reads these, not markup.
    facts: {
      rating: 4.5,
      reviews: 541,
      pricePerPerson: "Ksh 1,000–2,000",
      phone: "+254116880000",
      whatsapp: "254116880000",
      address: "Koinange Street, Nairobi CBD",
      plusCode: "PR99+82",
      // GPS, published with its source named. This is not a coordinate we found: it is the centre of the
      // ~14 m cell that the venue's OWN published plus code (PR99+82) denotes, recovered against a reference
      // near the venue and checked digit by digit — `6GCRPR99+82`, centre -1.281687, 36.817562. OpenStreetMap
      // snaps the point onto Koinage Street, its spelling of the published address, but has no node for the
      // venue, so the chain rests on one source rather than two. research/tools/pluscode.mjs is the method
      // and docs/OPEN-QUESTIONS.md §9 is the argument; the assertion below is the guard. Owner confirmation
      // is still outstanding — see the `coordinatesSource` string, which is what the page prints.
      coordinates: { latitude: -1.281687, longitude: 36.817562 },
      coordinatesSource:
        "decoded from the venue's published plus code PR99+82 (full form 6GCRPR99+82); centre of a ~14 m cell; not yet confirmed by Habibi Haven",
      mapsQuery: "Habibi Haven Koinange Street Nairobi",
      hoursOfRecord: { open: "06:30", close: "23:00", days: "Mon–Sun", zone: "Africa/Nairobi" },
      hoursDisagreements: [
        { value: "06:00–23:00", where: "menu.or.ke live page" },
        { value: "09:00–17:00", where: "Uber Eats store, flagged Currently unavailable" },
      ],
      socials: {
        instagram: "https://www.instagram.com/habibi.haven",
        tiktok: "https://www.tiktok.com/@habibi.haven",
        facebook: "https://www.facebook.com/profile.php?id=61575101935569",
        order: "https://menu.or.ke/Habibi_Haven/habibi-haven.html",
      },
      googleReviews: [
        { theme: "welcoming staff", mentions: 13 },
        { theme: "friendly supervisor", mentions: 11 },
      ],
    },
  },
  families,
};

/* ------------------------------------------------------------- assertions */

const inRows = source.items.length;
if (allItems.length !== inRows) fail(`count: ${inRows} rows in, ${allItems.length} items out`);
if (uniquePhotos.size !== source.meta.uniquePhotos)
  fail(`count: ${uniquePhotos.size} unique photos here, ingest saw ${source.meta.uniquePhotos}`);
if (new Set(allItems.map((i) => i.id)).size !== allItems.length) fail("item ids are not unique");

// The signature sequence has to be a gapless 0..n-1 in the *authored* sense: traversal order
// (alphabetical by taxonomy) is not story order, so the check is on the set of indices, not on the
// order they appear in. A typo'd or duplicated position would otherwise drop a dish off the home
// page's signature run with nothing downstream able to tell.
const signatureOrders = allItems.filter((i) => i.signatureRole).map((i) => i.signatureOrder);
if (new Set(signatureOrders).size !== signatureOrders.length)
  fail(`signature order repeats: ${signatureOrders}`);
const expectedOrders = signatureOrders.map((_, i) => i).join(",");
if ([...signatureOrders].sort((a, b) => a - b).join(",") !== expectedOrders)
  fail(`signature order must be a gapless 0..${signatureOrders.length - 1}, got ${[...signatureOrders].sort((a, b) => a - b)}`);
for (const spec of taxonomy.families) {
  const built = families.find((f) => f.id === spec.id);
  const expected = spec.categories.reduce((n, c) => n + source.items.filter((r) => r.category === c).length, 0);
  if (!built) fail(`family ${spec.id} produced no output`);
  if (expected !== built.itemCount) fail(`family ${spec.id}: expects ${expected}, built ${built.itemCount}`);
}

assertMenu(menu);

// The two location claims in `facts` have to be the same place.
//
// `plusCode` is the venue's own published code and `coordinates` is the centre of that code's ~14 m cell,
// recovered by hand in research/tools/pluscode.mjs. Both are hand-typed into this file, and the distance
// between a correct digit and a wrong one is 111 m — comfortably enough to leave Koinange Street. So the
// build re-derives the code from the coordinates and compares it with the code it also publishes; if
// somebody edits one half and not the other, or the owner hands over a real pin and the plus code behind
// it changes, the content step fails instead of a guest arriving at a different door.
{
  const { latitude, longitude } = menu.meta.facts.coordinates;
  const pin = menu.meta.facts.plusCode;
  const check = agrees(latitude, longitude, pin);
  if (!check.matches)
    fail(
      `${latitude}, ${longitude} names cell ${check.short} but the site publishes ${pin} — ` +
        `the coordinates and the plus code are different places`,
    );
}

await mkdir(join(ROOT, "site/src/data"), { recursive: true });
await writeFile(join(ROOT, "site/src/data/menu.json"), JSON.stringify(menu, null, 1) + "\n", "utf8");
await mkdir(join(ROOT, "content"), { recursive: true });
await writeFile(
  join(ROOT, "content/menu-ids.json"),
  JSON.stringify(
    {
      comment: "Baseline for scripts/check-drift.mjs: the item ids the site is currently shipping.",
      capturedAt: source.meta.capturedAt,
      sourceFingerprint: source.meta.fingerprint,
      ids: allItems.map((i) => i.id).sort(),
    },
    null,
    1,
  ) + "\n",
  "utf8",
);

// One place that turns a JS string into a SQLite literal. `wrangler d1 execute` takes a file, not
// parameters, so this build has to quote: doubling the apostrophe is the whole of SQL escaping for a
// text literal, and the control-character check is here because a name carrying a NUL or a newline would
// break the statement into something else — dish names come from their API, so "should not" is not a
// proof. Data with a real newline in a name is a content bug worth failing the build over, not a bug
// worth shipping a truncated order record over.
function sqlText(value, where) {
  const s = String(value);
  if (/[\u0000-\u001f\u007f]/.test(s)) fail(`${where}: control character in ${JSON.stringify(s)}`);
  if (s.length > 200) fail(`${where}: ${s.length} characters is beyond a dish name`);
  return `'${s.replace(/'/g, "''")}'`;
}

function seedSql(catalog) {
  const rows = catalog.items.map(
    (i) =>
      `INSERT INTO prices (item_id, name, unit_kes, available, updated_at) VALUES (` +
      `${sqlText(i.id, `item ${i.id}`)}, ${sqlText(i.name, `item ${i.id}`)}, ${i.priceKes}, ` +
      `${i.available ? 1 : 0}, ${sqlText(catalog.dataStamp, `item ${i.id} stamp`)}) ` +
      `ON CONFLICT (item_id) DO UPDATE SET name = excluded.name, unit_kes = excluded.unit_kes, ` +
      `available = excluded.available, updated_at = excluded.updated_at;`,
  );
  const setting = (key, value) =>
    `INSERT INTO settings (key, value, updated_at) VALUES (${sqlText(key, key)}, ${sqlText(value, key)}, ` +
    `${sqlText(catalog.dataStamp, `${key} stamp`)}) ON CONFLICT (key) DO UPDATE SET value = excluded.value, ` +
    `updated_at = excluded.updated_at;`;

  return [
    `-- backend/seed.sql — GENERATED by scripts/build-content.mjs. Do not edit; re-run the build.`,
    `-- ${catalog.items.length} priced rows as the kitchen's own data had them at ${catalog.dataStamp}.`,
    `-- Apply with:  npx wrangler d1 execute habibi-haven-preview --file backend/seed.sql --remote`,
    ``,
    ...rows,
    ``,
    `-- Rows from an earlier stamp are dishes the kitchen no longer sells.`,
    `DELETE FROM prices WHERE updated_at < ${sqlText(catalog.dataStamp, "dataStamp")};`,
    ``,
    setting("hoursOfRecord", JSON.stringify(catalog.hoursOfRecord)),
    setting("dataStamp", catalog.dataStamp),
    setting("sourceFingerprint", catalog.sourceFingerprint),
    ``,
  ].join("\n");
}

/* ------------------------------------------------------------------ server */

// The API's own price list, out of the same object the site renders.
//
// Two artifacts, one build. `backend/catalog.json` is the data — tests/api.mjs seeds a real SQLite
// database from it and checks the server's arithmetic against it. `backend/seed.sql` is the same rows as
// UPSERTs, which is what `wrangler d1 execute --file` applies to the deployed database. Emitting both here
// is the point: the price a guest reads on /menu and the price the server writes into an order record
// cannot be edited apart, they can only both be re-built.
//
// The DELETE is not decoration. A row left from an older data stamp is a dish the kitchen has dropped, and
// a server that still accepts that id will happily record an order for something nobody serves — which is
// the kind of thing a restaurant finds out about at the table.
{
  const items = allItems.map((i) => ({
    id: i.id,
    name: i.name,
    priceKes: i.price,
    available: Boolean(i.availability?.open && i.availability?.inStock),
  }));
  if (items.length !== menu.meta.items) fail(`catalog: ${items.length} priced rows against ${menu.meta.items} items`);
  const stamp = source.meta.capturedAt;
  if (!stamp) fail("catalog: the source snapshot carries no capturedAt to stamp the price list with");

  const catalog = {
    comment: "Generated by scripts/build-content.mjs. Do not edit: the API quotes money from these rows.",
    dataStamp: stamp,
    sourceFingerprint: source.meta.fingerprint,
    // Only the window, not the days: the hours of record are 06:30–23:00 every day, and a per-day
    // exception is exactly the kind of thing Habibi has not confirmed yet (docs/OPEN-QUESTIONS.md §4).
    hoursOfRecord: { open: menu.meta.facts.hoursOfRecord.open, close: menu.meta.facts.hoursOfRecord.close },
    items,
  };

  await mkdir(join(ROOT, "backend"), { recursive: true });
  await writeFile(join(ROOT, "backend/catalog.json"), JSON.stringify(catalog, null, 1) + "\n", "utf8");
  await writeFile(join(ROOT, "backend/seed.sql"), seedSql(catalog), "utf8");
}

/* -------------------------------------------------------------- reporting */

const kb = (n) => `${(n / 1024).toFixed(0)} KB`;
const size = new TextEncoder().encode(JSON.stringify(menu, null, 1)).length;
console.log(
  `build-content: ${menu.meta.items} items · ${menu.meta.photos} photos · ` +
    `${menu.meta.families} families · ${menu.meta.sections} sections · ` +
    `KSh ${menu.meta.priceRange.min}–${menu.meta.priceRange.max} (median ${menu.meta.median}) · ` +
    `${menu.meta.described} with descriptions\n` +
    `             ${menu.meta.realPhotos} items on a real photograph, ${menu.meta.placeholderPhotos} on their ` +
    `"Image to be updated soon" placeholder — the UI renders those as type cards, never as food\n` +
    `             site/src/data/menu.json ${kb(size)}`,
);
for (const f of families) {
  console.log(`  ${f.label.padEnd(14)} ${String(f.itemCount).padStart(3)} items · ${f.sectionCount} sections`);
}
console.log(
  "  tags: " +
    [...tagTally.entries()].sort((a, b) => b[1] - a[1]).map(([t, n]) => `${t} ${n}`).join(" · "),
);
