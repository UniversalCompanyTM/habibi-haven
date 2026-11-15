// Provenance check for the architecture board.
//
// The plan promised a deterministic board: "labels that are not in this file cannot appear in
// the image". This proves it. Every claim token in board.svg — numbers, hex colours, file
// names, routes, prices — must appear in the plan it was drawn from, or the check fails.
//
//   node scripts/check-board.mjs [path/to/plan.md]
//
// Exit 0 = every token traceable. Exit 1 = the board says something the plan does not.

import { readFile } from "node:fs/promises";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "..");
const SVG = join(ROOT, "docs", "architecture", "board.svg");
const PLAN = process.argv[2] || join(ROOT, "docs", "ARCHITECTURE.md");

const svg = await readFile(SVG, "utf8");
const plan = (await readFile(PLAN, "utf8"))
  .replace(/&amp;/g, "&")
  .toLowerCase();

// strip markup, keep the visible strings, in document order
const labels = [...svg.matchAll(/<text\b[^>]*>([\s\S]*?)<\/text>/g)]
  .map((m) =>
    m[1]
      .replace(/<[^>]*>/g, "")
      .replace(/&#(\d+);/g, (_, c) => String.fromCodePoint(+c))
      .replace(/&[a-z]+;/gi, (e) => ({ "&amp;": "&", "&lt;": "<", "&gt;": ">", "&middot;": "·", "&nbsp;": " " })[e.toLowerCase()] || e)
      .trim(),
  )
  .filter(Boolean);

const PATTERNS = [
  ["hex", /#[0-9a-f]{6}/gi],
  ["file", /\b[a-z0-9._/-]+\.(?:mjs|json|md|astro|js|css|html|svg|png)\b/gi],
  ["route", /\B\/(?:[a-z][a-z0-9-]*)\b/g],
  ["number", /\d[\d,]*(?:\.\d+)?/g],
];

const problems = [];
for (let i = 0; i < labels.length; i++) {
  const text = labels[i];
  const low = text.toLowerCase();
  // A bare 1-2 digit label is a marker (panel numbers 01-05, spine nodes 01-05, place markers 1-6),
  // documented under "Board chrome" in the plan — it asserts nothing, so it needs no source.
  const marker = /^\d{1,2}$/.test(text);
  for (const [kind, re] of PATTERNS) {
    if (kind === "number" && marker) continue;
    for (const tok of new Set(text.match(re) || [])) {
      // a bare number inside a ratio or a range is still a number the plan must carry
      if (!plan.includes(tok.toLowerCase())) {
        problems.push({ i, kind, tok, text });
      }
    }
  }
  // nothing on the board may be a filler string, a claim that this is Habibi's own live site,
  // or a Relume artefact. ("live" is only banned as a claim — the plan's own feature wording,
  // "live KSh total" and "live open/closed", is allowed.)
  for (const banned of ["lorem", "coming soon", "official", "now live", "relume.io", "imagedelivery", "pexels"]) {
    if (low.includes(banned)) problems.push({ i, kind: "banned", tok: banned, text });
  }
}

console.log(`${labels.length} visible strings in board.svg, checked against ${PLAN.split(/[\\/]/).pop()}`);
if (problems.length) {
  console.log(`\n${problems.length} untraceable token(s):`);
  for (const p of problems) {
    console.log(`  [${p.kind}] ${p.tok}  ←  "${p.text}"  (label #${p.i})`);
  }
  process.exit(1);
}
console.log("every number, colour, file name and route on the board appears in the plan.");
