// scripts/verify-dist.mjs — does the built site actually contain what the pages claim?
//
// `astro build` reports success for a page that rendered the wrong thing: an unbraced `class:list`
// produced valid HTML with no class, a missing script-block import produced valid HTML that throws on
// the first click, and a `three` import written statically would produce valid HTML that ships 690 kB
// to every visitor. None of those make the build fail. This does not re-check them in the browser —
// it checks the artefact the browser will receive, so `npm run build && node scripts/verify-dist.mjs`
// answers "is what we just built shippable" without a server or a headless run.
//
// Six families of assertions: routes, entry-graph weight, the data attributes the client scripts
// require, content completeness, references that resolve, and the accessibility floor.
import { readFile, readdir, stat } from "node:fs/promises";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const dist = join(root, "site", "dist");

const fails = [];
const notes = [];
const ok = (label, detail) => notes.push(`  ok   ${label}${detail ? ` — ${detail}` : ""}`);
const bad = (label, detail) => fails.push(`  FAIL ${label} — ${detail}`);

async function html(dir = dist, out = []) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) await html(path, out);
    else if (entry.name.endsWith(".html")) out.push(path);
  }
  return out;
}

// dist/menu/index.html -> /menu, dist/404.html -> /404, dist/index.html -> /
// node:path/posix on a Windows absolute path yields "../C:/…" nonsense, so the relative step has to use
// the native separator and be normalised afterwards — that is what this file's own first run did.
const pages = {};
for (const file of await html()) {
  const rel = relative(dist, file).replaceAll("\\", "/");
  const route = ("/" + rel.replace(/index\.html$/, "").replace(/\.html$/, "")).replace(/\/+$/, "") || "/";
  pages[route] = await readFile(file, "utf8");
}
const all = Object.entries(pages);

// ---------------------------------------------------------------- routes
const expected = ["/", "/menu", "/table", "/visit", "/404"];
for (const route of expected) {
  const hit = all.find(([r]) => r === route || r === `${route}/index` || r === route + "/");
  if (!hit) bad("routes", `${route} is not in dist`);
}
for (const stray of all.filter(([r]) => !expected.includes(r))) bad("routes", `unexpected page built: ${stray[0]}`);
if (!fails.length) ok("routes", expected.join(" "));

// Cloudflare Pages answers a slash-free request that names a directory with a 308 to the slashed form,
// so building /menu as menu/index.html would make every nav link take a hop and put /menu/ in the
// address bar while the canonical tag says /menu. A site/public/_redirects rewrite was tried first,
// built and deployed, and measured on 2026-11-15: /menu still returned 308, because Pages' directory
// redirect runs in front of those rules. build.format = "file" removes the condition instead — /menu is
// a file, so there is nothing to redirect. This fails if the build ever goes back to nested indexes,
// because that regression is invisible in the HTML and only shows up on the hosted site.
for (const route of expected.filter((r) => r !== "/" && r !== "/404")) {
  const flat = join(dist, `${route.slice(1)}.html`);
  const nested = join(dist, route.slice(1), "index.html");
  const isFlat = await stat(flat)
    .then((s) => s.isFile())
    .catch(() => false);
  const isNested = await stat(nested)
    .then((s) => s.isFile())
    .catch(() => false);
  if (!isFlat) bad("route shape", `${route} is not built as ${route.slice(1)}.html at the dist root`);
  if (isNested)
    bad("route shape", `${route} is also a directory holding index.html — Pages will 308 the slashed-free link to ${route}/`);
}
if (!fails.some((f) => f.includes("route shape"))) {
  ok("route shape", "every route is one flat file, so the host has no directory to redirect to");
}

// ---------------------------------------------------------------- entry graph
// ARCHITECTURE.md decision 5: three is never in the entry graph. The one honest test is that the entry
// HTML of every page contains no reference to the three chunk — not a `<script src>`, not a
// `modulepreload` that browsers follow eagerly, nothing.
const assets = await readdir(join(dist, "_astro"));
const threeChunk = assets.filter((n) => /three/i.test(n) && n.endsWith(".js"));
const doorChunk = assets.filter((n) => n.startsWith("DoorScene") && n.endsWith(".js"));
for (const [route, src] of all) {
  for (const chunk of threeChunk) {
    if (src.includes(chunk)) bad("entry graph", `${route} references ${chunk} directly — three is being preloaded`);
  }
}
if (!fails.length) ok("entry graph", `three (${threeChunk[0] ?? "n/a"}) is referenced only from ${doorChunk[0] ?? "the dynamic import"}`);

