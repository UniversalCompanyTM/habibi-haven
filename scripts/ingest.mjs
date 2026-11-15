#!/usr/bin/env node
// scripts/ingest.mjs — read Habibi Haven's own menu data out of their system of record.
//
// Channel (decided by M0, see research/probe-ingest.log and Amendment A4):
//   A plain GET of https://menu.or.ke/Habibi_Haven/habibi-haven.html returns a 33 KB JavaScript
//   shell with no prices in it, and one headless render only exposes the first section because the
//   page loads lazily. The shell itself reveals the real data path: the page queries Supabase
//   PostgREST directly with a *publishable* key (`sb_publishable_…`) that is embedded in its public
//   HTML for the browser to use. Reading that endpoint with the same filter the page uses
//   (restaurant_slug=eq.habibi-haven) is the same request the restaurant is already serving to every
//   visitor, and it returns all 243 rows in one paged pass instead of 6.
//
// Limits observed here: read-only GET/POST-list, one restaurant's rows, the publishable key only.
// No service-role key is used or stored, nothing is written to their database, and no other
// restaurant's data is fetched. The bucket was separately confirmed public (M0: 6/6 sampled objects
// answered HTTP 200 to a plain fetch), which is why mirroring does not need a signed URL.
//
// Outputs
//   content/menu.source.json  the raw-ish ingest (never imported by the site)
//   content/drift.md          what changed against the previously committed ingest
//
// Usage:  node scripts/ingest.mjs [--out <file>] [--quiet]

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { createHash } from "node:crypto";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

// Verbatim from line 411 of the captured live page (research/menu-page.html).
const SB_URL = "https://glxxyespnkittvoiejtk.supabase.co";
const SB_KEY = "sb_publishable_Q-wmw1pwKT6Z2E7boHF3mg_Trr5SRnB";
const SLUG = "habibi-haven";
const PAGE = 500;

const args = process.argv.slice(2);
const outFlag = args.indexOf("--out");
const OUT = outFlag >= 0 ? resolve(args[outFlag + 1]) : join(ROOT, "content/menu.source.json");
const QUIET = args.includes("--quiet");

const HEADERS = {
  apikey: SB_KEY,
  Authorization: `Bearer ${SB_KEY}`,
  Accept: "application/json",
};

async function fetchRows() {
  const rows = [];
  for (let offset = 0; ; offset += PAGE) {
    const url =
      `${SB_URL}/rest/v1/menu_items` +
      `?select=id,name,category,subcategory,description,price,image_url,is_available,in_stock,accompaniments,sort_order,updated_at` +
      `&restaurant_slug=eq.${SLUG}` +
      `&order=sort_order.asc,id.asc&limit=${PAGE}&offset=${offset}`;
    const res = await fetch(url, { headers: HEADERS });
    if (!res.ok) {
      throw new Error(`ingest failed: HTTP ${res.status} ${await res.text()}`);
    }
    const batch = await res.json();
    rows.push(...batch);
    if (batch.length < PAGE) return rows;
  }
}

/** Their data carries stray double spaces and pipe-variants ("Arosto |  Full"). */
function clean(s) {
  return String(s ?? "").replace(/\s+/g, " ").trim();
}

function shape(rows) {
  return rows.map((r) => ({
    id: r.id,
    name: clean(r.name),
    category: clean(r.category),
    subcategory: clean(r.subcategory),
    description: clean(r.description),
    price: Number(r.price),
    image: r.image_url ?? "",
    available: r.is_available !== false,
    inStock: r.in_stock !== false,
    accompaniments: r.accompaniments ?? null,
    sortOrder: r.sort_order,
    updatedAt: r.updated_at,
  }));
}

function fingerprint(items) {
  const canon = items
    .map((i) => `${i.id}|${i.name}|${i.category}|${i.subcategory}|${i.price}|${i.inStock}|${i.image}`)
    .sort()
    .join("\n");
  return createHash("sha256").update(canon).digest("hex").slice(0, 16);
}

function index(items) {
  // Keyed by their row id, not by name: "Cappuccino (Single)" and "Cappuccino (Double)" are two
  // rows with the same name, and a price change on one of them must not be invisible.
  const map = new Map();
  for (const i of items) map.set(i.id, i);
  return map;
}

const label = (i) => `${i.name} — ${i.category} › ${i.subcategory}`;

