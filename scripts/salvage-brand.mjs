// One-time salvage: copy the authentic brand assets out of the Relume capture
// into habibi-haven-site/brand/, deduped by content hash, with real pixel
// dimensions read from the JPEG headers. Writes brand/ASSETS.md.
//
// Run from the workspace root:  node habibi-haven-site/scripts/salvage-brand.mjs
//
// Reads only from ../habibi-haven/assets; writes only into ./brand.
// The "seen" column is what the image actually shows, checked by opening each file.

import { readFile, writeFile, mkdir, readdir, copyFile, rm, access } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";

const SRC = join(import.meta.dirname, "..", "..", "habibi-haven", "assets");
const OUT = join(import.meta.dirname, "..", "brand");

// The capture was deleted once this salvage proved lossless, so a second run has nothing to read.
try {
  await access(SRC);
} catch {
  console.log(`Nothing to salvage: ${SRC} no longer exists.\nbrand/ is already populated — see brand/ASSETS.md (15 files, hashes and pixel sizes recorded there).`);
  process.exit(0);
}

// uuid, dir, filename, kind, what is actually in the frame
const MAP = [
  ["9be762e0-a819-4d7e-a893-d2e50854b801.jpg", "logo", "habibi-haven-badge.jpg", "logo",
    "Circular badge: teal mandala ring, HABIBI HAVEN around the top, HH monogram centre, RESTAURANT below. The mark the capture used in nav and footer."],
  ["158c0e20-0f52-4e1a-941b-20a36603a501.jpg", "photos", "venue-facade-night.jpg", "venue",
    "Night exterior: stone facade, lit HABIBI ● HAVEN sign, trees wrapped in festoon lights, a HAPPY NEW YEAR sign, green neon reading Habibi Eat…"],
  ["3e1eb84c-7792-44b4-4dcd-46f31ef22b01.jpg", "photos", "venue-facade-day.jpg", "venue",
    "The same facade in daylight, circular badge mounted between the two words of the sign. (The capture's alt text calls this \"Habibi Haven courtyard\" — the alt is wrong.)"],
  ["a8f2189c-fa62-407e-3dc0-e2690b5b6701.jpg", "photos", "venue-interior-teal-sofa.jpg", "venue",
    "Interior: arched timber branch structure, curved teal velvet banquette, yellow neon heart on the wall."],
  ["dfd6439a-6898-4cd9-743e-40d82eb38501.jpg", "photos", "venue-courtyard-arches.jpg", "venue",
    "The arches canopy: timber ribs springing from a brick half-wall, hanging lanterns, dense greenery overhead."],
  ["ed128e7f-6a28-464e-f210-9a1683ff5201.jpg", "photos", "venue-terrace-seating.jpg", "venue",
    "Outdoor terrace: stone paving with grass in the joints, wooden tables, teal banquettes, lanterns and a green canopy."],
  ["268a86ac-c2e8-486a-ef00-13b586c01101.jpg", "photos", "venue-table-branded-cup.jpg", "venue",
    "A laid wooden table: cup and saucer carrying the habibi script, small brass pot, hot-sauce bottles, wrapped cutlery."],
  ["caf47069-daf7-4022-6bf7-518074fc5e01.jpg", "photos", "venue-table-mid-meal.jpg", "venue",
    "Terrace table mid-meal: iced frappe, yellow cushion, sauce bottles, dates, menu card."],
  ["0d3e2f4f-c1f5-43cd-f09b-b3e14bb33401.jpg", "photos", "venue-terrace-table-city.jpg", "venue",
    "Near-identical framing of the same terrace table, CBD tower rising behind the greenery."],
  ["5384eef6-95d2-4992-0cef-2d138eefbb01.jpg", "photos", "venue-table-by-window.jpg", "venue",
    "Table setting with greenery in front and Nairobi towers behind."],
  ["38d359e7-e3ca-4da9-d332-efda13c8be01.jpg", "photos", "food-grilled-sandwich-fries.jpg", "food",
    "Grilled sandwich with chips, slaw and a sauce jug."],
  ["c829f67f-cfca-43a6-1225-e2bb9b25f501.jpg", "photos", "food-chicken-sandwich-fries.jpg", "food",
    "Pressed chicken sandwich, fries and slaw on a wooden board."],
  ["22ea3a60-6bc2-49f7-b1e5-d8bda25da701.jpg", "photos", "food-tea-service.jpg", "food",
    "White teapot and a cup of karak chai on a habibi-scripted saucer."],
  ["6a89635e167fcf950ee07ee4_icon-google-no-bg-colour.svg", "third-party", "google-g.svg", "icon",
    "Google mark, vector — used to attribute the review quotes."],
  ["6ad21e07314202a71e6e2a93_icon-google-colour-safari_201.png", "third-party", "google-g.png", "icon",
    "Google mark, raster variant of the same icon."],
];

// jpeg SOF marker -> width/height; svg -> viewBox only
function dimensions(buf) {
  const head = buf.subarray(0, 5).toString("latin1");
  if (head.startsWith("<?xml") || head.startsWith("<svg")) {
    const vb = buf.toString("utf8").match(/viewBox="([^"]+)"/);
    return vb ? `viewBox ${vb[1]}` : "vector";
  }
  let i = 2;
  while (i < buf.length) {
    if (buf[i] !== 0xff) { i++; continue; }
    const marker = buf[i + 1];
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      return `${buf.readUInt16BE(i + 7)}×${buf.readUInt16BE(i + 5)}`;
    }
    i += 2 + buf.readUInt16BE(i + 2);
  }
  return "unknown";
}