// ---------------------------------------------------------------- client contracts
// Every data-* a client script queries must exist in the server HTML, or the handler is attached to
// nothing and the control silently does nothing. These lists are the contract, written out so a
// rename that breaks a hook fails here rather than in a browser.
//
// Only hooks the SERVER is responsible for belong here. The table's row controls (`data-inc`,
// `data-dec`, `data-drop`, `data-option`) are emitted by TableBuilder's own render() after mount, so
// they are legitimately absent from the static HTML — asserting them here would fail on a page that
// works, which is the fastest way to make a check ignored. Their existence is proven in the browser.
// `data-lines` was on this list from a draft contract and appears in neither component: a phantom
// requirement the verifier invented, caught by grepping the source rather than by fixing the site.
const CONTRACTS = {
  "/": ["data-dial", "data-dial-input", "data-scene", "data-door", "data-reveal", "data-cursor", "data-ring", "data-kin", "data-magnetic"],
  "/menu": ["data-explorer", "data-q", "data-sort", "data-band", "data-min", "data-max", "data-tag", "data-reset", "data-count", "data-groups", "data-group", "data-subgroup", "data-card", "data-add", "data-signed"],
  "/table": ["data-builder", "data-origin", "data-phone", "data-party", "data-card", "data-add", "data-magnetic"],
  "/visit": ["data-dial", "data-dial-input"],
};
for (const [route, needed] of Object.entries(CONTRACTS)) {
  const src = all.find(([r]) => r === route)?.[1];
  if (!src) continue;
  const missing = needed.filter((attr) => !src.includes(attr));
  if (missing.length) bad("client contract", `${route} renders without ${missing.join(", ")} — those handlers attach to nothing`);
  else ok("client contract", `${route} has all ${needed.length} hooks`);
}

// One hook, one meaning. A page's client chunk asks the DOM for elements by attribute; if a dish card
// also carries that attribute, the card is swept into a loop meant for its container. That is how /menu
// hid all 243 rows while its counter said "Showing all 243 items": the section pass queried
// [data-section], the cards each declared data-section="Breakfast", so 284 nodes were visited as
// "sections" and every card was told it contained no visible dishes. The check reads the shipped
// selectors and the shipped markup, so it fails on the build that has the bug, not on a guess.
for (const [route, src] of all) {
  const chunks = [...new Set([...src.matchAll(/\/_astro\/[\w.-]+\.js/g)].map((m) => m[0]))];
  const queried = new Set();
  for (const ref of chunks) {
    let js = "";
    try {
      js = await readFile(join(dist, ref), "utf8");
    } catch {
      continue;
    }
    for (const m of js.matchAll(/querySelectorAll\(\s*"\[([a-zA-Z-]+)\]"\s*\)/g)) queried.add(m[1]);
    for (const m of js.matchAll(/querySelector\(\s*"\.?\[?([a-zA-Z-]+)\]?"\s*\)/g)) queried.add(m[1]);
  }
  queried.delete("data-card");
  const clashes = new Set();
  for (const openTag of src.matchAll(/<article\b[^>]*data-card[^>]*>/g)) {
    const onCard = [...openTag[0].matchAll(/\s([a-z][a-z0-9-]*)=/g)].map((m) => m[1]);
    for (const name of onCard) if (queried.has(name)) clashes.add(name);
  }
  if (clashes.size)
    bad("hook collision", `${route}: cards carry ${[...clashes].join(", ")} and a client script queries [${[...clashes].join("], [")}] — the cards will be treated as containers`);
}
if (!fails.some((f) => f.includes("hook collision"))) ok("hook collision", "no attribute is queried as a container while sitting on a dish card");