function driftMarkdown(prev, next, capturedAt) {
  const a = index(prev);
  const b = index(next);
  const added = [...b.keys()].filter((id) => !a.has(id));
  const gone = [...a.keys()].filter((id) => !b.has(id));
  const changed = [];
  for (const [id, item] of b) {
    const old = a.get(id);
    if (!old) continue;
    const fields = [];
    if (old.name !== item.name) fields.push(`renamed “${old.name}” → “${item.name}”`);
    if (old.price !== item.price) fields.push(`price ${old.price} → ${item.price}`);
    if (old.inStock !== item.inStock) fields.push(`in stock ${old.inStock} → ${item.inStock}`);
    if (old.available !== item.available) fields.push(`available ${old.available} → ${item.available}`);
    if (old.image !== item.image) fields.push("photo changed");
    if (old.description !== item.description) fields.push("description changed");
    if (old.category !== item.category || old.subcategory !== item.subcategory)
      fields.push(`group ${old.category}›${old.subcategory} → ${item.category}›${item.subcategory}`);
    if (fields.length) changed.push({ k: label(item), fields });
  }
  const lines = [
    "# Menu drift report",
    "",
    `Generated by \`scripts/ingest.mjs\` on ${capturedAt}.`,
    "",
    "Compared: the previously committed `content/menu.source.json` against a fresh read of",
    "`menu_items` for `habibi-haven`. Rows are matched on their own `id`, so a rename reads as a",
    "change to an existing dish instead of a dish appearing and another disappearing.",
    "",
    "Nothing here is applied to the site until `scripts/build-content.mjs` is re-run and the result",
    "reviewed — an unreviewed upstream change makes `scripts/check-drift.mjs` exit non-zero.",
    "",
    `**${prev.length} items → ${next.length} items.**`,
    "",
  ];
  const section = (title, rows) => {
    lines.push(`## ${title} (${rows.length})`, "");
    if (!rows.length) lines.push("_None._", "");
    else for (const r of rows) lines.push(r);
  };
  section(
    "Added",
    added.map((id) => {
      const i = b.get(id);
      return `- ${label(i)} — KSh ${i.price.toLocaleString("en-KE")} (row id ${id})`;
    }),
  );
  section(
    "Removed",
    gone.map((id) => {
      const i = a.get(id);
      return `- ${label(i)} — was KSh ${i.price.toLocaleString("en-KE")} (row id ${id})`;
    }),
  );
  section("Changed", changed.map((c) => `- ${c.k} — ${c.fields.join(", ")}`));
  const subcats = new Map();
  for (const i of next) {
    const key = `${i.category} > ${i.subcategory}`;
    subcats.set(key, (subcats.get(key) || 0) + 1);
  }
  lines.push(`## Groups in this read (${subcats.size})`, "");
  for (const [k, n] of subcats) lines.push(`- ${k} — ${n}`);
  lines.push("");
  return lines.join("\n");
}

let previous = null;
try {
  previous = JSON.parse(await readFile(OUT, "utf8"));
} catch {
  previous = null;
}

const rows = await fetchRows();
const items = shape(rows);
if (items.length < 200) throw new Error(`suspiciously few rows (${items.length}) — refusing to write`);
if (new Set(items.map((i) => i.id)).size !== items.length) throw new Error("duplicate row ids");

const capturedAt = new Date().toISOString();
const payload = {
  meta: {
    capturedAt,
    channel: "Supabase PostgREST menu_items, read with the publishable key the live page embeds",
    endpoint: `${SB_URL}/rest/v1/menu_items`,
    restaurantSlug: SLUG,
    livePage: "https://menu.or.ke/Habibi_Haven/habibi-haven.html",
    rows: items.length,
    uniquePhotos: new Set(items.map((i) => i.image).filter(Boolean)).size,
    fingerprint: fingerprint(items),
    newestRowUpdatedAt: items.map((i) => i.updatedAt).sort().pop(),
  },
  items,
};

await mkdir(dirname(OUT), { recursive: true });
await writeFile(OUT, JSON.stringify(payload, null, 1) + "\n", "utf8");

if (!QUIET) {
  const driftPath = join(ROOT, "content/drift.md");
  await writeFile(driftPath, driftMarkdown(previous?.items ?? [], items, capturedAt), "utf8");
  console.log(
    `ingest: ${items.length} items, ${payload.meta.uniquePhotos} unique photos, ` +
      `fingerprint ${payload.meta.fingerprint} -> ${OUT.replace(ROOT + "\\", "").replace(ROOT + "/", "")}` +
      (previous ? "" : " (first read — no previous ingest to diff)"),
  );
}
