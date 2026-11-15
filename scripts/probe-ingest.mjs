// M0 — feasibility probe for the menu pipeline. Answers three questions before any of the
// content spine gets built, and writes the evidence to research/probe-ingest.json:
//
//   1. can menu.or.ke be read without a browser, or does it need one?
//   2. are the hosted dish photos reachable from outside the browser (mirroring feasibility)?
//   3. is the local toolchain (node / npm / a headless Chrome) actually present?
//
//   node scripts/probe-ingest.mjs [--samples 6]
//
// Read-only. Nothing is installed, nothing is written outside research/.

import { execFile } from "node:child_process";
import { writeFile, access, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);
const ROOT = join(import.meta.dirname, "..");
const OUT = join(ROOT, "research", "probe-ingest.json");
const MENU_URL = "https://menu.or.ke/Habibi_Haven/habibi-haven.html";
const SAMPLES = Number(process.argv.includes("--samples")
  ? process.argv[process.argv.indexOf("--samples") + 1]
  : 6);

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36";

// ---------------------------------------------------------------- helpers
const BROWSERS = [
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
];
async function findBrowser() {
  for (const b of BROWSERS) {
    try { await access(b); return b; } catch { /* next */ }
  }
  return null;
}

// Dump a URL after the page's own JS has run. Chrome writes the serialised DOM to stdout.
async function render(browser, url, budget = 12000) {
  const { stdout } = await run(browser, [
    "--headless=new", "--disable-gpu", "--no-sandbox", "--virtual-time-budget=" + String(budget),
    "--dump-dom", url,
  ], { maxBuffer: 1 << 26, timeout: 180000 });
  return stdout;
}

// Count what the DOM actually offers, the same way the research capture did.
function survey(html) {
  const prices = [...html.matchAll(/KSh\s*([\d,]+)/gi)].map((m) => Number(m[1].replace(/,/g, "")));
  const imgs = [...html.matchAll(/<img\b[^>]*\bsrc="([^"]+)"/gi)].map((m) => m[1]);
  const hosted = [...new Set(imgs.filter((u) => /menu-photos|restaurant-photos|supabase|storage/i.test(u)))];
  return {
    bytes: html.length,
    priceMentions: prices.length,
    distinctPrices: [...new Set(prices)].length,
    minPrice: prices.length ? Math.min(...prices) : null,
    maxPrice: prices.length ? Math.max(...prices) : null,
    imgTags: imgs.length,
    hostedPhotoRefs: hosted.length,
    hasKSh: /KSh/i.test(html),
    hasItemCardClass: /item|dish|menu-item|product/i.test(html),
    scriptTags: (html.match(/<script\b/gi) || []).length,
  };
}

async function probeUrl(url, opts = {}) {
  const t0 = Date.now();
  try {
    const res = await fetch(url, {
      redirect: "follow",
      headers: { "user-agent": UA, referer: MENU_URL, ...opts.headers },
      signal: AbortSignal.timeout(opts.timeout ?? 20000),
    });
    const buf = new Uint8Array(await res.arrayBuffer());
    return { status: res.status, ct: res.headers.get("content-type"), bytes: buf.byteLength, ms: Date.now() - t0 };
  } catch (e) {
    return { error: e.name + ": " + e.message, ms: Date.now() - t0 };
  }
}

// Does the same URL load when a real browser asks for it? Reports naturalWidth per image.
async function browserImageTest(browser, urls) {
  const dir = await mkdtemp(join(tmpdir(), "ifs-probe-"));
  const file = join(dir, "imgtest.html");
  const list = urls.map((u, i) => ({ i, u }));
  const html = `<!doctype html><meta charset=utf-8><body><pre id=r></pre><script>
const urls = ${JSON.stringify(list)};
const out = [];
let done = 0;
for (const { i, u } of urls) {
  const im = new Image();
  im.onload = () => { out.push({ i, ok: true, w: im.naturalWidth, h: im.naturalHeight }); if (++done === urls.length) finish(); };
  im.onerror = () => { out.push({ i, ok: false }); if (++done === urls.length) finish(); };
  im.referrerPolicy = "no-referrer";
  im.src = u;
}
function finish() { document.getElementById("r").textContent = "IMGJSON" + JSON.stringify(out) + "IMGJSON"; }
setTimeout(finish, 15000);
<\/script></body>`;
  await writeFile(file, html, "utf8");
  const dom = await render(browser, "file:///" + file.replace(/\\/g, "/"), 18000);
  await rm(dir, { recursive: true, force: true });
  const m = dom.match(/IMGJSON(\[.*?\])IMGJSON/s);
  return m ? JSON.parse(m[1]) : null;
}

