// Fits the architecture board: measures every label against its panel edge in a real
// browser, then pins the overflowing ones with textLength so nothing is clipped and no
// string is reworded. Deterministic and idempotent — safe to re-run after any board edit.
//
//   node habibi-haven-site/scripts/fit-board.mjs [--dry]
//
// Needs Chrome (or Edge) and docs/architecture/fit.html, which does the measuring.

import { execFile } from "node:child_process";
import { readFile, writeFile, access, rm } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);
const DIR = join(import.meta.dirname, "..", "docs", "architecture");
const SVG = join(DIR, "board.svg");
const MEASURE = join(DIR, "board.measure.svg");
const PORT = 8731;
const DRY = process.argv.includes("--dry");

const CANDIDATES = [
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
];
let browser;
for (const c of CANDIDATES) {
  try { await access(c); browser = c; break; } catch { /* try the next one */ }
}
if (!browser) { console.error("No Chrome or Edge found — the board needs one to measure and rasterise."); process.exit(1); }

// clear any previous pinning, then measure and re-apply from scratch
let svg = await readFile(SVG, "utf8");
svg = svg.replace(/ (textLength|lengthAdjust)="[^"]*"/g, "");
await writeFile(MEASURE, svg, "utf8");

let dump;
try {
  dump = (await run(browser, [
    "--headless=new", "--disable-gpu", "--no-sandbox", "--virtual-time-budget=4000",
    "--dump-dom", `http://127.0.0.1:${PORT}/fit.html?src=board.measure.svg`,
  ], { maxBuffer: 1 << 24 })).stdout;
} catch (e) {
  await rm(MEASURE, { force: true });
  console.error(`Measurement failed — is serve-board.mjs running on ${PORT}?\n${e.message}`);
  process.exit(1);
}
await rm(MEASURE, { force: true });

const m = dump.match(/FITJSON(\[.*?\])FITJSON/s);
if (!m) {
  console.error("No FITJSON in the dump. Start the server first:\n  node docs/architecture/serve-board.mjs 8731");
  process.exit(1);
}
const rows = JSON.parse(m[1]);

const marks = [...svg.matchAll(/<text[\s>]/g)];
if (marks.length === 0) { console.error("no <text> elements found"); process.exit(1); }

const byIndex = new Map(rows.map((r) => [r.i, r]));
let applied = 0;
const out = [];
let cursor = 0;
for (let i = 0; i < marks.length; i++) {
  const start = marks[i].index;
  const end = svg.indexOf(">", start);
  out.push(svg.slice(cursor, end));
  const row = byIndex.get(i);
  if (row) {
    out.push(` textLength="${row.textLength}" lengthAdjust="spacingAndGlyphs"`);
    applied++;
  }
  cursor = end;
}
out.push(svg.slice(cursor));
svg = out.join("");

if (!DRY) await writeFile(SVG, svg, "utf8");

console.log(`${marks.length} labels measured, ${applied} pinned to fit${DRY ? " (--dry, file untouched)" : ""}:`);
for (const r of rows) console.log(`  #${String(r.i).padStart(3)}  +${String(r.over).padStart(5)}px  ${r.s}`);
