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
// built and deployed, and measured on 2026-11-15: /menu still returned 308 — the measurement does not
// say why, and does not need to. build.format = "file" removes the condition instead — /menu is
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
    bad("route shape", `${route} is also a directory holding index.html — Pages will 308 the slash-free link to ${route}/`);
}
if (!fails.some((f) => f.includes("route shape"))) {
  ok("route shape", "every route is one flat file, so the host has no directory to redirect to");
}

// ---------------------------------------------------------------- canonical
//
// The canonical is the address the site tells Google it lives at, and it is the one head field a robot
// reads instead of a person. It has to be the URL a visitor actually lands on: origin + route, with no
// trailing slash (trailingSlash: "never") and no build extension (build.format: "file"). The first flat
// deploy was measured publishing …/menu.html — the pathname Astro.url carries mid-build is the name of
// the file being written, and layouts/Base.astro has to strip it. Nothing failed, because no check
// compared the canonical to the route it belonged to. This is that check.
//
// The origin is spelled out again here on purpose rather than imported from site/astro.config.mjs: a
// gate that asks the thing under test where it thinks it lives agrees with it even when it is wrong.
const ORIGIN = process.env.SITE_URL ?? "https://habibihavenpreview.pages.dev";
for (const [route, src] of all) {
  const want = route === "/" ? `${ORIGIN}/` : `${ORIGIN}${route}`;
  const canonical = src.match(/<link rel="canonical" href="([^"]*)"/)?.[1];
  const ogUrl = src.match(/<meta property="og:url" content="([^"]*)"/)?.[1];
  if (canonical !== want)
    bad("canonical", `${route}: canonical is ${canonical ?? "missing"}, expected ${want}`);
  if (ogUrl !== want) bad("canonical", `${route}: og:url is ${ogUrl ?? "missing"}, expected ${want}`);
}
if (!fails.some((f) => f.includes("canonical")))
  ok("canonical", `${all.length} pages publish their own slash-free, extension-free address`);

// ---------------------------------------------------------------- preview policy
// A preview is private unless the exact PUBLIC_INDEXABLE=true opt-in was supplied. Check every emitted
// HTML file, including 404: a layout change that drops the meta from one route is otherwise invisible.
const INDEXABLE = process.env.PUBLIC_INDEXABLE === "true";
const PREVIEW_WARNING =
  "Private pitch preview — not Habibi Haven’s official website. Media rights remain with their respective rights holders; reuse and redistribution permission is unconfirmed. For evaluation only; do not publish or redistribute.";
const metaAttribute = (tag, name) =>
  tag.match(new RegExp(`\\b${name}\\s*=\\s*["']([^"']*)["']`, "i"))?.[1] ?? null;
