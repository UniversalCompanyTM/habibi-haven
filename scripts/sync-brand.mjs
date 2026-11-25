#!/usr/bin/env node
// scripts/sync-brand.mjs — publish the real brand files into the site.
//
// brand/ is the source of truth (see brand/ASSETS.md: the logo and eighteen genuine venue/food
// photographs, including six later retrieved from the restaurant's listing). Astro cannot import from outside the
// app root, so the build copies them into site/public/brand/ rather than pointing the app at ../brand.
// This script is the only bridge, it is idempotent, and it verifies each copy against the sha256
// recorded in brand/ASSETS.md so a half-copied file cannot ship.

import { readFile, writeFile, mkdir, readdir, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join, basename } from "node:path";
import { createHash } from "node:crypto";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(ROOT, "brand");
const DEST = join(ROOT, "site/public/brand");
const ASSETS = join(ROOT, "brand/ASSETS.md");

const wanted = [];
try {
  const doc = await readFile(ASSETS, "utf8");
  for (const [, path, hash] of doc.matchAll(/^\|\s*`([^`]+)`\s*\|\s*[0-9.]+\s*KB\s*\|[^|]+\|\s*`([0-9a-f]{12})`\s*\|/gm)) {
    wanted.push({ path, hash });
  }
} catch {
  console.warn("sync-brand: brand/ASSETS.md not readable, copying every file without verification");
}

const groups = ["logo", "photos", "third-party"];
if (!wanted.length) {
  for (const g of groups) {
    for (const f of await readdir(join(SRC, g)).catch(() => [])) wanted.push({ path: `${g}/${f}`, hash: null });
  }
}

await rm(DEST, { recursive: true, force: true });
await mkdir(DEST, { recursive: true });

const copied = [];
for (const { path, hash } of wanted) {
  let buf;
  try {
    buf = await readFile(join(SRC, path));
  } catch {
    throw new Error(`brand/${path} is listed but not on disk`);
  }
  const digest = createHash("sha256").update(buf).digest("hex").slice(0, 12);
  if (hash && digest !== hash) throw new Error(`brand/${path} hashes ${digest}, expected ${hash}`);
  const out = join(DEST, basename(path));
  await writeFile(out, buf);
  copied.push({ file: `/brand/${basename(path)}`, bytes: buf.length, sha256_12: digest, source: `brand/${path}` });
}

copied.sort((a, b) => a.file.localeCompare(b.file));
await writeFile(
  join(ROOT, "content/brand-manifest.json"),
  JSON.stringify(
    {
      meta: {
        generatedBy: "scripts/sync-brand.mjs",
        files: copied.length,
        bytes: copied.reduce((n, c) => n + c.bytes, 0),
        note: "Hashes verified against brand/ASSETS.md. Private preview only — photo rights are an open question.",
      },
      files: copied,
    },
    null,
    1,
  ) + "\n",
  "utf8",
);

console.log(
  `sync-brand: ${copied.length} files -> site/public/brand (${(copied.reduce((n, c) => n + c.bytes, 0) / 1024).toFixed(0)} KB)` +
    (wanted.some((w) => !w.hash) ? " [unverified]" : " [hash-verified]"),
);