// dial ids must be unique per page (Astro.uid does not exist in 5.18; a missing `name` prop collides)
for (const [route, src] of all) {
  const ids = [...src.matchAll(/id="(dial[^"]*)"/g)].map((m) => m[1]);
  const dupes = ids.filter((v, i) => ids.indexOf(v) !== i);
  if (dupes.length) bad("duplicate ids", `${route} repeats ${[...new Set(dupes)].join(", ")}`);
  if (ids.some((v) => /undefined/.test(v))) bad("duplicate ids", `${route} has an id built from undefined`);
}
if (!fails.some((f) => f.includes("duplicate ids"))) ok("duplicate ids", "every dial id is distinct and named");

// the dial's CSS class must actually be on the element — an unbraced class:list renders the string
// attribute but applies no styles, which is how the dial shipped unstyled for a whole milestone.
for (const [route, src] of all.filter(([, s]) => s.includes("data-dial"))) {
  const host = src.match(/<div class="([^"]*dial[^"]*)"[^>]*data-dial/) ?? src.match(/<div[^>]*data-dial[^>]*class="([^"]*)"/);
  if (!host || !/\bdial\b/.test(host[1])) bad("class:list", `${route}: the dial element has no "dial" class (got "${host?.[1] ?? ""}")`);
}
if (!fails.some((f) => f.includes("class:list"))) ok("class:list", "the dial element carries its classes");

// ---------------------------------------------------------------- content completeness
// Use the page's own data and the page's own selector rather than a guessed field name: `signatureItems`
// is what home renders, and it walks `menu.families` — which exists on the built `src/data/menu.json`,
// not on the raw `content/menu.source.json` ingest. Reading the wrong file threw on the first run of
// this check; reading `item.signature` off the ingest silently returned an empty set. The page's inputs
// are the ones to verify against.
const { signatureItems } = await import(new URL("../site/src/lib/table.mjs", import.meta.url).href);
const menu = JSON.parse(await readFile(join(root, "site", "src", "data", "menu.json"), "utf8"));
// The built menu is a tree — families > sections > items — and `meta.items` is the flat count the copy
// quotes. Flatten to compare like with like instead of reaching for a top-level `items` array that does
// not exist in this shape.
const flat = (menu.families ?? []).flatMap((fam) => (fam.sections ?? []).flatMap((sec) => sec.items ?? []));
const declared = menu.meta?.items ?? flat.length;
if (!flat.length) bad("menu content", "src/data/menu.json has no items under any family/section — the check cannot run");
else if (flat.length !== declared) bad("menu content", `menu.json holds ${flat.length} rows but meta.items declares ${declared}`);
const home = pages["/"] ?? "";
const menuPage = pages["/menu"] ?? "";
const dishRows = (menuPage.match(/data-add=/g) ?? []).length;
if (dishRows < declared) bad("menu content", `/menu renders ${dishRows} add controls for ${declared} items`);
else ok("menu content", `${dishRows} rows for ${declared} items, every row has an add control`);

const signatures = signatureItems(menu).length;
const homeSignatures = (home.match(/data-signed=/g) ?? []).length;
if (homeSignatures < signatures) bad("home content", `home shows ${homeSignatures} of ${signatures} signature dishes`);
else ok("home content", `${homeSignatures} signature cards (signatureItems() says ${signatures})`);

for (const [route, src] of all) {
  for (const phrase of ["Habibi Haven", "Koinange"]) {
    if (!src.includes(phrase)) bad("identity", `${route} never mentions ${phrase}`);
  }
}