const hiddenPreview = (attributes) =>
  /\bhidden(?:\s|=|$)/i.test(attributes) ||
  /\baria-hidden\s*=\s*["']true["']/i.test(attributes) ||
  /\bstyle\s*=\s*["'][^"']*(?:display\s*:\s*none|visibility\s*:\s*hidden)/i.test(attributes);
const elementWithExactText = (html, wanted) => {
  for (const match of html.matchAll(/<(p|span|div|li)\b([^>]*)>/gi)) {
    const start = match.index + match[0].length;
    const end = html.indexOf(`</${match[1]}>`, start);
    if (end === -1) continue;
    const text = decodeHtml(html.slice(start, end)).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    if (text === wanted) return match;
  }
  return undefined;
};

for (const [route, src] of all) {
  const robots = [...src.matchAll(/<meta\b[^>]*>/gi)]
    .map((match) => ({ name: metaAttribute(match[0], "name"), content: metaAttribute(match[0], "content") }))
    .filter((meta) => meta.name?.toLowerCase() === "robots");
  if (INDEXABLE) {
    if (robots.length)
      bad("indexing", `${route} ships ${robots.length} robots meta tag(s) despite explicit PUBLIC_INDEXABLE=true`);
  } else {
    const content = robots[0]?.content?.trim().toLowerCase().replace(/\s+/g, " ");
    if (robots.length !== 1 || content !== "noindex, nofollow")
      bad("indexing", `${route} must ship exactly one robots meta with noindex, nofollow while private (got ${JSON.stringify(robots)})`);
  }

  const footer = src.match(/<footer\b([^>]*)>([\s\S]*?)<\/footer>/i);
  const footerText = decodeHtml(footer?.[2] ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  const warning = elementWithExactText(footer?.[2] ?? "", PREVIEW_WARNING);
  if (!footer || !footerText.includes(PREVIEW_WARNING))
    bad("preview disclosure", `${route} has no footer carrying the exact private-preview and rights warning`);
  else if (!warning || hiddenPreview(footer[1]) || hiddenPreview(warning[2]))
    bad("preview disclosure", `${route} hides the private-preview and rights warning`);
}
if (!fails.some((f) => f.includes("indexing") || f.includes("preview disclosure")))
  ok("preview policy", `${all.length} pages ${INDEXABLE ? "omit robots meta for the explicit public opt-in" : "ship noindex, nofollow"} and visibly carry the rights warning`);

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
  "/table": [
    "data-builder", "data-origin", "data-phone", "data-party", "data-card", "data-add", "data-magnetic",
    "data-when-day", "data-when-time", "data-whatsapp",
    "data-record-form", "data-record-send", "data-record-hint", "data-record-state", "data-handoff", "data-api",
  ],
  "/visit": [
    "data-dial", "data-dial-input", "data-request-form", "data-send", "data-outcome", "data-handoff", "data-api",
    "data-gal", "data-gal-open", "data-gal-box", "data-gal-play", "data-gal-prev", "data-gal-next", "data-gal-close",
  ],
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
const { PARTY_MAX, PARTY_MIN, signatureItems } = await import(new URL("../site/src/lib/table.mjs", import.meta.url).href);
const { VENUE_FRAMES, dishPhotographs } = await import(new URL("../site/src/lib/gallery.mjs", import.meta.url).href);
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

// The photograph story has three chapters and the built page has to tell all three: the kitchen's own
// pictures, the plates this project drew where the kitchen has none, and the rows still honestly empty.
//
// This belongs here rather than only in tests/run.mjs because of build order. CI runs the unit suite
// against the committed menu.json and only then runs `prebuild`, which regenerates that file from the
// upstream feed — a feed that has no illustrations in it. Drop scripts/ingest-illustrations.mjs out of
// that chain and nothing local complains: the 28 JPEGs ship, unreferenced, and the deployed menu
// silently drops back to type cards. Comparing the built HTML against the built data is the only place
// where that mistake is visible.
const illustrated = flat.filter((i) => i.photo?.illustration === true);
const pending = flat.filter((i) => i.photo?.placeholder === true);
if (illustrated.length !== (menu.meta?.illustratedPhotos ?? -1))
  bad("photo pipeline", `${illustrated.length} rows carry the illustration flag but meta says ${menu.meta?.illustratedPhotos}`);
const badges = (menuPage.match(/class="frame__badge"/g) ?? []).length;
if (illustrated.length && badges < illustrated.length)
  bad("photo pipeline", `/menu renders ${illustrated.length} illustrated dishes with only ${badges} "Illustration" labels — a render is on screen unlabelled`);
else if (illustrated.length) ok("photo pipeline", `${illustrated.length} illustrated dishes, all ${badges} labelled; ${pending.length} rows still show their pending state`);
if (pending.length && !menuPage.includes("Photograph pending"))
  bad("photo pipeline", `${pending.length} dishes have no picture but /menu never says so — the placeholder is being hidden, not admitted`);

// The visit wall is also a no-JS interface: each tile is an anchor to the actual file, and the enhanced
// viewer starts hidden. Compare the built links with the same deterministic selector the component uses;
// a placeholder, an illustration, a duplicate file, or a silently dropped family then fails here rather
// than becoming a confident sentence under a wall that does not contain what it claims.
const visitPage = pages["/visit"] ?? "";
const galleryLinks = [...visitPage.matchAll(/<a\b[^>]*data-gal-open[^>]*>/g)].map((m) => ({
  href: m[0].match(/\bhref="([^"]*)"/)?.[1] ?? "",
  kind: m[0].match(/\bdata-kind="([^"]*)"/)?.[1] ?? "",
}));
const expectedGallery = [
  ...VENUE_FRAMES.map((f) => ({ href: f.src, kind: f.kind })),
  ...dishPhotographs(menu).map((d) => ({ href: d.src, kind: d.kind })),
];
if (galleryLinks.length !== expectedGallery.length)
  bad("gallery content", `/visit renders ${galleryLinks.length} photograph links, expected ${expectedGallery.length}`);
else {
  const wrong = galleryLinks.findIndex((link, i) => link.href !== expectedGallery[i].href || link.kind !== expectedGallery[i].kind);
  if (wrong !== -1) bad("gallery content", `/visit gallery link ${wrong + 1} is ${JSON.stringify(galleryLinks[wrong])}, expected ${JSON.stringify(expectedGallery[wrong])}`);
  else ok("gallery content", `${galleryLinks.length} real file links in deterministic order (${VENUE_FRAMES.length} venue / ${dishPhotographs(menu).length} dish)`);
}
const viewerTag = visitPage.match(/<div\b[^>]*data-gal-box[^>]*>/)?.[0] ?? "";
if (!/\bhidden\b/.test(viewerTag)) bad("gallery fallback", "/visit gallery viewer is not hidden in the server HTML");
if (!/role="dialog"/.test(viewerTag) || !/aria-modal="true"/.test(viewerTag)) bad("gallery a11y", "/visit gallery viewer is not announced as a modal dialog");
if (!fails.some((f) => f.includes("gallery"))) ok("gallery fallback", "the viewer starts hidden and every tile remains a direct file link without JavaScript");

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

// ---------------------------------------------------------------- the book write path
//
// Two forms on this site POST to the order book: the request form on /visit and "Record this table" on the
// sheet. They are the only places the site writes anything, and every way they break is a way `astro build`
// still reports success:
//
//   · an API base that is http — the live page is https, so the browser refuses the call as mixed content
//     before it leaves the machine, and the guest only sees "the book could not be reached";
//   · a renamed or de-`required` field, which the Worker answers with a 422 the guest cannot fix;
//   · a party ceiling that drifted from the Worker's, which is the bug /visit actually shipped with
//     (it said 20 while the book said 30, so a party of 25 got a browser error there and a 422 from the
//     sheet) — this time the number under test is the one lib/table.mjs exports, not a copy of it;
//   · a form left visible with JavaScript switched off, which turns a network control into a plain GET: the
//     page reloads and the guest's name and phone number land in the address bar.
//
// The static anchors are asserted in the same breath because they are the other half of the design: the
// WhatsApp link and the tel: link are what a guest with no script gets, and they have to survive.
const BOOK_ROUTES = ["/visit", "/table"];
const cssFiles = [];
for (const dir of [dist, join(dist, "_astro")]) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith(".css")) cssFiles.push(await readFile(join(dir, entry.name), "utf8"));
  }
}
const css = cssFiles.join("\n");

