#!/usr/bin/env node
// scripts/check-css.mjs — the CSS equivalent of a compile error.
//
// A typo in a custom property name is not a syntax error: the browser parses `var(--teh)` happily,
// resolves it to the guaranteed-invalid value, and the element silently loses its colour or its
// border. That is the most expensive class of bug in a design system, because it looks like a
// styling decision rather than a mistake. This checks three things and nothing else:
//
//   1. braces balance (a stray `}` takes out the rest of the file)
//   2. every var(--x) is declared somewhere in the stylesheet set, or has a fallback argument
//   3. no declaration is left half-written (`border: 1px solid color-m` — the kind that parses as a
//      discarded declaration and shows up as a missing border)

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const FILES = ["site/src/styles/tokens.css", "site/src/styles/global.css"];

// Properties the browser defines for us; a component may legitimately read one of these.
const BUILT_INS = new Set(["--hour", "--night", "--i", "--edge-angle", "--ticker-dur", "--btn-ink"]);

const sources = new Map();
for (const f of FILES) sources.set(f, await readFile(join(ROOT, f), "utf8"));

const problems = [];

/* declared custom properties, across the whole set */
const declared = new Set(BUILT_INS);
for (const [file, css] of sources) {
  for (const m of css.matchAll(/(--[a-zA-Z0-9-]+)\s*:/g)) declared.add(m[1]);
  // braces
  let depth = 0;
  let line = 1;
  for (const ch of css) {
    if (ch === "\n") line += 1;
    if (ch === "{") depth += 1;
    if (ch === "}") {
      depth -= 1;
      if (depth < 0) problems.push(`${file}:${line}: closing brace with nothing open`);
    }
  }
  if (depth !== 0) problems.push(`${file}: ${depth} unclosed brace(s)`);
}

/* references */
for (const [file, css] of sources) {
  for (const m of css.matchAll(/var\(\s*(--[a-zA-Z0-9-]+)\s*([,)]?)/g)) {
    const [, name, after] = m;
    if (declared.has(name)) continue;
    const hasFallback = after === ",";
    if (!hasFallback) problems.push(`${file}: var(${name}) is never declared and has no fallback`);
  }
  // half-written values: a truncated function colour parses as invalid and the declaration is
  // dropped, which shows up as a missing border rather than as an error
  for (const m of css.matchAll(/\b(color-m|color-mi|oklab\(|cubic-bezier\()\s*(?=[;\s}])/g)) {
    problems.push(`${file}: truncated function "${m[0].trim()}"`);
  }
}

/* contrast tokens are only as good as the pairs they are used in — spot-check the forbidden one */
const global = sources.get("site/src/styles/global.css") ?? "";
if (/color:\s*var\(--mist\)\s*;\s*background:\s*var\(--teal\)/.test(global)) {
  problems.push("global.css: --mist on --teal is the 1.46:1 pair tokens.css forbids");
}

if (problems.length) {
  console.error("check-css: FAILED");
  for (const p of problems) console.error(`  ${p}`);
  process.exit(1);
}

console.log(
  `check-css: ok — ${FILES.length} files, ${declared.size} declared properties, every var() resolves`,
);