// ---------------------------------------------------------------- probe
const report = { ranAt: new Date().toISOString(), menuUrl: MENU_URL, samples: SAMPLES };
const browser = await findBrowser();
const npmVersion = async () => {
  // execFile refuses to run .cmd shims without a shell (Node's Win32 hardening), and the PATH
  // here may not carry the node directory — so call npm's own entry point through node.
  const { dirname, join } = await import("node:path");
  const cli = join(dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js");
  try { return (await run(process.execPath, [cli, "--version"])).stdout.trim(); } catch { /* fall through */ }
  try { return (await run("npm.cmd", ["--version"], { shell: true })).stdout.trim(); } catch { return "not reachable from this shell"; }
};
report.toolchain = {
  node: process.version,
  npm: await npmVersion(),
  headlessBrowser: browser || "none found",
};
if (!browser) {
  report.verdict = "BLOCKED — no Chrome or Edge to render the menu with";
  await writeFile(OUT, JSON.stringify(report, null, 2), "utf8");
  console.log(report.verdict);
  process.exit(1);
}

// 1 — plain fetch, no JS
report.plainFetch = await probeUrl(MENU_URL);
if (report.plainFetch.bytes) {
  const html = await fetch(MENU_URL).then((r) => r.text());
  report.plainFetch.survey = survey(html);
}

// 2 — rendered (once; the same DOM feeds the photo sampling below)
let domHtml = "";
try {
  domHtml = await render(browser, MENU_URL);
  report.rendered = survey(domHtml);
} catch (e) {
  report.rendered = { error: e.message };
}

// 3 — photo reachability, from the rendered DOM
const photoUrls = [...new Set([...domHtml.matchAll(/<img\b[^>]*\bsrc="(https?:[^"]+)"/gi)]
  .map((m) => m[1])
  .filter((u) => /menu-photos|restaurant-photos|storage|supabase|amazonaws/i.test(u)))].slice(0, SAMPLES);
report.photoSampleUrls = photoUrls;

if (photoUrls.length) {
  report.photosViaFetch = [];
  for (const u of photoUrls) report.photosViaFetch.push({ url: u, ...(await probeUrl(u, { timeout: 15000 })) });
  report.photosViaBrowser = await browserImageTest(browser, photoUrls).then((rows) =>
    (rows || []).map((r) => ({ url: photoUrls[r.i], loaded: r.ok, width: r.w, height: r.h })));
}

// ---------------------------------------------------------------- verdict
const fetched = report.plainFetch;
const rendered = report.rendered;
const okFetch = (report.photosViaFetch || []).filter((p) => p.status === 200).length;
const okBrowser = (report.photosViaBrowser || []).filter((p) => p.loaded).length;

report.readChannel =
  fetched?.survey?.priceMentions > 20 ? "plain fetch is enough"
  : rendered?.priceMentions > 20 ? "headless render required"
  : "neither channel yielded a readable menu";

report.mirrorChannel =
  !photoUrls.length ? "no hosted photo URLs in the rendered DOM — nothing sampled, mirroring unproven"
  : okFetch === photoUrls.length ? "fetch works for every sampled photo — mirroring is scriptable"
  : okFetch > 0 ? `mixed: ${okFetch}/${photoUrls.length} photos reachable by fetch`
  : okBrowser === photoUrls.length && photoUrls.length
    ? `browser-only: ${okBrowser}/${photoUrls.length} load in a browser but not via fetch — mirror through the browser or ask for originals`
    : "photos not reachable from this machine in either channel";

report.verdict = {
  readChannel: report.readChannel,
  mirrorChannel: report.mirrorChannel,
  renderedPriceMentions: rendered?.priceMentions ?? null,
  renderedDistinctPrices: rendered?.distinctPrices ?? null,
  renderedHostedPhotoRefs: rendered?.hostedPhotoRefs ?? null,
};

await writeFile(OUT, JSON.stringify(report, null, 2), "utf8");

console.log("toolchain:", JSON.stringify(report.toolchain));
console.log("plain fetch:", JSON.stringify(fetched).slice(0, 260));
console.log("rendered:", JSON.stringify(rendered).slice(0, 260));
console.log("photos sampled:", photoUrls.length);
for (const p of report.photosViaFetch || []) console.log("  fetch  ", p.status ?? p.error, (p.bytes || 0) + "B", p.url.slice(0, 78));
for (const p of report.photosViaBrowser || []) console.log("  browser", p.loaded ? `${p.width}x${p.height}` : "FAILED", p.url.slice(0, 78));
console.log("\nVERDICT:", JSON.stringify(report.verdict, null, 2));
console.log("written to", OUT);