/* Astro does not emit a `:global()` rule the way it was written. Two transformations sit between this file's
   source and the artefact: a component's `<style>` is inlined into the page HTML instead of being left in
   `_astro/*.css`, and the attribute inside `:global(html:not(.js)) [data-x]` gains the component's scope
   marker, so the /visit rule builds as
       html:not(.js) [data-astro-cid-metl4j7v][data-request-form]{display:none}
   Matching the source text literally therefore fails on a rule that works — which is precisely what this
   section's first run did. So read a rule as a set of conditions instead: a declaration block that sets
   display:none, whose selector tests both `html:not(.js)` and `[data-x]`, satisfies it wherever Astro put the
   cid or which file the rule ended up in. */
function hidesWithoutJs(text, attr) {
  for (const rule of text.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (!/display\s*:\s*none/.test(rule[2])) continue;
    if (!rule[1].includes("html:not(.js)")) continue;
    if (rule[1].includes(`[${attr}]`)) return true;
  }
  return false;
}

for (const route of BOOK_ROUTES) {
  const src = all.find(([r]) => r === route)?.[1];
  if (!src) continue;

  const bases = [...src.matchAll(/data-api="([^"]+)"/g)].map((m) => m[1]);
  if (!bases.length) bad("book write", `${route} renders no data-api — submitRequest() would be called with undefined`);
  for (const base of bases) {
    if (!/^https:\/\//.test(base)) bad("book write", `${route} points the form at ${base} — an http API base is blocked as mixed content on the https page`);
  }

  // The two fields the book refuses without, present in the server HTML and marked required there, so the
  // instant answer comes from the browser and the 422 stays the real one.
  for (const field of ["name", "phone"]) {
    const tag = src.match(new RegExp(`<input\\b[^>]*name="${field}"[^>]*>`))?.[0];
    if (!tag) bad("book write", `${route} has no input named ${field} — the payload would arrive without it`);
    else if (!/\brequired\b/.test(tag)) bad("book write", `${route}: the ${field} input is not required, so an empty one reaches the book as a 422`);
  }

  // One hook to the fetch: if nothing the page loads contains the path, the form is decoration. And the chunk
  // named in the HTML is not the end of the graph — once two pages import request-client.mjs, Vite hoists that
  // module into a shared chunk that neither HTML names and both import, so scanning only the chunks written
  // into the page finds the string in neither. Follow the imports.
  const seen = new Set();
  const queue = [...src.matchAll(/\/_astro\/[\w.-]+\.js/g)].map((m) => m[0]);
  let callsBook = false;
  while (queue.length && !callsBook) {
    const ref = queue.shift();
    if (seen.has(ref)) continue;
    seen.add(ref);
    let code = "";
    try {
      code = await readFile(join(dist, ref), "utf8");
    } catch {
      continue; // a chunk the page references but dist does not hold is already a broken reference elsewhere
    }
    if (code.includes("/v1/requests")) callsBook = true;
    // Vite links sibling chunks by relative name inside a chunk ("./shared.Xyz.js") and absolute in the HTML,
    // so the walk keys on the file name and looks in the one directory every emitted script lives in.
    for (const m of code.matchAll(/[\w.-]{4,}\.js\b/g)) queue.push(`/_astro/${m[0].split("/").pop()}`);
  }
  if (!callsBook)
    bad("book write", `${route} loads no script, nor anything those scripts import, that names /v1/requests — the form cannot reach the book`);

  // The form is a script control; without the script it must not be on the page.
  const formAttr = route === "/visit" ? "data-request-form" : "data-record-form";
  if (!hidesWithoutJs(`${src}\n${css}`, formAttr))
    bad("book write", `${route}: no html:not(.js) rule hides [${formAttr}] — with JavaScript off its submit becomes a GET that puts the guest's phone in the address bar`);

  for (const anchor of [/https:\/\/wa\.me\/\d+/, /href="tel:\+\d+/]) {
    if (!anchor.test(src)) bad("book write", `${route} lost its no-JS handoff (${anchor})`);
  }
}

// The party ceiling, read from the constant the site and the Worker are both supposed to share.
{
  const visit = all.find(([r]) => r === "/visit")?.[1];
  const party = visit?.match(/<input id="rq-party"[^>]*>/)?.[0];
  if (!party) bad("book write", "/visit renders no #rq-party input for the limit check to read");
  else {
    for (const [want, attr] of [[PARTY_MIN, "min"], [PARTY_MAX, "max"]]) {
      const got = party.match(new RegExp(`${attr}="(\\d+)"`))?.[1];
      if (got !== String(want))
        bad("book write", `/visit says ${attr}="${got ?? "nothing"}" where lib/table.mjs says ${want} — the browser and the book would refuse different parties`);
    }
  }
  if (!fails.some((f) => f.includes("book write")))
    ok("book write", `both forms carry an https data-api, required name and phone, a chunk naming /v1/requests, a no-JS hide rule, and a live wa.me + tel: fallback; #rq-party matches PARTY_MIN/PARTY_MAX (${PARTY_MIN}–${PARTY_MAX})`);
}

// ---------------------------------------------------------------- the map
//
// The brief names a Google Maps embed, and `/visit` promises in its own words that the frame is not fetched
// until a guest presses. Both halves are claims about bytes, so both are read from bytes rather than inferred
// from the component: no third-party frame in any built page — the moment the document contains the frame, the
// sentence above it is false — and on `/visit` the control that makes one, the URL it will point at, the
// coordinate pair inside it, and the line that says where the pin came from. An unexplained marker is a claim,
// not a fact, and this site does not publish unexplained pins.
const framed = all.filter(([, html]) => /<iframe\b/i.test(html));
if (framed.length)
  bad("map", `${framed.length} page(s) ship an <iframe>: ${framed.map(([r]) => r).join(", ")} — the page that says nothing is fetched until pressed is now fetching it in the document itself`);
else ok("map", "no iframe in any built page");

const visitHtml = pages["/visit"] ?? "";
if (!/data-map-load/.test(visitHtml)) bad("map", "/visit ships no [data-map-load] control — the embed the brief names has nothing to press");
const embedUrl = decodeHtml(visitHtml.match(/data-embed="([^"]*)"/)?.[1] ?? "");
if (!/output=embed/.test(embedUrl)) bad("map", `/visit's data-embed is ${JSON.stringify(embedUrl)} — that is not a Maps embed URL`);
const embedQuery = (embedUrl.split("q=")[1] ?? "").split("&")[0];
// Percent-decoded before the shape test, because the component builds the URL with `encodeURIComponent` —
// which is the correct way to write a coordinate pair into a query — and the comma comes out as `%2C`. The
// assertion is about the claim ("the embed points at a pair of numbers, not at a search string"), and a
// checker that only recognises one legal spelling of a value would report a working map as a broken one.
if (!/^-?\d+\.\d+,-?\d+\.\d+$/.test(decodeURIComponent(embedQuery)))
  bad("map", `/visit's embed carries no coordinate pair (q=${JSON.stringify(embedQuery)}) — an embed pointed at a search string is a different claim from a pin`);
if (!/plus code/.test(visitHtml)) bad("map", "/visit no longer prints where the pin came from");
if (!/Nothing is fetched from Google until/.test(visitHtml.replace(/\s+/g, " ")))
  bad("map", "/visit no longer says the map loads on the guest's press — the control has to explain itself before it is used");

// Attribute values arrive HTML-escaped, so `&z=17&output=embed` is `&amp;z=17…` in the document. Decoding first
// keeps this gate about the URL rather than about the serialiser.
function decodeHtml(text) {
  return String(text)
    .replace(/&#(x[\da-f]+|\d+);/gi, (_, code) =>
      String.fromCodePoint(code[0].toLowerCase() === "x" ? parseInt(code.slice(1), 16) : Number(code)),
    )
    .replace(/&rsquo;/g, "’")
    .replace(/&lsquo;/g, "‘")
    .replace(/&mdash;/g, "—")
    .replace(/&ndash;/g, "–")
    .replace(/&ldquo;/g, "“")
    .replace(/&rdquo;/g, "”")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
}

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
