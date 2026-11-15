// scripts/check-astro-parse.mjs — does every .astro file actually compile?
//
// Why this exists: `@astrojs/compiler` (the Go parser Astro itself uses) accepts a template whose
// expression block is closed with the wrong bracket — `{ foo.map(x => (…) )` instead of `… }` — and
// reports nothing. esbuild, which runs one step later in the build, is the one that refuses, and it
// points at the generated line rather than the mistake. That cost the first build of this site a
// debugging detour for a single character on one line.
//
// So this script runs both halves of the real pipeline over every file in src/: parse the template,
// then parse the code the template produced. A file passes only if both agree it is valid, and the
// report gives the source line by re-running the transform without the minified wrapper.
//
// It does not type-check, and it does not run the framework. It answers one question — will `astro
// build` get past reading this file — in about a second, before you ask it to render 243 dishes.
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";

const root = fileURLToPath(new URL("..", import.meta.url));
const src = join(root, "site", "src");

// The dependencies belong to the site, not to the repository root — there is no node_modules next to
// this file. Resolving through site/package.json is how the same script works from any working
// directory, and how it keeps using the exact compiler and bundler the build itself uses (a version
// drift here would be a checker that passes what the build rejects).
const requireFromSite = createRequire(pathToFileURL(join(root, "site", "package.json")));
const { transform } = requireFromSite("@astrojs/compiler");
const { transform: esbuildTransform } = requireFromSite("esbuild");

async function astroFiles(dir, out = []) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) await astroFiles(path, out);
    else if (entry.name.endsWith(".astro")) out.push(path);
  }
  return out;
}

/** The line in the .astro file whose generated form failed, found by re-transforming per section. */
async function blame(source, file, generatedLine) {
  const { code } = await transform(source, { sourcefile: file });
  const gen = code.split("\n");
  // Walk the generated code backwards from the failure to the last source-mapping comment; Astro
  // emits the original text verbatim inside the template, so the nearest literal line is the answer.
  for (let i = Math.min(generatedLine, gen.length) - 1; i >= 0; i -= 1) {
    const text = gen[i].trim();
    if (text && !text.startsWith("import") && source.includes(text)) return text;
  }
  return null;
}

/**
 * The literal `<script>` bodies, each with the source line its tag opened on.
 *
 * A regex like `<script[^>]*>([\s\S]*?)</script>` looks adequate and is wrong: `<script … />` is
 * self-closing and has no body, yet it matches as an opener, so the capture runs to the NEXT
 * `</script>` and the "body" is a fragment of markup. That is exactly how this checker invented a
 * syntax error in Base.astro — it fed esbuild `<script type="application/ld+json" … />` and reported
 * the `/` as unexpected. Anything whose content is injected (`set:html`) is skipped for the same
 * reason: there is no literal source to parse here, and parsing the attribute value is not our job.
 */
function scriptBlocks(source) {
  const found = [];
  // A `<script>` written inside a script body — in a comment explaining Astro templating, say — is not
  // a second block. Script tags cannot nest, so anything the scan finds before the current body's own
  // close tag is prose, and taking it as an opener captures a fragment that starts mid-comment and
  // "fails" to parse. (This checker invented exactly that error from a comment in its own source file.)
  let skipUntil = -1;
  for (const match of source.matchAll(/<script\b([^>]*)>/g)) {
    if (match.index < skipUntil) continue;
    const attrs = match[1];
    if (attrs.trimEnd().endsWith("/") || attrs.includes("set:html")) continue;
    const start = match.index + match[0].length;
    const end = source.indexOf("</script>", start);
    if (end === -1) continue; // no close tag in this file: the template parse will have said so
    skipUntil = end + "</script>".length;
    found.push({
      body: source.slice(start, end),
      // esbuild counts lines from 1 within the text it is given, so the tag's own line is the offset
      // that turns a block-relative line back into one you can jump to.
      line: source.slice(0, match.index).split("\n").length,
    });
  }
  return found;
}

/**
 * Directives whose value must be a braced expression, found quoted instead.
 *
 * `class:list="['dial', { 'dial--minimal': minimal }]"` compiles. It also does nothing: Astro takes a
 * quoted value as a literal string of class names, and this one contains no whitespace-separated class
 * that exists, so the element shipped with NO class at all and every `.dial` rule in the stylesheet
 * missed it. The template parses, esbuild parses, the build prints "success" — the only symptom is a
 * design that quietly stopped being applied. The first dial on this site was unstyled for exactly that
 * one missing `{`.
 *
 * A quoted value that is plain text (`class:list="card featured"`) is legitimate, so the test is
 * whether the string looks like code: brackets, braces, a template literal, a call, or an arrow.
 */
const EXPRESSION_DIRECTIVES = ["class:list", "set:html", "set:text", "define:vars"];

