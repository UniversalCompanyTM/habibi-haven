// scripts/check-ssr-safety.mjs — can every lib module be imported by a server?
//
// Why this exists: Astro evaluates a page's frontmatter in Node. Any module imported from there runs
// its TOP-LEVEL code in Node too — and the first build of this site failed twice because
// lib/table-client.mjs did browser things at module scope (`location.search`, then a top-level
// `addEventListener("storage", …)`). Both were invisible to every other check we have: the file is
// valid syntax, its tests pass, and it works perfectly in a browser. Only the build noticed, and it
// noticed one page at a time, which is the slowest possible way to learn this.
//
// The test is not a grep for browser globals. It is the real thing: import the module in bare Node,
// where `document`, `location` and `window` do not exist. If the module has side effects at module
// scope that need a DOM, the import throws, and that throw IS the finding. Anything that passes here
// is safe to import from a component's frontmatter — which is the contract lib/ actually has.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { registerHooks } from "node:module";

// Bare Node refuses `import menu from "../data/menu.json"` without `with { type: "json" }`, while
// Vite and Astro accept it as written — so an unhooked import would report a defect that does not
// exist, on exactly the modules worth testing (the ones that read the menu). The hook settles JSON
// imports the way the bundler does: parse the file, hand back a module with a default export. It
// changes nothing about the thing under test, which is whether module scope touches a DOM global.
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (!specifier.endsWith(".json") || !context.parentURL) return nextResolve(specifier, context);
    return {
      url: `${new URL(specifier, context.parentURL).href}?ssr-json`,
      format: "json",
      shortCircuit: true,
    };
  },
  load(url, context, nextLoad) {
    if (!url.endsWith("?ssr-json")) return nextLoad(url, context);
    const source = readFileSync(fileURLToPath(url.replace(/\?ssr-json$/, "")), "utf8");
    return {
      format: "module",
      source: `export default ${JSON.stringify(JSON.parse(source))};`,
      shortCircuit: true,
    };
  },
});

const root = fileURLToPath(new URL("..", import.meta.url));
const libDir = join(root, "site", "src", "lib");

// The globals a browser has and Node does not. Reading one at module scope is the bug; defining them
// as `undefined` would let a module sail past the test while still being unusable, so they are left
// genuinely absent and the ReferenceError is allowed to happen.
const files = readdirSync(libDir).filter((f) => f.endsWith(".mjs")).sort();
const failures = [];

for (const name of files) {
  const url = pathToFileURL(join(libDir, name)).href;
  try {
    // A cache-busting query so a re-run in the same process re-executes module scope, and a broken
    // import is reported against the module that owns it rather than the one that triggered it.
    await import(`${url}?ssrcheck=${Date.now()}`);
  } catch (error) {
    failures.push([name, error]);
  }
}

if (failures.length) {
  console.error(`check-ssr-safety: ${failures.length} module(s) cannot be imported on a server`);
  for (const [name, error] of failures) {
    const first = String(error.stack ?? error.message)
      .split("\n")
      .find((line) => line.trim().startsWith("at "))
      ?.trim();
    console.error(`  lib/${name} — ${error.message}`);
    if (first) console.error(`      ${first}`);
    console.error(
      "      fix: move the browser access inside a function, or guard it with the module's ON_CLIENT test",
    );
  }
  process.exit(1);
}

console.log(`check-ssr-safety: ok — ${files.length} lib module(s) import cleanly with no DOM present`);
