#!/usr/bin/env node
// scripts/check-drift.mjs — the "staff changed the menu without asking anyone" guard.
//
// Three questions, in order:
//   1. Is the site's built menu still the one this ingest produced? (fingerprint recorded in menu.json)
//   2. Has their live data moved since content/menu.source.json was captured? (fresh read)
//   3. Are the local brand assets still the bytes brand/ASSETS.md says they are?
//
// Exits 0 when all three agree, 1 with a readable reason when any of them does. `content/drift.md`
// is refreshed by the ingest itself, so a non-zero exit here means "read the report, then rebuild".

import { readFile, writeFile, rm, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const TEMP = join(ROOT, "content/.drift-live.json");

const problems = [];
const notes = [];

const readJson = async (p) => JSON.parse(await readFile(join(ROOT, p), "utf8"));

/* ------------------------------------------------ 1. built menu vs committed ingest */

const built = await readJson("site/src/data/menu.json");
const committed = await readJson("content/menu.source.json");

if (built.meta.sourceFingerprint !== committed.meta.fingerprint) {
  problems.push(
    `site/src/data/menu.json was built from fingerprint ${built.meta.sourceFingerprint} ` +
      `but content/menu.source.json is ${committed.meta.fingerprint} — run node scripts/build-content.mjs`,
  );
} else {
  notes.push(`menu.json is built from the committed ingest (${committed.meta.fingerprint}, ${committed.items.length} items)`);
}

/* ---------------------------------------------------------- 2. a fresh read upstream */

await mkdir(join(ROOT, "content"), { recursive: true });
const code = await new Promise((res) => {
  const child = spawn(process.execPath, [join(ROOT, "scripts/ingest.mjs"), "--out", TEMP, "--quiet"], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stderr = "";
  child.stderr.on("data", (d) => (stderr += d));
  child.on("close", (c) => {
    if (c !== 0) problems.push(`live ingest failed: ${stderr.trim() || "exit " + c}`);
    res(c);
  });
  child.on("error", (e) => {
    problems.push(`live ingest could not start: ${e.message}`);
    res(1);
  });
});

if (code === 0) {
  const live = JSON.parse(await readFile(TEMP, "utf8"));
  if (live.meta.fingerprint !== committed.meta.fingerprint) {
    problems.push(
      `their menu moved: ${committed.meta.fingerprint} (${committed.meta.capturedAt.slice(0, 10)}) → ` +
        `${live.meta.fingerprint} (${live.meta.capturedAt.slice(0, 10)}) — read content/drift.md before rebuilding`,
    );
  } else {
    notes.push(`their menu is unchanged (${live.items.length} items, ${live.meta.uniquePhotos} photos)`);
  }
  await rm(TEMP, { force: true });
}

/* ------------------------------------------------------ 3. brand asset integrity */

const assetsDoc = await readFile(join(ROOT, "brand/ASSETS.md"), "utf8").catch(() => "");

const rows = [...assetsDoc.matchAll(/^\|\s*`([^`]+)`\s*\|\s*[0-9.]+\s*KB\s*\|[^|]+\|\s*`([0-9a-f]{12})`\s*\|/gm)];
if (!rows.length) {
  notes.push("brand/ASSETS.md lists no hash rows — skipping the brand integrity check");
} else {
  let bad = 0;
  for (const [, path, hash] of rows) {
    let buf;
    try {
      buf = await readFile(join(ROOT, "brand", path));
    } catch {
      problems.push(`brand/${path} is listed in brand/ASSETS.md but missing on disk`);
      bad += 1;
      continue;
    }
    const now = createHash("sha256").update(buf).digest("hex").slice(0, 12);
    if (now !== hash) {
      problems.push(`brand/${path} no longer hashes to ${hash} (now ${now})`);
      bad += 1;
    }
  }
  if (!bad) notes.push(`brand/: ${rows.length} files match the hashes recorded in brand/ASSETS.md`);
}

/* ------------------------------------------------------------------- verdict */

for (const n of notes) console.log("  ok   " + n);
if (problems.length) {
  console.error(`\ncheck-drift: ${problems.length} problem(s)`);
  for (const p of problems) console.error("  FAIL " + p);
  process.exit(1);
}
console.log(`\ncheck-drift: clean — ${notes.length} checks passed`);
