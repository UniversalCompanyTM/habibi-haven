#!/usr/bin/env node
// scripts/mirror-images.mjs — bring the 173 dish photographs into the repo.
//
// Why copy them at all: the bytes live in menu.or.ke's Supabase bucket, which the restaurant pays
// for and can rename, delete or lock at any time. A site that hotlinks it shows broken cards the
// first time their platform moves. M0 measured this (research/probe-ingest.log): 6 of 6 sampled
// objects answered HTTP 200 to a plain fetch and decoded at 1000×1000, so copying is possible
// without credentials — it is the same public read the restaurant's own page performs.
//
// What gets stored: web-sized derivatives, not the originals. A 1000×1000 dish photo is 350 KB–1 MB;
// 173 of them would be a ~100 MB repo and a slow menu page. Each photo becomes a progressive JPEG at
// 800 px and a 400 px companion for the grid, and the manifest keeps the original's byte count, hash
// and pixel size as the provenance record the client call needs.
//
//   node scripts/mirror-images.mjs            # fetch whatever is missing
//   node scripts/mirror-images.mjs --force    # re-fetch everything
//
// Writes: site/public/menu/<name>.jpg, site/public/menu/<name>.400.jpg, content/image-manifest.json

import { readFile, writeFile, mkdir, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { localPhotoName } from "./lib/photo-name.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
// sharp is installed for Astro; resolve it from the app so this script needs no separate install.
const require = createRequire(join(ROOT, "site/package.json"));
const sharp = require("sharp");
const OUT_DIR = join(ROOT, "site/public/menu");
const MANIFEST = join(ROOT, "content/image-manifest.json");
const CONCURRENCY = 6;
const WIDTHS = { full: 800, thumb: 400 };

const force = process.argv.includes("--force");

const source = JSON.parse(await readFile(join(ROOT, "content/menu.source.json"), "utf8"));

const remotes = new Map();
for (const item of source.items) {
  if (!item.image) continue;
  if (!remotes.has(item.image)) remotes.set(item.image, []);
  remotes.get(item.image).push(item.name);
}

let previous = { photos: {} };
try {
  previous = JSON.parse(await readFile(MANIFEST, "utf8"));
} catch {
  /* first run */
}

await mkdir(OUT_DIR, { recursive: true });

const sha = (buf) => createHash("sha256").update(buf).digest("hex").slice(0, 12);

async function exists(p) {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

async function fetchOnce(url) {
  const res = await fetch(url, { headers: { Accept: "image/*" } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 1024) throw new Error(`suspiciously small body (${buf.length} bytes)`);
  return buf;
}

async function processOne(url) {
  const name = localPhotoName(url);
  const stem = name.replace(/\.jpg$/, "");
  const fullFile = `${stem}.jpg`;
  const thumbFile = `${stem}.400.jpg`;
  const full = join(OUT_DIR, fullFile);
  const thumb = join(OUT_DIR, thumbFile);

  if (!force && (await exists(full)) && (await exists(thumb))) {
    const known = previous.photos?.[name];
    if (known) return { name, ...known, skipped: true };
  }

  let buf;
  try {
    buf = await fetchOnce(url);
  } catch (err) {
    await new Promise((r) => setTimeout(r, 400)); // one retry: this bucket served every probe fine
    buf = await fetchOnce(url);
  }

  const meta = await sharp(buf).metadata();
  if (!["jpeg", "jpg"].includes(meta.format)) throw new Error(`${name} is ${meta.format}, not jpeg`);

  const fullImg = sharp(buf).resize(WIDTHS.full, WIDTHS.full, { fit: "inside", withoutEnlargement: true });
  const fullOut = await fullImg.clone().jpeg({ quality: 72, progressive: true, optimiseCoding: true }).toBuffer();
  const thumbOut = await sharp(buf)
    .resize(WIDTHS.thumb, WIDTHS.thumb, { fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 68, progressive: true })
    .toBuffer();

  await writeFile(full, fullOut);
  await writeFile(thumb, thumbOut);

  const fm = await sharp(fullOut).metadata();
  return {
    name,
    file: fullFile,
    thumb: thumbFile,
    remote: url,
    width: fm.width,
    height: fm.height,
    bytes: fullOut.length + thumbOut.length,
    bytesFull: fullOut.length,
    bytesThumb: thumbOut.length,
    originalBytes: buf.length,
    originalWidth: meta.width,
    originalHeight: meta.height,
    originalSha256_12: sha(buf),
  };
}

const entries = [...remotes.entries()];
const results = [];
const errors = [];
let cursor = 0;
let done = 0;

async function worker() {
  for (;;) {
    const i = cursor++;
    if (i >= entries.length) return;
    const [url] = entries[i];
    try {
      results.push(await processOne(url));
    } catch (err) {
      errors.push(`${url} — ${err.message}`);
    }
    done += 1;
    if (done % 20 === 0 || done === entries.length) process.stdout.write(`  ${done}/${entries.length}\r`);
  }
}

console.log(`mirror-images: ${entries.length} unique photographs referenced by ${source.items.length} menu items`);
await Promise.all(Array.from({ length: CONCURRENCY }, worker));

if (errors.length) {
  console.error(`\n${errors.length} photograph(s) could not be mirrored:`);
  for (const e of errors.slice(0, 10)) console.error("  " + e);
  console.error("The manifest is not written: build-content would ship cards that point at nothing.");
  process.exit(1);
}

const photos = {};
let bytes = 0;
for (const r of results) {
  photos[r.name] = r;
  bytes += r.bytes;
}

const manifest = {
  meta: {
    generatedBy: "scripts/mirror-images.mjs",
    sourceFingerprint: source.meta.fingerprint,
    sourceCapturedAt: source.meta.capturedAt,
    photos: Object.keys(photos).length,
    bytesOnDisk: bytes,
    widths: WIDTHS,
    note: "Originals were not kept — see the header of this script. originalBytes/originalSha256_12 record what was fetched.",
  },
  photos,
};

await writeFile(MANIFEST, JSON.stringify(manifest, null, 1) + "\n", "utf8");

const reused = results.filter((r) => r.skipped).length;
console.log(
  `  ${Object.keys(photos).length} photos mirrored` +
    (reused ? ` (${reused} already on disk, left alone)` : "") +
    ` · ${(bytes / 1024 / 1024).toFixed(1)} MB in site/public/menu · manifest -> content/image-manifest.json`,
);