// ---------------------------------------------------------------- references resolve
// A 404 image is the most common way a "finished" site is not finished. Check every local href/src
// against the filesystem, including the ones written inside inline styles and JSON-LD.
const referenced = new Set();
for (const [, src] of all) {
  // Single-URL attributes. Lazy quantifiers here were the first attempt and are wrong: `"(\/[^"#]*?)"`
  // stops at nothing and, run against a srcset, hands back the whole descriptor list as one path.
  for (const m of src.matchAll(/(?:src|href|poster|content)="(\/[^"#]*?)"/g)) referenced.add(m[1]);
  // srcset/sizes: a comma-separated list of "url 800w" pairs — each URL is its own file.
  for (const m of src.matchAll(/(?:srcset|imagesrcset)="([^"]+)"/g)) {
    for (const candidate of m[1].split(",")) {
      const url = candidate.trim().split(/\s+/)[0];
      if (url.startsWith("/")) referenced.add(url);
    }
  }
  // url(...) inside inline styles and <link>, quoted or not
  for (const m of src.matchAll(/url\(['"]?(\/[^'")]+)['"]?\)/g)) referenced.add(m[1]);
  // JSON-LD and preload hints carry paths as bare strings
  for (const m of src.matchAll(/"(\/(?:brand|menu|assets)\/[^"]+?\.(?:jpg|jpeg|png|webp|avif|svg|mp4|woff2?|json))"/g)) referenced.add(m[1]);
}
const broken = [];
// A local reference counts as resolved when the bytes are where a browser landing on that URL would
// find them: the exact path, `<path>.html` (the flat route files build.format: "file" emits, which is
// what Cloudflare Pages answers /menu with), or `<path>/index.html`. Asking only for the literal path
// failed the first flat build, because /menu is not a file — /menu.html is.
const isFile = (p) => stat(p).then((s) => s.isFile()).catch(() => false);
const isDir = (p) => stat(p).then((s) => s.isDirectory()).catch(() => false);
for (const ref of referenced) {
  const clean = decodeURIComponent(ref.split("?")[0].split("#")[0]);
  if (clean === "/" || clean === "") {
    if (!(await isFile(join(dist, "index.html")))) broken.push(clean);
    continue;
  }
  const target = join(dist, clean.replace(/^\//, ""));
  if (await isFile(target)) continue;
  if (await isFile(`${target}.html`)) continue;
  if ((await isDir(target)) && (await isFile(join(target, "index.html")))) continue;
  broken.push(clean);
}
if (broken.length) bad("broken references", `${broken.length} local paths with no file: ${broken.slice(0, 8).join(", ")}${broken.length > 8 ? " …" : ""}`);
else ok("references", `${referenced.size} local paths, all present on disk`);

// ---------------------------------------------------------------- accessibility floor
for (const [route, src] of all) {
  if (!/<title>/.test(src)) bad("a11y", `${route} has no <title>`);
  if (!/lang="en"/.test(src)) bad("a11y", `${route} has no lang on <html>`);
  if (!/name="viewport"/.test(src)) bad("a11y", `${route} has no viewport meta`);
  if (!/<a class="skip|id="main"|<main /.test(src)) bad("a11y", `${route} has no main landmark`);
  const imgs = [...src.matchAll(/<img\b[^>]*>/g)];
  const noAlt = imgs.filter((tag) => !/\balt=/.test(tag[0]));
  if (noAlt.length) bad("a11y", `${route}: ${noAlt.length} <img> without alt`);
  const bareTargets = imgs.filter((tag) => !/\b(width=|height=|fetchpriority=|loading=)/.test(tag[0]));
  if (bareTargets.length) notes.push(`  warn bare <img> (no width/height/loading): ${route} × ${bareTargets.length}`);
  // the WebGL canvas is decoration and must never be read by an assistive tech or focused by a cursor
  for (const canvas of src.matchAll(/<canvas\b[^>]*>/g)) {
    if (!/aria-hidden="true"/.test(canvas[0])) bad("a11y", `${route} renders a canvas that is not aria-hidden`);
  }
  if (route === "/404" && !/rel="noopener"/.test(src) && /target="_blank"/.test(src)) bad("safety", "/404 has target=_blank without rel=noopener");
}
if (!fails.some((f) => f.includes("a11y"))) ok("a11y", "title, lang, viewport, main, alt and aria-hidden on the canvas on all pages");

// every external link must carry rel=noopener
for (const [route, src] of all) {
  const blank = [...src.matchAll(/<a\b[^>]*target="_blank"[^>]*>/g)].filter((m) => !/rel="[^"]*noopener/.test(m[0]));
  if (blank.length) bad("safety", `${route}: ${blank.length} target="_blank" links without rel=noopener`);
}

// ---------------------------------------------------------------- origin & schema
//
// `site` is the origin the canonical, the og:url and the WhatsApp handoff link are all built from, so a
// build that carries a host nobody deployed to is not a cosmetic slip: the link the kitchen receives
// points at a page that does not exist. Every host this project has ever parked on is banned by name,
// because each of them is still a domain someone owns.
const STALE_HOSTS = ["netlify.app", "vercel.app", "github.io", "habibi-haven.example"];
for (const [route, src] of all) {
  for (const host of STALE_HOSTS) {
    if (src.includes(host)) bad("origin", `${route} references "${host}" — an origin nobody deployed to`);
  }
}

// The structured data is the loudest claim the site makes, so it is verified in the artefact rather than
// trusted from the module: it has to parse, and the prices in it have to be numbers a person could pay.
for (const [route, src] of all) {
  const blocks = [...src.matchAll(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/g)];
  if (blocks.length !== 1) {
    bad("schema", `${route} carries ${blocks.length} JSON-LD block(s), expected exactly 1`);
    continue;
  }
  let data;
  try {
    data = JSON.parse(blocks[0][1]);
  } catch (e) {
    bad("schema", `${route}: the JSON-LD does not parse — ${e.message}`);
    continue;
  }
  if (data["@type"] !== "Restaurant") bad("schema", `${route}: @type is ${data["@type"]}, not Restaurant`);
  if (data.address?.streetAddress !== "Koinange Street") bad("schema", `${route}: address is not Koinange Street`);
  if (!data.openingHoursSpecification?.length) bad("schema", `${route}: no opening hours published`);
  if (!data.servesCuisine?.length) bad("schema", `${route}: no cuisine type published`);
  const items = data.menu?.hasMenuItem ?? [];
  if (items.length < 5) bad("schema", `${route}: the menu lists ${items.length} priced dishes, expected the signature set`);
  for (const item of items) {
    const price = item.offers?.price;
    if (typeof price !== "number" || !Number.isFinite(price) || price <= 0)
      bad("schema", `${route}: "${item.name}" has no real price (${JSON.stringify(price)})`);
    if (item.offers?.priceCurrency !== "KES")
      bad("schema", `${route}: "${item.name}" is quoted in ${item.offers?.priceCurrency}, not KES`);
  }
  // GPS either means something or is absent. A latitude that is not a number in range is a fabricated
  // coordinate wearing this venue's name, which is the one schema error that sends people to a wrong door.
  if (data.geo) {
    const { latitude, longitude } = data.geo;
    if (!(typeof latitude === "number" && latitude >= -90 && latitude <= 90) ||
        !(typeof longitude === "number" && longitude >= -180 && longitude <= 180))
      bad("schema", `${route}: geo is present but is not a coordinate (${JSON.stringify(data.geo)})`);
  }
  // The thumb-reachable actions, present in the HTML before any script runs.
  if (!/href="tel:\+/.test(src)) bad("schema", `${route} has no tap-to-call link`);
  if (!data.hasMap?.includes("google.com/maps")) bad("schema", `${route}: no map link in the structured data`);
}
if (!fails.some((f) => f.includes("origin") || f.includes("schema")))
  ok("origin + schema", "one parsing Restaurant block per page, KES prices, hours, cuisine, tel: and map links, no stale origin");

// ---------------------------------------------------------------- weight
let kb = 0;
for (const file of await readdir(join(dist, "_astro"))) {
  if (!file.endsWith(".js")) continue;
  kb += (await stat(join(dist, "_astro", file))).size / 1024;
}
const entry = (await stat(join(dist, "index.html"))).size / 1024;
notes.push(`  info js total ${kb.toFixed(0)} kB across ${assets.filter((a) => a.endsWith(".js")).length} chunks · / is ${entry.toFixed(1)} kB of HTML · three chunk lazy at ${(threeChunk.length ? (await stat(join(dist, "_astro", threeChunk[0]))).size / 1024 : 0).toFixed(0)} kB`);

console.log(notes.join("\n"));
if (fails.length) {
  console.error(`\nverify-dist: ${fails.length} problem(s)`);
  console.error(fails.join("\n"));
  process.exit(1);
}
console.log(`\nverify-dist: ok — ${all.length} pages, ${referenced.size} references, ${expected.length} routes, contracts + a11y + weight all clean`);