await rm(join(OUT, "photos"), { recursive: true, force: true });
await rm(join(OUT, "logo"), { recursive: true, force: true });
await rm(join(OUT, "third-party"), { recursive: true, force: true });

const copiedHash = new Map();
const rows = [];

for (const [uuid, dir, name, kind, seen] of MAP) {
  const buf = await readFile(join(SRC, uuid));
  const hash = createHash("sha256").update(buf).digest("hex").slice(0, 12);
  await mkdir(join(OUT, dir), { recursive: true });
  await copyFile(join(SRC, uuid), join(OUT, dir, name));
  copiedHash.set(hash, `${dir}/${name}`);
  rows.push({ uuid, name: `${dir}/${name}`, kind, kb: (buf.length / 1024).toFixed(1), dims: dimensions(buf), hash, seen });
}

// lossless proof: hash EVERY file left in the capture. Anything whose bytes are not
// already represented in brand/ would be a real loss and gets reported loudly.
const all = (await readdir(SRC)).filter((f) => f !== "MANIFEST.json").sort();
const mapped = new Set(MAP.map((m) => m[0]));
const lost = [];
const dupSets = new Map();
for (const f of all) {
  const h = createHash("sha256").update(await readFile(join(SRC, f))).digest("hex").slice(0, 12);
  if (!copiedHash.has(h)) lost.push(f);
  else if (!mapped.has(f)) dupSets.set(f, copiedHash.get(h));
}

const manifest = await readFile(join(SRC, "MANIFEST.json"), "utf8").then((s) => JSON.parse(s));
const altOf = new Map(manifest.map((a) => [a.file, (a.alt || []).join(" · ") || "—"]));

const venue = rows.filter((r) => r.kind === "venue").length;
const food = rows.filter((r) => r.kind === "food").length;
const sizes = [...new Set(rows.filter((r) => r.kind !== "icon").map((r) => r.dims))].sort();

const md = [
  "# Habibi Haven — real brand assets",
  "",
  "Salvaged 2026-11-14 from the image set the restaurant's own abandoned Relume project used",
  "(`habibi-haven/assets/`, deleted after this ran — the script is a one-time record of the copy).",
  "These are the **only local copies** of the real logo and the real venue",
  "photography. The CDN URLs in the capture were signed and expire; these bytes do not.",
  "",
  "This corrects an earlier research note that said Habibi had no logo file and no venue",
  "photography. That was wrong: it was based on probing menu.or.ke's Supabase buckets (which hold",
  "dish photos only) and on never opening the capture's own asset manifest. See",
  "`../research/BRAND-FACTS.md` §6.",
  "",
  "## What is in hand",
  "",
  `- **1 logo** — \`logo/habibi-haven-badge.jpg\`, a 200×200 raster of the circular teal badge. No vector original exists locally.`,
  `- **${venue} venue photographs** — night facade (1200×1200), daylight facade, the timber arches, the teal-sofa interior, the terrace, four table settings, the window table.`,
  `- **${food} food photographs** — two sandwich plates and the karak chai service.`,
  "- **2 Google marks** — for attributing the review quotes.",
  "",
  "## Inventory",
  "",
  "| file | size | pixels | sha256/12 | what is actually in the frame |",
  "|---|---|---|---|---|",
  ...rows.map((r) => `| \`${r.name}\` | ${r.kb} KB | ${r.dims} | \`${r.hash}\` | ${r.seen} |`),
  "",
  "Authored alt text in the capture was generic (\"Guest photo at Habibi Haven\") and in one case",
  "wrong, so the descriptions above come from opening each file, not from its metadata.",
  "",
  "## Deleting the capture is lossless",
  "",
  lost.length
    ? `**LOSS DETECTED** — these files have no byte-identical copy in \`brand/\`: ${lost.join(", ")}`
    : `All ${all.length} files in the capture are accounted for: ${mapped.size} copied, and the ${dupSets.size} below are byte-identical duplicates of a file that was. Nothing is lost by removing the capture.`,
  "",
  ...(dupSets.size
    ? ["| capture file (second CDN id, not copied) | identical to |", "|---|---|", ...[...dupSets].map(([u, kept]) => `| \`${u}\` | \`${kept}\` |`)]
    : []),
  "",
  "## Resolution reality",
  "",
  `Measured from the headers, the set spans ${sizes.join(", ")}. Only the night facade is large;`,
  "most venue and food shots are 300×225 — thumbnail size. Blown up to a hero they will read soft,",
  "so the layout uses them as cards and proofs of the room, and the one 1200×1200 frame is the only",
  "candidate for a full-bleed image.",
  "",
  "## What the real assets say about the brand",
  "",
  "The logo and the signage are **teal-forward**, not gold. The room is timber arches, a green",
  "canopy, hanging lanterns, teal banquettes and stone paving with grass in the joints — the",
  "\"garden haven\" line in the existing copy is describing something that is actually there. Tableware",
  "carries a \"habibi\" script mark. Any palette or scene work has to start from these observations.",
  "",
  "## Status",
  "",
  "Reference assets for a **private pitch preview**, not cleared for publication. Photo ownership and",
  "the original logo file are open questions for the client call — `../docs/OPEN-QUESTIONS.md`.",
].join("\n");

await writeFile(join(OUT, "ASSETS.md"), md + "\n", "utf8");
console.log(md);