function quotedDirectives(source) {
  const found = [];
  for (const name of EXPRESSION_DIRECTIVES) {
    const pattern = new RegExp(`(?:^|\\s)${name.replace(":", "\\:")}=(?:"([^"]*)"|'([^']*)')`, "g");
    for (const match of source.matchAll(pattern)) {
      const value = match[1] ?? match[2] ?? "";
      if (!/[[{(`]|=>/.test(value)) continue;
      found.push({
        line: source.slice(0, match.index).split("\n").length,
        name,
        value,
      });
    }
  }
  return found;
}

/**
 * Names the lib modules export, mapped to where they live.
 *
 * A client `<script>` block is a separate module from the frontmatter above it: it gets its own
 * import list, and nothing in the build connects the two. When `DIAL_MAX` was added to the dial it
 * went into the frontmatter import and not the script's, so `astro build` succeeded, the page looked
 * right, and "Watch the day go" threw `DIAL_MAX is not defined` on the first tick. The compiler
 * cannot see that — the identifier is simply free, which in JS means "look it up at run time".
 *
 * So: every name a script block uses that only exists in site/src/lib must be imported by that block.
 */
async function libExports() {
  const map = new Map();
  const dir = join(src, "lib");
  for (const entry of await readdir(dir)) {
    if (!entry.endsWith(".mjs")) continue;
    const text = await readFile(join(dir, entry), "utf8");
    const names = new Set();
    for (const m of text.matchAll(/^\s*export\s+(?:async\s+)?(?:const|let|var|function|class)\s+([A-Za-z_$][\w$]*)/gm)) names.add(m[1]);
    for (const m of text.matchAll(/^\s*export\s*\{([^}]*)\}/gm)) {
      for (const part of m[1].split(",")) {
        const name = part.trim().split(/\s+as\s+/).pop()?.trim();
        if (name && /^[A-Za-z_$][\w$]*$/.test(name)) names.add(name);
      }
    }
    for (const name of names) map.set(name, `${entry}`);
  }
  return map;
}

/** Identifiers a script block uses that only exist in lib, minus the ones it imports. */
function missingImports(body, exports) {
  const code = body.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "").replace(/(["'`])(?:\\.|(?!\1)[\s\S])*\1/g, '""');
  const imported = new Set();
  for (const m of code.matchAll(/import\s*(?:\{([^}]*)\}|\*\s+as\s+\w+)?/g)) {
    if (m[1]) for (const part of m[1].split(",")) imported.add(part.trim().split(/\s+as\s+/)[0].trim());
    else imported.add("*");
  }
  const missing = new Set();
  for (const [name] of exports) {
    if (imported.has(name) || imported.has("*")) continue;
    if (new RegExp(`(?<![\\w$.])${name.replace(/\\$/g, "\\\\$")}(?![\\w$]*(?:\\s*:|\\s*=))`, "").test(code)) missing.add(name);
  }
  return [...missing];
}

const files = await astroFiles(src);
const failures = [];
const libNames = await libExports();

for (const file of files) {
  const source = await readFile(file, "utf8");
  const label = file.slice(src.length + 1).replaceAll("\\", "/");
  let code;
  try {
    ({ code } = await transform(source, { sourcefile: label }));
  } catch (error) {
    failures.push([label, `template: ${String(error.message ?? error).split("\n")[0]}`]);
    continue;
  }
  try {
    // TypeScript, not JavaScript: Astro compiles the frontmatter it just emitted with esbuild's TS
    // loader, so `const slots: string[] = []` is valid there and a JS parse would call it a syntax
    // error. Checking as JS would make the checker fail on code the build accepts, which is worse
    // than no checker at all — the noise teaches you to ignore it.
    await esbuildTransform(code, { loader: "ts", format: "esm" });
  } catch (error) {
    const first = error.errors?.[0];
    const where = first?.location ? `line ${first.location.line}: ${first.text}` : String(error.message);
    const near = first?.location ? await blame(source, label, first.location.line) : null;
    failures.push([label, `generated code: ${where}${near ? ` — near \`${near.slice(0, 72)}\`` : ""}`]);
    continue;
  }
  // Script blocks are compiled separately by Vite; check them as TypeScript, which is how they are
  // written, rather than trusting the template transform to have looked at them.
  for (const block of scriptBlocks(source)) {
    try {
      await esbuildTransform(block.body, { loader: "ts", format: "esm" });
    } catch (error) {
      const first = error.errors?.[0];
      const at = first?.location ? block.line + first.location.line - 1 : 0;
      failures.push([
        label,
        `script block${at ? ` line ${at}` : ""}: ${first?.text ?? error.message}`,
      ]);
    }
    const missing = missingImports(block.body, libNames);
    if (missing.length) {
      failures.push([
        label,
        `script block line ${block.line}: uses ${missing.join(", ")} without importing it in THIS block — the frontmatter import does not reach it`,
      ]);
    }
  }
  for (const hit of quotedDirectives(source)) {
    failures.push([
      label,
      `line ${hit.line}: ${hit.name}="…" is a string, not an expression — write ${hit.name}={${hit.value.slice(0, 48)}} or it does nothing`,
    ]);
  }
}

if (failures.length) {
  console.error(`check-astro-parse: ${failures.length} problem(s)`);
  for (const [file, message] of failures) console.error(`  ${file} — ${message}`);
  process.exit(1);
}

const checked = (
  await Promise.all(
    files.map(async (f) => scriptBlocks(await readFile(f, "utf8")).length),
  )
).reduce((n, k) => n + k, 0);

console.log(`check-astro-parse: ok — ${files.length} files, ${checked} script block(s), template and generated code both parse`);
