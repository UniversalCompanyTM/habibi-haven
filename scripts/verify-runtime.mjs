// scripts/verify-runtime.mjs — drive the built site in a real headless browser and prove it behaves.
//
// Why this exists: `verify-dist.mjs` can say the markup, hooks, references and a11y floor are right, but
// it cannot say anything about behaviour. The defects that actually reached a browser in this project —
// `DIAL_MAX is not defined` on the first tick of "Watch the day go", a fragment shader that declared
// `varying float vAlpha` twice so every frame threw `useProgram: program not valid`, a reveal that left
// content invisible above the fold — all of them sat behind a green build. Only running the page finds
// them, and the interaction MCP browser in this workspace has proven flaky under a 243-card page, so the
// harness is here instead of in a chat tool: no MCP, no extension, no third-party package.
//
// It speaks raw Chrome DevTools Protocol over the WebSocket that Node 24 already has, using the Chrome
// or Edge that is already installed. Nothing is downloaded.
//
// What it asserts, per page:
//   - zero console errors and zero uncaught exceptions (a page that logs "0 errors" is not a page that
//     works — the loop that spams useProgram errors was the symptom of a broken shader)
//   - the interaction contract, exercised with real events rather than checked for attributes
//   - for the door: the canvas paints, proven by screenshotting the hero with the canvas visible and
//     again with it hidden, decoding both back inside the page, and comparing pixel statistics. If the
//     WebGL layer contributed nothing, the two captures would be identical.
//
// Usage: npm run build && node scripts/verify-runtime.mjs [--base http://localhost:4322] [--port 9333] [--shots DIR]
// --port is only the starting point: if something already holds it the run moves to the next free port,
// because attaching to another Chrome's endpoint reads another run's pages.
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, existsSync, writeFileSync } from "node:fs";
import net from "node:net";
import { tmpdir } from "node:os";
import { join, delimiter } from "node:path";
import { platform } from "node:process";

const argv = process.argv.slice(2);
const arg = (name, dflt) => {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? dflt : argv[i + 1];
};
const base = arg("base", "http://localhost:4322").replace(/\/$/, "");
// --shots DIR keeps the element frames the hour test already captures. Numbers on their own pass or fail;
// a PNG is what shows whether the room actually looks different, and this project has already been
// caught once by a green assertion over a hero that rendered as black slabs.
const shotsDir = arg("shots", "") ? join(process.cwd(), arg("shots")) : null;
// --probe prints what the pass already measured instead of only the verdict it reached: the 8x8 luminance
// grid per hour and the palette the scene was painted from. It changes no threshold and no assertion — it
// exists because "the arch reads blown out at noon" is an art judgement, and an art judgement is only
// arguable once the numbers under it are on the table.
const probe = process.argv.includes("--probe");
let shotSeq = 0;
function saveShot(name, base64) {
  if (!shotsDir) return;
  mkdirSync(shotsDir, { recursive: true });
  writeFileSync(join(shotsDir, `${String(++shotSeq).padStart(2, "0")}-${name}.png`), Buffer.from(base64, "base64"));
}
// The debug port used to be a plain constant, and that turned two overlapping runs into a silent failure:
// the second Chrome could not bind 9333, so the second harness connected to the FIRST run's browser and
// waited there for a load event in a profile the first run had already deleted. Bind-then-release takes a
// port this process actually owns, and waitForBrowser below gives up loudly if the browser it spawned is
// not the one answering.
const port = await freePort(Number(arg("port", 9333)));

function freePort(from) {
  return new Promise((resolve, reject) => {
    const attempt = (candidate, tries) => {
      const probe = net.createServer();
      probe.once("error", (err) => {
        if (err.code === "EADDRINUSE" && tries < 24) attempt(candidate + 1, tries + 1);
        else reject(err);
      });
      probe.listen(candidate, "127.0.0.1", () => probe.close(() => resolve(candidate)));
    };
    attempt(from, 0);
  });
}

const CANDIDATES =
  platform === "win32"
    ? [
        "C:/Program Files/Google/Chrome/Application/chrome.exe",
        "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
      ]
    : ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "google-chrome", "microsoft-edge"];

// `existsSync` cannot see a bare PATH name — "google-chrome" is not a path, and on Linux it lives in a
// directory that changes between images. The first version of this lookup asked existsSync about all three
// candidates and fell through to `CANDIDATES.at(-1)` when none of them were literal files, which on a CI
// runner meant "try to spawn microsoft-edge" and a spawn error that looked like a broken site. So: trust an
// explicit HH_CHROME first (still there for a machine whose browser is nowhere on PATH; the runner does not
// need it, because `google-chrome` is on PATH and the loop below finds it), then an install location, then
// PATH. If nothing resolves, say so plainly — a missing browser is not a failed assertion, and the log has
// to make that distinction without anyone reading this file.
function resolveBrowser(name) {
  if (existsSync(name)) return name;
  const exe = platform === "win32" && !name.endsWith(".exe") ? `${name}.exe` : name;
  for (const dir of (process.env.PATH ?? "").split(delimiter)) {
    if (!dir) continue;
    const candidate = join(dir, exe);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

const browser =
  process.env.HH_CHROME || CANDIDATES.map(resolveBrowser).find(Boolean) || null;
if (!browser) {
  console.error(
    "verify-runtime: no browser found. Install Chrome/Edge or set HH_CHROME to the binary.\nTried: " +
      CANDIDATES.join(", "),
  );
  process.exit(2);
}
const profile = mkdtempSync(join(tmpdir(), "hh-cdp-"));

const chrome = spawn(
  browser,
  [
    "--headless=new",
    "--disable-gpu",
    // SwiftShader is how a headless Chrome gets a GL context at all. Without it the gate in lib/gate.mjs
    // correctly decides "no WebGL" and the door never mounts — which would make the canvas assertions
    // pass vacuously by not running.
    "--enable-unsafe-swiftshader",
    "--use-angle=swiftshader",
    "--no-sandbox",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-dev-shm-usage",
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
    "--window-size=1440,1000",
    "about:blank",
  ],
  { stdio: "ignore" },
);

const cleanup = () => {
  chrome.kill();
  try {
    rmSync(profile, { recursive: true, force: true });
  } catch {}
};
process.on("exit", cleanup);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------- CDP client
let ws;
let nextId = 1;
const pending = new Map();
const events = [];

function send(method, params = {}, sessionId) {
  const id = nextId++;
  ws.send(JSON.stringify(sessionId ? { id, method, params, sessionId } : { id, method, params }));
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject, method }));
}

async function waitForBrowser() {
  let info = null;
  for (let i = 0; i < 60; i += 1) {
    // Fail fast, and out loud, if the browser we started is gone: that is the one state where waiting
    // forever looks like a slow page.
    if (chrome.exitCode !== null || chrome.killed) {
      throw new Error(`the browser we spawned exited with code ${chrome.exitCode} — port ${port} was taken before it started`);
    }
    try {
      info = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
      break;
    } catch {
      // Chrome has not opened the endpoint yet. Every transport error lands here as a failed fetch, so
      // nothing distinguishes "not listening yet" from "refused" — the retry loop is the answer to both,
      // and the exit check above is what makes a dead browser a real error instead of a 15-second wait.
      await sleep(250);
    }
  }
  if (!info) throw new Error(`no DevTools endpoint on ${port} — is Chrome/Edge installed at ${browser}?`);
  // Loud on purpose: an endpoint that belongs to a different run answers on the port, and connecting to it
  // produced the worst failure this harness ever had — a run that hung for minutes on pages from someone
  // else's browser, in a temporary profile that run had already deleted.
  const url = info.webSocketDebuggerUrl ?? "";
  if (!url.includes(`:${port}/`)) throw new Error(`endpoint on ${port} reports ${url || "nothing"}, which is not this run's browser`);
  return url;
}

const wsUrl = await waitForBrowser();
ws = new WebSocket(wsUrl);
await new Promise((resolve, reject) => {
  ws.addEventListener("open", resolve, { once: true });
  ws.addEventListener("error", () => reject(new Error("CDP socket failed")), { once: true });
});
ws.addEventListener("message", (frame) => {
  const msg = JSON.parse(frame.data);
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject, method } = pending.get(msg.id);
    pending.delete(msg.id);
    if (msg.error) reject(new Error(`${method}: ${msg.error.message}`));
    else resolve(msg.result);
    return;
  }
  if (msg.method) events.push(msg);
});

const targetId = (await send("Target.createTarget", { url: "about:blank" })).targetId;
// attachToTarget answers with the session id; with flatten:true it is NOT necessarily the target id, and
// reusing targetId made every command fail "Session with given id not found".
const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
if (!sessionId) throw new Error("attachToTarget returned no sessionId");
const inPage = (method, params) => send(method, params, sessionId);
await inPage("Runtime.enable");
await inPage("Log.enable");
await inPage("Page.enable");

// ---------------------------------------------------------------- frame probe
// "The site is lightweight" is a claim about frames, and nothing in the markup or the build output can
// answer it. Wrapping requestAnimationFrame before any page script runs gives the harness a counter of
// callbacks and a timestamp per vsync, so a render loop that is running, a loop that stopped when the
// door scrolled out of sight, and a page that never started one are three different measurable answers.
// The wrapper is installed in the page, never in the source: the shipped code carries no test hook, and
// the callback it returns is the native one, so cancelAnimationFrame still works.
const FRAME_PROBE = `(() => {
  const native = window.requestAnimationFrame.bind(window);
  const f = { on: false, stamps: [] };
  window.__hhFrames = f;
  window.requestAnimationFrame = (cb) => native((now) => {
    if (f.on) f.stamps.push(now);
    return cb(now);
  });
})()`;
await inPage("Page.addScriptToEvaluateOnNewDocument", { source: FRAME_PROBE });

async function startFrames() {
  await evaluate("window.__hhFrames.stamps.length = 0; window.__hhFrames.on = true; return true;");
}

// Read the window back as frame statistics. Distinct timestamps are frames; callbacks per frame says how
// many loops were alive at once, which is how a page that quietly runs a leaked rAF loop gets caught. The
// honest ceiling on the home page is two, not one: three components register a repeating callback — the door
// (DoorScene `step`), the cursor trail (Cursor `draw`, which only re-arms on pointermove) and the preloader
// countdown (Preloader `tick`, which ends when the overlay does) — so a window that overlaps the preloader
// leaving can legitimately show 1.x. What would be a bug is a sustained third.
async function stopFrames() {
  return evaluate(`
    window.__hhFrames.on = false;
    const s = window.__hhFrames.stamps.slice();
    window.__hhFrames.stamps.length = 0;
    const uniq = [...new Set(s)].sort((a, b) => a - b);
    const perFrame = new Map();
    for (const t of s) perFrame.set(t, (perFrame.get(t) || 0) + 1);
    const d = [];
    for (let i = 1; i < uniq.length; i += 1) d.push(Math.round((uniq[i] - uniq[i - 1]) * 100) / 100);
    d.sort((a, b) => a - b);
    const pct = (p) => (d.length ? d[Math.min(d.length - 1, Math.floor(d.length * p))] : null);
    return {
      callbacks: s.length,
      frames: uniq.length,
      loops: uniq.length > 1 ? Math.round((s.length / (uniq.length - 1)) * 100) / 100 : null,
      maxPerFrame: perFrame.size ? Math.max(...perFrame.values()) : null,
      p50: pct(0.5),
      p95: pct(0.95),
      worst: d.length ? d[d.length - 1] : null,
      span: uniq.length > 1 ? Math.round(uniq[uniq.length - 1] - uniq[0]) : 0,
    };
  `);
}

// ---------------------------------------------------------------- key probe
// A synthetic KeyboardEvent does not move focus, does not fire a button's default action and does not
// type into an input — it only proves a listener exists. These are real browser key events through
// Input.dispatchKeyEvent, so the keyboard path asserted below is the path a guest on a laptop takes.
const KEY_CODES = { Tab: 9, Enter: 13, " ": 32, Escape: 27, "/": 191, ArrowRight: 39, ArrowLeft: 37 };

async function press(keyName, times = 1) {
  const letter = /^[a-zA-Z]$/.test(keyName);
  const vk = KEY_CODES[keyName] ?? (letter ? keyName.toUpperCase().charCodeAt(0) : 0);
  const printable = keyName.length === 1;
  // Enter and Space have to be sent as a full key sequence, not just a keydown: a focused button is
  // activated by Chrome's default action for the keypress, and a rawKeyDown alone reaches the listener
  // without ever producing the click. A test that only fires keydown would report the site as broken.
  const text = keyName === "Enter" ? "\r" : keyName === " " ? " " : printable ? keyName : undefined;
  const base = {
    key: keyName,
    code: letter ? `Key${keyName.toUpperCase()}` : keyName === "/" ? "Slash" : keyName === " " ? "Space" : keyName,
    windowsVirtualKeyCode: vk,
    nativeVirtualKeyCode: vk,
  };
  for (let i = 0; i < times; i += 1) {
    await inPage("Input.dispatchKeyEvent", { ...base, type: "rawKeyDown" });
    if (text !== undefined) await inPage("Input.dispatchKeyEvent", { ...base, type: "char", text, unmodifiedText: text });
    await inPage("Input.dispatchKeyEvent", { ...base, type: "keyUp" });
    await sleep(24);
  }
}

// What the keyboard is currently on, as the guest would experience it: an accessible name, a box on
// screen, and whether a focus indicator is actually visible. Reading the computed outline is the only way
// to tell a :focus-visible rule that exists from one that never matches — and an outline painted on a
// visually-hidden input is invisible too, so the label proxy it lights up is measured with it.
async function focusStop() {
  return evaluate(`
    const el = document.activeElement;
    const boxOf = (n) => n.getBoundingClientRect();
    const isEmpty = (n) => !n || n.width < 2 || n.height < 2;
    if (!el || el === document.body) return { tag: "body", name: "", inMain: false, ring: false, proxy: false, box: false, data: "", proxyOf: "" };
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    const name = (el.getAttribute("aria-label") || el.getAttribute("title") || el.textContent || el.value
      || el.placeholder || el.name || "").replace(/\\s+/g, " ").trim().slice(0, 44);
    const outlines = (n) => {
      const c = getComputedStyle(n);
      const ring = (c.outlineStyle !== "none" && parseFloat(c.outlineWidth) > 0) || c.boxShadow !== "none";
      return ring && !isEmpty(boxOf(n));
    };
    const label = el.closest("label");
    const proxies = [];
    if (el.nextElementSibling) proxies.push(el.nextElementSibling);
    if (label) { proxies.push(label, ...label.querySelectorAll("span, b")); }
    if (el.parentElement) proxies.push(el.parentElement);
    const proxyHit = proxies.find((n) => n && n.nodeType === 1 && outlines(n));
    return {
      tag: el.tagName.toLowerCase(),
      cls: String(typeof el.className === "string" ? el.className : "").replace(/\\s+/g, " ").trim().slice(0, 26),
      data: Object.keys(el.dataset ?? {}).join(",").slice(0, 30),
      type: el.getAttribute("type") || "",
      name,
      unnamed: name === "",
      inMain: !!el.closest("main"),
      box: !isEmpty(r),
      own: cs.outlineStyle !== "none" && parseFloat(cs.outlineWidth) > 0,
      ring: outlines(el),
      shadow: cs.boxShadow !== "none",
      proxy: !!proxyHit,
      proxyOf: proxyHit ? proxyHit.tagName.toLowerCase() + "." + String(proxyHit.className).slice(0, 20) : "",
      hiddenControl: isEmpty(r),
    };
  `);
}

// ---------------------------------------------------------------- capture
// The page-level listeners only see what JavaScript can see. Log.entryAdded is what carries the browser's
// own complaints — shader validation, CSP, failed requests — which is exactly the class of problem the
// broken door produced and no JS try/catch could ever have caught.
function drain() {
  const errors = [];
  const warnings = [];
  for (const event of events) {
    if (event.method === "Runtime.consoleAPICalled") {
      const text = (event.params.args ?? []).map((a) => a.value ?? a.description ?? a.type).join(" ").slice(0, 300);
      if (event.params.type === "error") errors.push(`console.error: ${text}`);
      else if (event.params.type === "warning") warnings.push(`console.warn: ${text}`);
    }
    if (event.method === "Runtime.exceptionThrown") {
      const d = event.params.exceptionDetails;
      errors.push(`uncaught: ${d.exception?.description?.split("\n")[0] ?? d.text}`);
    }
    if (event.method === "Log.entryAdded" && event.params.entry.level === "error") {
      const e = event.params.entry;
      errors.push(`${e.source}/${e.text.slice(0, 220)}`);
    }
  }
  events.length = 0;
  // one INVALID_OPERATION per frame is a dead program, not a one-off glitch; collapse the repeat so the
  // report shows the class of failure and its volume instead of 350 identical lines.
  const counts = new Map();
  for (const line of errors) counts.set(line, (counts.get(line) ?? 0) + 1);
  return {
    errors: [...counts].map(([line, n]) => (n > 1 ? `${line}  ×${n}` : line)),
    warnings: [...new Set(warnings)].slice(0, 8),
  };
}

// Runtime.callFunctionOn insists on an objectId or executionContextId; Runtime.evaluate has no such
// requirement, so batteries are wrapped in an async IIFE and payloads too large to inline are parked on
// `window` by a preceding evaluate instead of passed as arguments.
// The body goes into an async function, so it must say `return` — `evaluate(\`matchMedia(q).matches\`)` reads
// the value in the page and hands back undefined, which then looks exactly like a false answer about the
// browser. Every one of these bodies is a statement block, not an expression.
async function evaluate(body) {
  const out = await inPage("Runtime.evaluate", {
    expression: `(async () => {\n${body}\n})()`,
    awaitPromise: true,
    returnByValue: true,
  });
  if (out.exceptionDetails) {
    throw new Error(`battery threw: ${out.exceptionDetails.exception?.description ?? out.exceptionDetails.text}`);
  }
  return out.result.value;
}

async function park(name, value) {
  await inPage("Runtime.evaluate", { expression: `window[${JSON.stringify(name)}] = ${JSON.stringify(value)}; 1` });
}

async function goto(path) {
  events.length = 0;
  await inPage("Page.navigate", { url: base + path });
  // Wait for the load event rather than a fixed sleep: /menu carries 173 photographs and a 243-row grid,
  // and a page that has not finished loading produces a battery full of "no such element" that means
  // nothing. The deadline keeps a hung page from hanging the harness.
  const deadline = Date.now() + 25000;
  while (Date.now() < deadline && !events.some((e) => e.method === "Page.loadEventFired")) await sleep(120);
  // islands, the clock, and the dynamic `import("three")` all settle after load
  await sleep(900);
  if (Date.now() >= deadline) console.log(`  warn load event never arrived for ${path} — battery ran anyway`);
}

async function shot() {
  const { data } = await inPage("Page.captureScreenshot", { format: "png" });
  return data;
}

// Decode a PNG inside the page and return pixel statistics — the browser does the decoding, so this
// script needs no image library and nothing is installed to get here.
async function pixelStats(base64) {
  await park("__hhShot", base64);
  return evaluate(`
    const img = new Image();
    img.src = "data:image/png;base64," + window.__hhShot;
    await img.decode();
    const c = document.createElement("canvas");
    c.width = img.width; c.height = img.height;
    const g = c.getContext("2d", { willReadFrequently: true });
    g.drawImage(img, 0, 0);
    const d = g.getImageData(0, 0, c.width, c.height).data;
    const mean = [0, 0, 0]; let n = 0;
    const uniq = new Set();
    // A coarse 8x8 luminance grid, sampled at the SAME pixel coordinates every frame: the stride is a
    // constant of the image size, so two frames of the same page are comparable block against block. That
    // is what makes "did the room change" answerable at all — a whole-frame mean moves a point or two when
    // the lamps strike up, and a block grid shows where the light went.
    const B = 8;
    const lum = new Float64Array(B * B), seen = new Float64Array(B * B);
    // stride: sample ~1 in every 900 pixels; enough to characterise a 1440x1000 frame, cheap to compare
    for (let i = 0; i < d.length; i += 4 * 887) {
      mean[0] += d[i]; mean[1] += d[i + 1]; mean[2] += d[i + 2]; n += 1;
      uniq.add((d[i] >> 4) + "," + (d[i + 1] >> 4) + "," + (d[i + 2] >> 4));
      const p = i / 4;
      const x = p % c.width, y = (p - x) / c.width;
      const b = ((y * B) / c.height | 0) * B + ((x * B) / c.width | 0);
      lum[b] += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
      seen[b] += 1;
    }
    const sig = [];
    for (let b = 0; b < B * B; b += 1) sig.push(seen[b] ? Math.round((lum[b] / seen[b]) * 100) / 100 : -1);
    return { mean: mean.map((v) => Math.round(v / n)), uniq: uniq.size, size: [c.width, c.height], sig };
  `);
}

// Root-mean-square difference between two signatures. Two frames of a lit scene that is merely breathing
// differ by a couple of units; a rig that moved an hour differs by tens.
function sigDistance(a, b) {
  if (!a?.sig || !b?.sig) return null;
  let total = 0;
  for (let i = 0; i < a.sig.length; i += 1) total += (a.sig[i] - b.sig[i]) ** 2;
  return Math.round(Math.sqrt(total / a.sig.length) * 100) / 100;
}

// Screenshot one element's box, so a claim about the door can be measured on the door instead of on the
// whole viewport, where the page background answers to the clock too and would take the credit.
async function shotRegion(selector, name = "region") {
  const clip = await evaluate(`
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  `);
  if (!clip || !clip.width || !clip.height) return null;
  const { data } = await inPage("Page.captureScreenshot", {
    format: "png",
    clip: { ...clip, scale: 1 },
  });
  saveShot(name, data);
  return pixelStats(data);
}

// The whole viewport, photograph and scrim and copy included. The door-region frames answer "did the rig
// move"; they cannot answer "can the headline be read", and only the composite a guest actually sees does.
async function shotViewport(name) {
  const { data } = await inPage("Page.captureScreenshot", { format: "png" });
  saveShot(name, data);
  return pixelStats(data);
}

// A single frame of a running scene is not a measurement of a lighting state: the dust drifts and the
// lamps breathe, so any one capture carries that motion as well as the hour. Averaging a short burst per
// block keeps the hour (deterministic) and cancels the motion (random per frame), which is the difference
// between asking "did the rig move" and asking "did anything on screen move at all".
function avgSig(frames) {
  const usable = frames.filter((f) => f?.sig);
  if (!usable.length) return null;
  const sig = [];
  for (let b = 0; b < usable[0].sig.length; b += 1) {
    const vals = usable.map((f) => f.sig[b]).filter((v) => v >= 0);
    sig.push(vals.length ? Math.round((vals.reduce((s, v) => s + v, 0) / vals.length) * 100) / 100 : -1);
  }
  return { sig };
}

// Mean step between successive frames of one hour — the noise floor the hour gap has to clear.
function meanStep(frames) {
  const steps = [];
  for (let i = 1; i < frames.length; i += 1) {
    const d = sigDistance(frames[i - 1], frames[i]);
    if (d !== null) steps.push(d);
  }
  return steps.length ? Math.round((steps.reduce((s, v) => s + v, 0) / steps.length) * 100) / 100 : null;
}

// ---------------------------------------------------------------- batteries
const results = [];
const failures = [];

// `ignore` carries the complaints a route is supposed to produce. The 404 check asks for a URL that does
// not exist, so "failed to load resource: 404" is the experiment working — filtering it after page() had
// already pushed the failure into the report is what made the run look red for a green reason.
async function page(path, battery, ignore = []) {
  await goto(path);
  const value = await evaluate(battery);
  const { errors, warnings } = drain();
  const kept = errors.filter((line) => !ignore.some((re) => re.test(line)));
  results.push({ path, value, errors: kept, warnings });
  if (kept.length) failures.push(`${path} logged ${kept.length} error(s): ${kept.slice(0, 3).join(" | ")}`);
  return value;
}

// Identical to page(), except that the label in the report can differ from the URL that gets fetched.
// The reload and reduced-motion passes need that: handing a made-up label to goto() navigates to a 404
// and then reports the 404 page as if it were the page under test.
async function runAt(path, label, battery) {
  await goto(path);
  const value = await evaluate(battery);
  const { errors, warnings } = drain();
  results.push({ path: label, value, errors, warnings });
  if (errors.length) failures.push(`${label} logged ${errors.length} error(s): ${errors.slice(0, 3).join(" | ")}`);
  return value;
}

// ---- home: the door must actually contribute pixels, and the dial must move the room
const door = (async () => {
  await goto("/");
  const facts = await evaluate(`
    const host = document.querySelector("[data-door]");
    const canvas = host && host.querySelector("canvas");
    const root = getComputedStyle(document.documentElement);
    return {
      tier: canvas ? "webgl-mounted" : "no-canvas",
      hasCanvas: !!canvas,
      live: canvas ? canvas.hasAttribute("data-live") : false,
      buffer: canvas ? [canvas.width, canvas.height] : null,
      ariaHidden: canvas ? canvas.getAttribute("aria-hidden") : null,
      stillPainted: getComputedStyle(document.querySelector(".hero__still")).backgroundImage.includes("venue-facade-night"),
      hour: root.getPropertyValue("--hour").trim(),
      night: root.getPropertyValue("--night").trim(),
      // measured, not class-guessed: what a visitor sees is opacity and height, and a reveal that never
      // fires leaves elements at opacity 0 while carrying whatever class the animation uses
      revealed: [...document.querySelectorAll("[data-reveal]")].filter((el) => Number(getComputedStyle(el).opacity) > 0.9).length,
      revealTotal: document.querySelectorAll("[data-reveal]").length,
      hiddenAnywhere: [...document.querySelectorAll("[data-reveal]")]
        .filter((el) => Number(getComputedStyle(el).opacity) < 0.1).length,
      aboveFoldHidden: [...document.querySelectorAll("[data-reveal]")]
        .filter((el) => el.getBoundingClientRect().top < innerHeight && getComputedStyle(el).opacity === "0").length,
      cursor: !!document.querySelector("[data-cursor]"),
      // Magnetic pull: the cursor script reads [data-magnetic], so the hook has to exist in markup and the
      // element has to actually move. A feature whose selector nothing emits is only a comment, and the
      // release matters as much as the pull — a leaning button the guest has walked away from is a defect.
      magnet: (() => {
        const el = document.querySelector("[data-magnetic]");
        const fine = matchMedia("(pointer: fine)").matches;
        if (!el) return { present: false, fine };
        const box = el.getBoundingClientRect();
        el.dispatchEvent(new PointerEvent("pointermove", {
          clientX: box.left + box.width * 0.85,
          clientY: box.top + box.height * 0.5,
          bubbles: true,
          pointerType: "mouse",
        }));
        const moved = el.style.translate;
        document.dispatchEvent(new PointerEvent("pointerleave", { bubbles: true, pointerType: "mouse" }));
        return {
          present: true,
          fine,
          reduced: matchMedia("(prefers-reduced-motion: reduce)").matches,
          moved,
          released: el.style.translate === "",
        };
      })(),
    };
  `);
  const withCanvas = await pixelStats(await shot());
  // hide the WebGL layer only, leaving the CSS still underneath, and see whether the frame changes at all
  await evaluate(`
    const c = document.querySelector("[data-door] canvas");
    if (c) c.style.display = "none";
    return true;
  `);
  const withoutCanvas = await pixelStats(await shot());
  await evaluate(`
    const c = document.querySelector("[data-door] canvas");
    if (c) c.style.display = "";
    return true;
  `);
  const dial = await evaluate(`
    const dialEl = document.querySelectorAll("[data-dial]")[1] || document.querySelector("[data-dial]");
    const input = dialEl.querySelector("[data-dial-input]");
    const text = (el) => el.textContent.replace(/\\s+/g, " ").trim().slice(0, 90);
    const hourVar = () => getComputedStyle(document.documentElement).getPropertyValue("--hour").trim();
    const before = { hour: hourVar(), dialText: text(dialEl) };
    input.value = "20";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await new Promise((r) => setTimeout(r, 150));
    const at20 = { hour: hourVar(), dialText: text(dialEl), openSaysOpen: /open/i.test(text(dialEl)) && !/closed/i.test(text(dialEl)) };
    input.value = "3";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await new Promise((r) => setTimeout(r, 150));
    const at3 = { hour: hourVar(), dialText: text(dialEl), saysClosed: /closed/i.test(text(dialEl)) };
    const now = document.querySelector("[data-dial-now]");
    let back = null;
    if (now) { now.click(); await new Promise((r) => setTimeout(r, 150)); back = hourVar(); }
    const eatNow = new Date(Date.now() + 3 * 3600 * 1000);
    return { before, at20, at3, afterBackToNow: back, nairobiNow: eatNow.toISOString().slice(11, 16), nights: getComputedStyle(document.documentElement).getPropertyValue("--night").trim() };
  `);
  // Reveal state at load says nothing: below the fold, opacity 0 is the correct answer. What a guest
  // notices is content that stayed invisible after they had been past it, so the page is walked first and
  // the question asked afterwards. The class is what the mechanism adds; opacity is its consequence and
  // carries a 700-800ms transition plus a per-element delay, so sampling it mid-flight reports "stuck"
  // for elements that are on their way in — which is how four reveals got blamed for being broken.
  const reveal = await evaluate(`
    const nodes = [...document.querySelectorAll("[data-reveal], .kin")];
    const H = document.documentElement.scrollHeight;
    for (const frac of [0.15, 0.35, 0.55, 0.75, 0.95, 1]) {
      scrollTo({ top: H * frac, behavior: "instant" });
      await new Promise((r) => setTimeout(r, 650));
    }
    const missed = nodes.filter((el) => !el.classList.contains("is-in"));
    return { total: nodes.length, missed: missed.length, which: missed.slice(0, 6).map((el) => el.tagName.toLowerCase() + "." + String(el.className).replace(/\\s+/g, ".").slice(0, 40)) };
  `);
  const { errors, warnings } = drain();
  const contributed = withCanvas.uniq !== withoutCanvas.uniq || withCanvas.mean.join() !== withoutCanvas.mean.join();
  results.push({ path: "/", value: { facts, withCanvas, withoutCanvas, contributed, dial, reveal }, errors, warnings });
  if (errors.length) failures.push(`/ logged ${errors.length} error(s): ${errors.slice(0, 3).join(" | ")}`);
  if (facts.hasCanvas && !contributed) failures.push("/ the door canvas is mounted but changes no pixels — it is rendering nothing over the photograph");
  if (facts.hasCanvas && !facts.live) failures.push("/ the door canvas mounted but never faded in (data-live absent)");
  if (facts.aboveFoldHidden > 0) failures.push(`/ ${facts.aboveFoldHidden} reveal element(s) are above the fold and stuck at opacity 0`);
  if (!facts.magnet.present) failures.push("/ emits no [data-magnetic] target, so the pull the cursor script implements never happens");
  else if (facts.magnet.fine && !facts.magnet.reduced && !facts.magnet.moved)
    failures.push(`/ the magnet did not move: a pointermove near the edge of the hero button left translate "${facts.magnet.moved}"`);
  else if (facts.magnet.fine && !facts.magnet.reduced && facts.magnet.moved && !facts.magnet.released)
    failures.push(`/ the magnetised button kept its offset after the pointer left the document: translate "${facts.magnet.moved}"`);
  if (reveal.missed > 0)
    failures.push(`/ ${reveal.missed} of ${reveal.total} reveal elements were still invisible after the whole page was walked: ${reveal.which.join(", ")}`);
  if (dial.at20.hour === dial.before.hour) failures.push("/ the dial did not write --hour — the light rig is not coupled");
  // 20:00 in Nairobi is inside the hours of record (06:30–23:00): a dial that says "Closed" there is
  // lying about when the restaurant opens, which is the one thing a visitor came to find out.
  if (dial.at20.hour !== "20" && Number(dial.at20.hour) !== 20) failures.push(`/ dial at 20:00 wrote --hour ${dial.at20.hour}`);
  if (dial.at20.dialText && /closed/i.test(dial.at20.dialText)) failures.push(`/ dial at 20:00 reads “${dial.at20.dialText}” — 20:00 is inside the hours of record`);
  if (dial.at3.dialText && /open now/i.test(dial.at3.dialText)) failures.push(`/ dial at 03:00 reads “${dial.at3.dialText}” — it should say closed`);
  const nowHour = Number(dial.afterBackToNow);
  const eatHour = Number(dial.nairobiNow.slice(0, 2)) + Number(dial.nairobiNow.slice(3, 5)) / 60;
  if (Number.isFinite(nowHour) && Math.abs(nowHour - eatHour) > 1.1) {
    failures.push(`/ "back to now" set --hour ${nowHour} but the Nairobi clock reads ${dial.nairobiNow}`);
  }
})();

await door;

// ---- menu: 243 rows, and every control in the explorer has to answer
const menu = await page(
  "/menu",
  `
  const errs = [];
  addEventListener("error", (e) => errs.push("error: " + e.message));
  const q = (s) => document.querySelector(s);
  const all = (s) => [...document.querySelectorAll(s)];
  const vis = () => all("[data-card]").filter((c) => c.getBoundingClientRect().height > 0);
  // offsetParent was the first choice and it lied: it answers null for anything inside a closed
  // <details>, which is how a collapsed section reads as "0 of 243 rows visible" on a page that shows
  // its rows. A measured height is what a visitor can actually see.
  // "open" here means what the explorer means by it: a subgroup the last pass did not hide. Counting
  // details elements was a guess about markup this page does not use.
  const openSections = () => all("[data-subgroup]:not([hidden])").length;
  const input = (el, v, t) => { el.value = v; el.dispatchEvent(new Event(t || "input", { bubbles: true })); };
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const step = {};
  const total = all("[data-card]").length;
  step.initial = { total, visible: vis().length, sections: all("[data-subgroup]").length, groups: all("[data-group]").length, openish: openSections(), count: q("[data-count]") ? q("[data-count]").textContent.trim() : null };
  // the six rooms the home page and /visit deep-link into have to be anchor targets here or those links
  // land on a page that does not scroll anywhere
  step.hashTargets = ["morning", "small-plates", "kitchen", "handheld", "house", "bar"].map((id) => ({ id, present: !!document.getElementById(id) }));
  step.hiddenExample = (() => {
    const c = all("[data-card]").find((x) => x.getBoundingClientRect().height === 0);
    if (!c) return "none hidden";
    const chain = [];
    for (let el = c; el && chain.length < 6; el = el.parentElement) {
      chain.push(el.tagName.toLowerCase() + (el.dataset.subgroup !== undefined ? "[data-subgroup]" : el.dataset.group !== undefined ? "[data-group]" : "") + (el.tagName === "DETAILS" ? (el.open ? ":open" : ":closed") : ""));
    }
    return chain.join(" < ");
  })();

  input(q("[data-q]"), "chai"); await wait(200);
  step.search = { visible: vis().length, count: q("[data-count]").textContent.trim().slice(0, 60), allMatch: vis().every((c) => /chai/i.test(c.textContent)) };

  input(q("[data-q]"), "zzzqqq"); await wait(200);
  const empty = q("[data-empty]");
  step.noResults = { visible: vis().length, emptyVisible: empty ? empty.getBoundingClientRect().height > 0 : "no [data-empty] element" };

  q("[data-reset]").click(); await wait(200);
  step.reset = { visible: vis().length, query: q("[data-q]").value, count: q("[data-count]").textContent.trim().slice(0, 40) };

  const tag = all("[data-tag]").find((b) => /goat/i.test(b.textContent));
  if (tag) { tag.click(); await wait(200); step.tag = { label: tag.textContent.trim(), visible: vis().length, pressed: tag.getAttribute("aria-pressed") }; }
  q("[data-reset]").click(); await wait(200);

  // "/" focuses the box and Escape hands it back — the two shortcuts the explorer promises a laptop guest
  input(q("[data-q]"), "rice"); await wait(150);
  q("[data-q]").focus();
  // dispatched from the input, not from window: the handler only releases the box when the keystroke
  // arrived while the caret was inside it (it reads event.target.tagName to decide "is the guest typing")
  q("[data-q]").dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  await wait(250);
  step.escape = { value: q("[data-q]").value, visible: vis().length, released: document.activeElement !== q("[data-q]") };

  const sort = q("[data-sort]");
  const modes = sort && sort.options ? [...sort.options].map((o) => o.value) : null;
  if (sort && modes) {
    // Sorting is per section on purpose — the menu's own order is an argument about what the kitchen wants
    // you to see first — so "cheapest first" has to hold inside each deck. Read across the whole page and
    // the second section's KSh 650 looks like a violation of the first section's KSh 1,100.
    const decks = () => all("[data-subgroup]").map((s) => [...s.querySelectorAll("[data-card]")].filter((c) => !c.hasAttribute("hidden")));
    const firstBad = (list, worse) => {
      for (let i = 1; i < list.length; i += 1) if (worse(list[i - 1], list[i])) return list.slice(Math.max(0, i - 2), i + 2);
      return null;
    };
    sort.value = modes.includes("cheap") ? "cheap" : modes[1];
    sort.dispatchEvent(new Event("change", { bubbles: true }));
    await wait(300);
    const cheapViolations = decks().map((d) => firstBad(d.map((c) => Number(c.dataset.price)), (a, b) => a > b)).filter(Boolean);
    sort.value = "az";
    sort.dispatchEvent(new Event("change", { bubbles: true }));
    await wait(300);
    const azViolations = decks().map((d) => firstBad(d.map((c) => c.dataset.name ?? ""), (a, b) => a.localeCompare(b) > 0)).filter(Boolean);
    step.sort = { decks: decks().length, cheapViolations, azViolations };
    sort.value = modes[0]; sort.dispatchEvent(new Event("change", { bubbles: true })); await wait(250);
  }

  // the price bands are buttons carrying their own thresholds; clicking one is what the guest does, and
  // the assertion is that nothing outside the threshold the label states survived
  const bandBtn = all("[data-band]").find((b) => b.dataset.min === "500") ?? all("[data-band]")[0];
  if (bandBtn) {
    bandBtn.click(); await wait(250);
    const lo = Number(bandBtn.dataset.min ?? 0);
    const hi = bandBtn.dataset.max === "" || bandBtn.dataset.max === undefined ? Infinity : Number(bandBtn.dataset.max);
    const shown = vis().map((c) => Number(c.dataset.price)).filter((n) => Number.isFinite(n));
    step.band = { label: bandBtn.textContent.trim(), visible: shown.length, lo, hi, min: Math.min(...shown), max: Math.max(...shown), inRange: shown.length > 0 && shown.every((p) => p >= lo && p <= hi) };
    q("[data-reset]").click(); await wait(200);
  }

  const add = vis().find((c) => c.querySelector("[data-add]"))?.querySelector("[data-add]");
  if (add) {
    add.click(); await wait(300);
    step.add = {
      labelAfter: add.textContent.trim(),
      on: !!add.closest("[data-card]")?.hasAttribute("data-on"),
      cardPrice: add.closest("[data-card]")?.dataset.price ?? null,
      storageKeys: Object.keys(localStorage),
      tableSize: (JSON.parse(localStorage.getItem("habibi-haven:table:v1") || "null") || { lines: [] }).lines?.length ?? null,
    };
  }
  step.finalVisible = vis().length;
  return { step, consoleErrorsFromPageScript: errs };
`,
);
if (menu) {
  const s = menu.step;
  // The default state of the menu page is the whole menu. A page whose counter says "Showing all 243"
  // while nothing is on screen is worse than a page that says nothing: it reports health over a corpse.
  if (s.initial.visible === 0) {
    failures.push(`/menu has 0 of ${s.initial.total} rows measurable on screen (sections: ${s.initial.sections}, open-ish: ${s.initial.openish}; first hidden row ancestry: ${s.initial.hiddenExample ?? s.hiddenExample})`);
  } else if (s.initial.visible !== s.initial.total) {
    failures.push(`/menu shows ${s.initial.visible} of ${s.initial.total} rows before the guest touched anything`);
  }
  if (s.initial.count && !s.initial.count.includes(String(s.initial.visible))) {
    failures.push(`/menu counts ${s.initial.visible} rows on screen but the live region says “${s.initial.count}”`);
  }
  // The container hook has to select containers. When [data-family] meant both "a family section" and
  // "this dish belongs to that family", this count read 249 on a page with 6 families, and that inflation
  // is exactly what made the section pass delete every card. One name, one meaning, and a number that
  // proves it: groups == the rooms the rest of the site deep-links into.
  if (s.initial.groups !== s.hashTargets.length) {
    failures.push(`/menu has ${s.initial.groups} [data-group] containers but ${s.hashTargets.length} rooms are deep-linked — a structural hook is also sitting on dish cards`);
  }
  if (s.search.visible === 0) failures.push(`/menu searching "chai" matched ${s.search.visible} rows — the filter shows nothing`);
  if (s.search.visible && !s.search.allMatch) failures.push('/menu the "chai" search left a row on screen that does not contain chai');
  if (s.noResults && s.noResults.emptyVisible !== true) {
    failures.push(`/menu shows no empty-state when a search matches nothing (got ${JSON.stringify(s.noResults)})`);
  }
  if (s.reset && s.reset.query !== "") failures.push(`/menu "reset" left the search box holding "${s.reset.query}" instead of clearing it`);
  if (s.reset && s.reset.visible !== s.initial.total) failures.push(`/menu "reset" restored ${s.reset.visible} of ${s.initial.total} rows`);
  if (s.escape && (s.escape.value !== "" || s.escape.visible !== s.initial.total || !s.escape.released)) {
    failures.push(`/menu Escape left the box at "${s.escape.value}" with ${s.escape.visible} rows and focus still inside: ${!s.escape.released}`);
  }
  const absent = (s.hashTargets ?? []).filter((h) => !h.present).map((h) => h.id);
  if (absent.length) failures.push(`/menu has no anchor for /menu#${absent.join(", /menu#")} — the deep links on home and /visit land nowhere`);
  if (s.band && s.band.inRange === false) failures.push(`/menu the band “${s.band.label}” (${s.band.lo}–${s.band.hi}) let prices ${s.band.min}–${s.band.max} through`);
  if (s.sort && s.sort.cheapViolations.length) failures.push(`/menu cheapest-first is out of order inside ${s.sort.cheapViolations.length} section(s), e.g. ${JSON.stringify(s.sort.cheapViolations[0])}`);
  if (s.sort && s.sort.azViolations.length) failures.push(`/menu A–Z is out of order inside ${s.sort.azViolations.length} section(s), e.g. ${JSON.stringify(s.sort.azViolations[0])}`);
  if (s.tag && s.tag.visible === s.initial.visible) failures.push(`/menu the "${s.tag.label}" tag filter did not narrow anything`);
  if (s.add && !s.add.on) failures.push(`/menu "Add to table" did not mark the card (${JSON.stringify(s.add)})`);
}

// ---- table: the wish-list round-trip (this is the page that makes claims about a real restaurant)
const table = await page(
  "/table",
  `
  const q = (s) => document.querySelector(s);
  const all = (s) => [...document.querySelectorAll(s)];
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const out = {};
  out.serverControls = { builder: !!q("[data-builder]"), cards: all("[data-card]").length, party: all("[data-party]").length };
  const add = q("[data-add]");
  if (add) { add.click(); await wait(250); }
  out.afterAdd = {
    rows: all("[data-lines] [data-inc], [data-inc]").length,
    dec: all("[data-dec]").length,
    drop: all("[data-drop]").length,
    total: q("[data-total]") ? q("[data-total]").textContent.trim() : null,
    breakdown: q("[data-breakdown]") ? q("[data-breakdown]").textContent.trim() : null,
    emptyHidden: q("[data-empty]") ? q("[data-empty]").hidden : "none",
    storage: Object.keys(localStorage),
  };
  const inc = q("[data-inc]");
  if (inc) { const before = out.afterAdd.total; inc.click(); await wait(250); out.incChangedTotal = { before, after: q("[data-total]") ? q("[data-total]").textContent.trim() : null }; }
  const party = all("[data-party]").find((b) => /\\+|more|increase/.test(b.textContent) || b.dataset.party === "inc");
  if (party) { party.click(); await wait(250); out.party = { dots: q("[data-party-dots]") ? q("[data-party-dots]").textContent.trim() : null, note: q("[data-party-note]") ? q("[data-party-note]").textContent.trim() : null, advice: q("[data-advice]") ? { hidden: q("[data-advice]").hidden, text: q("[data-advice]").textContent.trim() } : null }; }
  const opt = q("[data-option]");
  if (opt && opt.tagName === "SELECT") { opt.selectedIndex = 1; opt.dispatchEvent(new Event("change", { bubbles: true })); await wait(250); out.option = { value: opt.value, total: q("[data-total]") ? q("[data-total]").textContent.trim() : null }; }
  const copy = q("[data-copy-link]");
  if (copy) { copy.click(); await wait(250); out.copyState = q("[data-copy-state]") ? q("[data-copy-state]").textContent.trim() : "no state element"; }
  const wa = q("[data-whatsapp]");
  out.whatsapp = wa ? { href: (wa.getAttribute("href") || "").slice(0, 90), isReservationLanguage: /book|reserv|confirm/i.test(wa.textContent) } : null;
  out.url = location.href;
  out.queryHasTable = /[?&]t=/.test(location.search);
  const clear = q("[data-clear]");
  if (clear) { clear.click(); await wait(200); out.afterClear = { rows: all("[data-inc]").length, emptyHidden: q("[data-empty]") ? q("[data-empty]").hidden : null }; }
  return out;
`,
);
if (table && table.afterAdd.rows === 0) failures.push("/table adding a dish produced no line — the configurator does not build");
if (table && table.incChangedTotal && table.incChangedTotal.before === table.incChangedTotal.after) {
  failures.push("/table the quantity control did not change the total");
}
if (table && table.whatsapp && table.whatsapp.isReservationLanguage) {
  failures.push("/table the WhatsApp handoff uses booking/reservation/confirm language — the table is a wish-list, not a booking");
}

// ---- visit + 404: no dead links, no errors, and a page with no dial must not be a page with a dead dial
await page("/visit", `
  const q = (s) => document.querySelector(s);
  const all = (s) => [...document.querySelectorAll(s)];
  const input = q("[data-dial-input]");
  if (input) { input.value = "7"; input.dispatchEvent(new Event("input", { bubbles: true })); }
  const hrefs = all("a[href]").map((a) => a.getAttribute("href"));
  return {
    dial: !!input,
    hourAfter: getComputedStyle(document.documentElement).getPropertyValue("--hour").trim(),
    localLinks: hrefs.filter((h) => h.startsWith("/")),
    external: all('a[href^="http"]').length,
    allExternalSecure: all('a[href^="http"]')
      .map((a) => a.href)
      .filter((h) => !h.startsWith("https://"))
      .slice(0, 5),
    mapLink: hrefs.find((h) => /google\\.com\\/maps|maps\\.google|\\bgeo:/i.test(h)) ?? null,
    brokenLocal: (() => {
      const pages = ["/", "/menu", "/table", "/visit", "/404"];
      return hrefs
        .filter((h) => h.startsWith("/"))
        .map((h) => ({ whole: h, path: h.split("#")[0].split("?")[0] }))
        // trailingSlash is "never" in astro.config: /menu/ is a different URL from /menu, and the build
        // answers the second one with the 404 page, so the comparison must be exact, hash aside
        .filter((h) => h.path !== "" && !pages.includes(h.path) && !/\\.(jpg|png|svg|css|js|json|ico|woff2|mp4)$/i.test(h.path))
        .map((h) => h.whole)
        .slice(0, 12);
    })(),
  };
`);

const notFound = await page(
  "/definitely-not-a-page",
  `
  return { status: document.title, hasMenuLink: !!document.querySelector('a[href="/menu"]'), body: document.body.innerText.slice(0, 80) };
`,
  [/status of 404/, /Failed to load resource/]
);
if (notFound && !/nothing at that address|not found|404/i.test(notFound.status || "")) {
  failures.push(`/ unknown URL did not render the 404 page (title: ${notFound && notFound.status})`);
}
if (notFound && !notFound.hasMenuLink) failures.push("/ the 404 page offers no way back to the menu");

// ---- the table code round-trip: a link someone texts must rebuild the same table
const roundTrip = await page("/table?t=3%7Cfull-mandyx2", `
  const q = (s) => document.querySelector(s);
  const all = (s) => [...document.querySelectorAll(s)];
  return {
    rows: all("[data-inc]").length,
    names: all("[data-card]").map((c) => c.querySelector("h3, [data-name]")?.textContent.trim()).slice(0, 4),
    total: q("[data-total]") ? q("[data-total]").textContent.trim() : null,
    party: q("[data-party-count]") ? q("[data-party-count]").textContent.trim() : null,
    whatsappHref: q("[data-whatsapp]") ? (q("[data-whatsapp]").getAttribute("href") || "").slice(0, 120) : null,
  };
`);
if (roundTrip && roundTrip.rows === 0) failures.push("/table?t=… did not decode a shared table — the link a guest texts back rebuilds nothing");

// ---- visit: the page whose only job is to get someone there
const visit = results.find((r) => r.path === "/visit")?.value;
if (visit && visit.allExternalSecure.length) failures.push(`/visit links over http (not https): ${visit.allExternalSecure.join(", ")}`);
// A restaurant's address page has one job a search engine cannot do for the guest: get them there. And a
// local link that lands on the 404 page is a broken promise in the site's own voice.
if (visit && !visit.mapLink) failures.push("/visit offers no Google Maps link for the Koinange Street address");
if (visit && visit.brokenLocal.length) failures.push(`/visit links to routes this build does not have: ${visit.brokenLocal.join(", ")}`);

// ---- no-JS: the CSS still is the renderer of record, so content must survive without JavaScript
await goto("/");
await evaluate(`
  document.querySelectorAll("script").forEach((s) => s.remove());
  return true;
`);
const noJs = await pixelStats(await shot());
const noJsFacts = await evaluate(`
  return {
    canvas: !!document.querySelector("[data-door] canvas"),
    heroText: document.querySelector("h1") ? document.querySelector("h1").textContent.trim().slice(0, 40) : null,
    visibleCards: [...document.querySelectorAll("[data-card], .card")].filter((c) => c.offsetParent !== null).length,
    stillPainted: getComputedStyle(document.querySelector(".hero__still")).backgroundImage.includes("venue-facade-night"),
  };
`);
drain();
results.push({ path: "/ (scripts removed)", value: { noJs, noJsFacts }, errors: [], warnings: [] });
if (!noJsFacts.stillPainted) failures.push("/ with JavaScript removed the CSS still is not painted — the poster fallback is not the renderer of record");

// ---- M4: the table has to survive the guest putting the phone down
// The share link proves the decode. This proves the storage: add through the real control, navigate away,
// come back, and ask whether the same table is sitting there. Two loads of the same route in the same
// target is the reload — no page.close, no new tab, no fake.
const seeded = await runAt("/table", "add, then reload", `
  const all = (s) => [...document.querySelectorAll(s)];
  const q = (s) => document.querySelector(s);
  const before = all("[data-inc]").length;
  all("[data-add]")[0].click();
  await new Promise((r) => setTimeout(r, 180));
  return {
    before,
    after: all("[data-inc]").length,
    total: q("[data-total]") ? q("[data-total]").textContent.trim() : null,
    stored: (localStorage.getItem("habibi-haven:table:v1") || "").slice(0, 240),
  };
`);
const restored = await runAt("/table", "table restored", `
  const all = (s) => [...document.querySelectorAll(s)];
  const q = (s) => document.querySelector(s);
  return {
    rows: all("[data-inc]").length,
    total: q("[data-total]") ? q("[data-total]").textContent.trim() : null,
    // On /table the house-set buttons are what say "this is already on the table" — data-on belongs to the
    // party dots here, so counting [data-card][data-on] would have been a MenuExplorer hook wearing this
    // page's clothes, and it would have read 0 on a correctly restored table.
    marked: all("[data-add]").filter((b) => /On the table/.test(b.textContent)).length,
    stored: (localStorage.getItem("habibi-haven:table:v1") || "").slice(0, 120),
  };
`);
if (seeded.after <= seeded.before) failures.push(`/table the first "add" left ${seeded.after} row(s) where there were ${seeded.before}`);
if (!seeded.stored) failures.push("/table adding a dish wrote nothing to localStorage — there is no table to restore");
if (restored.rows !== seeded.after) failures.push(`/table came back with ${restored.rows} row(s), but the load before it had ${seeded.after} — the saved table does not restore`);
else if (restored.total !== seeded.total) failures.push(`/table restored ${restored.rows} row(s) but the total went ${seeded.total} → ${restored.total} across the reload`);
else if (restored.marked === 0) failures.push("/table restored the rows but no card is marked as on the table — the page forgot which dishes it is holding");
await evaluate(`localStorage.removeItem("habibi-haven:table:v1"); return true;`);
drain();

// ---- M5: the dial has to reach the renderer, not stop in the stylesheet
// The home battery already proves --hour and --night move and that the labels follow. It does not prove
// the WebGL room is lit differently, because the CSS responds to the same custom properties and can change
// the whole frame on its own. So: hide the photograph, put the camera on the door region only, read the
// exposure the component wrote when it set renderer.toneMappingExposure, and compare a burst of frames at
// one hour against a burst at another. Breathing lamps and drifting dust make same-hour frames differ, so
// each hour is averaged over the burst and the noise floor is the mean step inside a burst; the claim is
// only true if the gap between the two averaged hours clears that floor by a visible margin.
await goto("/");
const dialTo = async (value) =>
  evaluate(`
    const q = (s) => document.querySelector(s);
    const door = q("[data-door]");
    const dialEl = document.querySelectorAll("[data-dial]")[1] || q("[data-dial]");
    const input = dialEl ? dialEl.querySelector("[data-dial-input]") : null;
    const still = q(".hero__still");
    if (still) still.style.display = "none";
    if (!input || !door) return { missing: true, canvas: !!q("[data-door] canvas") };
    input.value = ${JSON.stringify(String(value))};
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await new Promise((r) => setTimeout(r, 500));
    return {
      missing: false,
      hour: getComputedStyle(document.documentElement).getPropertyValue("--hour").trim(),
      night: getComputedStyle(document.documentElement).getPropertyValue("--night").trim(),
      exposure: door.dataset.rigExposure ?? null,
      rigNight: door.dataset.rigNight ?? null,
      canvas: !!q("[data-door] canvas"),
      tier: door.dataset.tier ?? null,
    };
  `);
const stillVisible = () =>
  evaluate(`
    const still = document.querySelector(".hero__still");
    if (still) still.style.display = "";
    return true;
  `);
const burstAt = async (value) => {
  const frames = [];
  for (let i = 0; i < 4; i += 1) {
    if (i) await evaluate(`await new Promise((r) => setTimeout(r, 240)); return true;`);
    const frame = await shotRegion("[data-scene]", `hour-${value}-frame-${i + 1}`);
    if (frame) frames.push(frame);
  }
  return frames;
};
const dusk = { at: await dialTo(20) };
dusk.frames = await burstAt(20);
const noon = { at: await dialTo(14) };
noon.frames = await burstAt(14);
await stillVisible();
if (shotsDir) {
  // Composite passes, photograph back under the canvas: the same two hours, because the thing that broke
  // last time was legible-at-night copy over a blown-out noon arch, and neither half of that shows in a
  // frame of the render alone.
  for (const hour of [20, 14]) {
    await dialTo(hour);
    await stillVisible();
    await evaluate(`await new Promise((r) => setTimeout(r, 700)); return true;`);
    await shotViewport(`hero-composite-${hour}`);
  }
}
const hourFrames = {
  framesDusk: dusk.frames.length,
  framesNoon: noon.frames.length,
  withinDusk: meanStep(dusk.frames),
  withinNoon: meanStep(noon.frames),
  cross: sigDistance(avgSig(dusk.frames), avgSig(noon.frames)),
};
// The margin matters as much as the ordering. With the sprites sampling their texture the soft glow and the
// drifting motes cover real area, so two frames of the SAME hour now sit tens of luminance units apart on
// their own — a single pair is mostly motion. Averaging each burst leaves the hour, and the floor is the
// mean step inside a burst. Anything under 1.5x is not a difference a guest could call, so it fails below
// that instead of squeaking past, and the ratio is printed rather than buried.
hourFrames.margin =
  hourFrames.cross !== null && Math.max(hourFrames.withinDusk, hourFrames.withinNoon) > 0
    ? Math.round((hourFrames.cross / Math.max(hourFrames.withinDusk, hourFrames.withinNoon)) * 100) / 100
    : Infinity;
if (probe) {
  const grid = (frames) => {
    const s = avgSig(frames)?.sig;
    if (!s) return "    (no frames sampled)";
    const lines = [];
    for (let r = 0; r < 8; r += 1) {
      lines.push("    " + s.slice(r * 8, r * 8 + 8).map((v) => (v < 0 ? "   -" : String(Math.round(v)).padStart(4))).join(""));
    }
    return lines.join("\n");
  };
  console.log(`probe 20:00 luminance grid (8x8, first row = top of the frame):\n${grid(dusk.frames)}`);
  console.log(`probe 14:00 luminance grid (8x8, first row = top of the frame):\n${grid(noon.frames)}`);
  console.log(
    "probe palette the scene was painted from at 14:00: " +
      JSON.stringify(
        await evaluate(`
          const cs = getComputedStyle(document.documentElement);
          const get = (n) => cs.getPropertyValue(n).trim();
          const t = get("--bg-2");
          const s = document.createElement("span");
          s.style.color = t;
          document.documentElement.appendChild(s);
          const back = getComputedStyle(s).color;
          const accepted = s.style.color !== "";
          s.remove();
          return {
            night: get("--night"),
            bg: [get("--bg-0"), get("--bg-1"), t, get("--bg-3")],
            roundTrip: { accepted, back },
            ivory: get("--ivory"),
            brassSoft: get("--brass-soft"),
            lampGlow: get("--lamp-glow"),
          };
        `)
      )
  );
}
drain();
results.push({
  path: "/ (hour pixels)",
  value: { dusk: dusk.at, noon: noon.at, ...hourFrames },
  errors: [],
  warnings: [],
});
if (dusk.at.missing || noon.at.missing) failures.push("/ no dial input or no door to measure the hour against");
else if (!dusk.at.canvas) failures.push(`/ the hour test ran on tier ${dusk.at.tier} with no canvas — there is no WebGL room to prove anything about`);
else {
  if (dusk.at.exposure === noon.at.exposure) {
    failures.push(`/ the renderer kept the same exposure at 20:00 and 14:00 (${dusk.at.exposure}) — the dial writes the stylesheet but not the scene`);
  }
  if (Number(dusk.at.exposure) <= Number(noon.at.exposure)) {
    failures.push(`/ exposure went the wrong way into the evening: ${noon.at.exposure} at 14:00 → ${dusk.at.exposure} at 20:00, and rig.js raises it as night comes on`);
  }
  if (hourFrames.cross === null) failures.push("/ the door region could not be screenshotted, so the hour pixels were never measured");
  else {
    const within = Math.max(hourFrames.withinDusk, hourFrames.withinNoon);
    if (hourFrames.cross <= within * 1.5) {
      failures.push(`/ the door at 20:00 vs 14:00 differs by ${hourFrames.cross}, only ${hourFrames.margin}x more than the frame-to-frame step inside one hour (${within}) — the room is not relighting, the lamps are just breathing`);
    }
  }
}

// ---- M3: dropping a tier must cost pixels, never content
// Emulating the media feature is a browser capability, not a site feature, so nothing in the product
// bends for this. `prefers-reduced-motion: reduce` has to route the gate to `poster`: no canvas, the CSS
// photograph left exactly as it is, and every dish still where it was. A unit test on decide() proves the
// table of rules; only the browser proves the page reads the same rules.
await inPage("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
await goto("/");
const poster = await evaluate(`
  const q = (s) => document.querySelector(s);
  const all = (s) => [...document.querySelectorAll(s)];
  const door = q("[data-door]");
  return {
    tier: door ? door.dataset.tier : null,
    reason: door ? door.dataset.tierReason : null,
    doorCanvas: !!q("[data-door] canvas"),
    anyCanvas: all("canvas").length,
    stillPainted: q(".hero__still") ? getComputedStyle(q(".hero__still")).backgroundImage.includes("venue-facade-night") : false,
    heroText: q("h1") ? q("h1").textContent.trim().slice(0, 44) : null,
    cards: all("[data-card]").length,
    stuckAtLoad: all("[data-reveal]").filter((el) => Number(getComputedStyle(el).opacity) < 0.1).length,
  };
`);
drain();
results.push({ path: "/ (reduced motion)", value: poster, errors: [], warnings: [] });
if (poster.tier !== "poster") failures.push(`/ a browser asking for reduced motion was given tier ${JSON.stringify(poster.tier)} (${poster.reason}), not poster`);
if (poster.doorCanvas) failures.push("/ under reduced motion the door mounted a canvas anyway — the WebGL branch is supposed to stop at poster");
if (!poster.stillPainted) failures.push("/ under reduced motion the CSS photograph is not painted, so the fallback has nothing to show");
if (poster.stuckAtLoad > 0) failures.push(`/ under reduced motion ${poster.stuckAtLoad} reveal element(s) sit at opacity 0 at load — motion was removed and the content with it`);

await goto("/menu");
const posterMenu = await evaluate(`
  const all = (s) => [...document.querySelectorAll(s)];
  const q = (s) => document.querySelector(s);
  return {
    total: all("[data-card]").length,
    visible: all("[data-card]").filter((c) => !c.hasAttribute("hidden")).length,
    groups: all("[data-group]").length,
    count: q("[data-count]") ? q("[data-count]").textContent.trim().slice(0, 46) : null,
  };
`);
drain();
results.push({ path: "/menu (reduced motion)", value: posterMenu, errors: [], warnings: [] });
if (posterMenu.visible !== posterMenu.total) failures.push(`/menu under reduced motion shows ${posterMenu.visible} of ${posterMenu.total} dishes — a weaker tier is not allowed to change the menu`);
if (posterMenu.groups !== 6) failures.push(`/menu under reduced motion found ${posterMenu.groups} group containers, expected 6`);
await inPage("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "no-preference" }] });

// ---- M6: the keyboard path, and what the page costs per frame
// Two questions this file could not previously answer. Can the whole site be used without a mouse —
// measured by pressing Tab for real, not by checking that href and aria-label exist? And is the site
// light — measured as frames on the machine running the gate, not as a weight budget on disk? A page can
// pass every static gate here and still be one where the focus ring is invisible, the tab order lands on
// a control that is not on screen, and the GPU keeps painting a hero nobody scrolled back to.
const measure = async (ms) => {
  await startFrames();
  await sleep(ms);
  return stopFrames();
};

for (const [route, cap] of [["/", 24], ["/menu", 26], ["/table", 22], ["/visit", 20]]) {
  await goto(route);
  const stops = [];
  for (let i = 0; i < cap; i += 1) {
    await press("Tab");
    const s = await focusStop();
    stops.push(s);
    if (s.tag === "body") break; // the document wrapped, so everything reachable was reached
  }
  const audit = await evaluate(`
    const sel = "a[href], button:not([disabled]), input:not([type=hidden]), select, textarea, [tabindex]";
    const nodes = [...document.querySelectorAll(sel)].filter((el) => el.getAttribute("aria-hidden") !== "true");
    const tabbable = nodes.filter((el) => (Number(el.getAttribute("tabindex")) || 0) >= 0);
    const identity = (el) => {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      // A box that measures nothing has a cause three levels up, not in its own rules, so the report
      // carries the chain: the size, the element's own display, and each ancestor's overflow and height.
      const chain = [];
      for (let n = el.parentElement; n && chain.length < 4; n = n.parentElement) {
        const c = getComputedStyle(n);
        const p = n.getBoundingClientRect();
        chain.push(n.tagName.toLowerCase() + "." + String(n.className).split(" ")[0].slice(0, 16) +
          "[ov:" + c.overflow + " h:" + Math.round(p.height) + " w:" + Math.round(p.width) + "]");
      }
      return el.tagName.toLowerCase() + (el.type ? "[" + el.type + "]" : "") + "." +
        String(el.className).slice(0, 26) + ' "' + (el.getAttribute("aria-label") || el.textContent || "").trim().slice(0, 20) +
        '" box:' + Math.round(r.width) + "x" + Math.round(r.height) + " disp:" + cs.display + " | " + chain.join(" > ") +
        (el.closest("label") ? " in label." + String(el.closest("label").className).slice(0, 18) : "");
    };
    // Three different things hide an element, and only two of them are defects.
    //   display:none / visibility:hidden / content-visibility:hidden  — the browser also takes the element
    //     out of the tab order, so the "clear the filters" button inside a hidden empty-state note is not
    //     reachable and not a problem. checkVisibility answers this without walking ancestors by hand.
    //   opacity:0 — still focusable, and the guest is now somewhere with nothing on screen.
    //   a 1px clipped box — the visually-hidden control pattern. Sound only when a label carries the ring,
    //     which the Tab walk below proves by landing on it for real.
    const rendered = tabbable.filter((el) => el.checkVisibility({ checkOpacity: false }));
    const invisible = rendered.filter((el) => {
      const r = el.getBoundingClientRect();
      return r.width < 2 || r.height < 2 || !el.checkVisibility({ checkOpacity: true });
    });
    // An unrevealed fade-up section is at opacity 0 and stays in the tab order — that is how the reveal
    // keeps its no-JS promise (global.css note 1: content starts visible and only animates once JS is
    // present). The question is therefore not "is anything transparent" but "does it stay transparent when
    // the keyboard arrives", so an element is only a sink when nothing can explain its transparency:
    //   not inside a reveal at all                            — nothing will ever make it visible
    //   inside a reveal that is on screen, settled, and still  — the observer or the class is broken
    // A control below the fold waiting its turn, or one mid-transition, is the mechanism working.
    const governed = (el) => el.closest("[data-reveal], .kin");
    const pending = invisible.filter((el) => !!governed(el));
    const stuck = invisible.filter((el) => {
      const a = governed(el);
      if (!a) return true;
      if (a.getAnimations().length) return false;
      const r = a.getBoundingClientRect();
      return r.top < innerHeight && r.bottom > 0;
    });
    const sample = pending[0] ?? null;
    // The page sets scroll-behavior: smooth, so every focus is a scroll ANIMATION, and a 24-press Tab walk
    // leaves one still in flight when this audit starts (three frames a second on this runner). Measuring
    // against a moving scroller decided the check below on where the leftover animation happened to be, not
    // on what the page does: a control recorded at top 408 was reported as left "off screen" with the page
    // parked at 6,608 and the reveal long since applied. So wait for the scroller to be still before taking
    // the "before" numbers — from there the only movement left is the browser bringing the control into view.
    const waitStill = async () => {
      let previous = -1;
      let still = 0;
      for (let i = 0; i < 50; i += 1) {
        const y = Math.round(scrollY);
        still = y === previous ? still + 1 : 0;
        previous = y;
        if (still >= 2) return y;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      return Math.round(scrollY);
    };
    let focusReveal = null;
    if (sample) {
      const settledAt = await waitStill();
      const before = sample.getBoundingClientRect();
      sample.focus();
      focusReveal = {
        tag: sample.tagName.toLowerCase(),
        label: (sample.getAttribute("aria-label") || sample.textContent || "").trim().slice(0, 28),
        was: [Math.round(before.top), Number(getComputedStyle(sample.closest("[data-reveal], .kin")).opacity)],
        settledAt,
        pendingOnPage: pending.length,
      };
    }
    return {
      tabbable: tabbable.length,
      srControls: invisible.filter((el) => el.closest("label")).length,
      pendingReveal: pending.length,
      sinks: stuck.length,
      which: stuck.slice(0, 5).map(identity),
      positives: tabbable.filter((el) => Number(el.getAttribute("tabindex")) > 0).length,
      // Focus is what the keyboard guest brings; measuring the pending case means actually focusing one.
      // The browser scrolls a focused control into view, the IntersectionObserver sees it, the class lands
      // and the transition runs — so give it the transition's own time and then ask what is on screen.
      focusReveal,
    };
  `);
  const { errors, warnings } = drain();
  // The audit just focused one pending-reveal control. Ask the only question that matters — does the keyboard
  // guest end up looking at something, or at a hole in the page where a button should be? — but ask it of the
  // settled state rather than of a snapshot: `html { scroll-behavior: smooth }` means the browser's
  // focus-follows scroll is an animation, and at three frames a second (this harness's SwiftShader reality)
  // a 950 ms photograph caught a control still travelling. Polling is both the honest wait and the cheaper
  // false-positive fix.
  const revealedOnFocus = audit.focusReveal
    ? await (async () => {
        let read = null;
        const began = Date.now();
        let previous = -1;
        let still = 0;
        while (Date.now() - began < 5000) {
          read = await evaluate(`
            const el = document.activeElement;
            if (!el || el === document.body) return null;
            const a = el.closest("[data-reveal], .kin");
            const r = el.getBoundingClientRect();
            return {
              label: (el.getAttribute("aria-label") || el.textContent || "").trim().slice(0, 28),
              revealed: a ? a.classList.contains("is-in") : null,
              opacity: a ? Math.round(Number(getComputedStyle(a).opacity) * 100) / 100 : Math.round(Number(getComputedStyle(el).opacity) * 100) / 100,
              inViewport: r.top >= -4 && r.bottom <= innerHeight + 4 && r.width > 2 && r.height > 2,
              box: [Math.round(r.top), Math.round(r.bottom)],
              scrollY: Math.round(scrollY),
              ring: getComputedStyle(el).outlineStyle !== "none" && parseFloat(getComputedStyle(el).outlineWidth) > 0,
            };
          `);
          if (!read) break;
          still = read.scrollY === previous ? still + 1 : 0;
          previous = read.scrollY;
          // Good and parked: done. Parked anywhere else for four samples (about a second of stillness): that
          // settled position IS the answer, so report it rather than waiting out a deadline.
          if (still >= 1 && read.inViewport && read.opacity >= 0.9) break;
          if (still >= 4) break;
          await sleep(250);
        }
        return read ? { ...read, waitedMs: Date.now() - began } : null;
      })()
    : null;
  const named = (s) => `${s.tag}${s.type ? `[${s.type}]` : ""}.${s.cls}${s.data ? `[${s.data}]` : ""}`;
  const keyOf = (s) => `${s.tag}|${s.cls}|${s.type}|${s.data}|${s.name}`;
  // A native date field holds four segments and the document's activeElement stays the input while the
  // keyboard walks through them, so consecutive identical stops are one control, not four defects.
  const live = stops.filter((s) => s.tag !== "body");
  const distinct = live.filter((s, i) => i === 0 || keyOf(s) !== keyOf(live[i - 1]));
  let run = 1;
  let longestRun = 1;
  for (let i = 1; i < live.length; i += 1) {
    run = keyOf(live[i]) === keyOf(live[i - 1]) ? run + 1 : 1;
    longestRun = Math.max(longestRun, run);
  }
  const unnamed = distinct.filter((s) => s.unnamed);
  const blind = distinct.filter((s) => !s.ring && !s.proxy);
  const ghosts = distinct.filter((s) => !s.box && !s.proxy);
  const srOnly = distinct.filter((s) => s.hiddenControl && s.proxy);
  const reachedMain = stops.findIndex((s) => s.inMain);
  results.push({
    path: `${route} (keyboard)`,
    value: {
      ...audit,
      pressed: stops.length,
      distinct: distinct.length,
      first: stops[0] ? `${stops[0].tag}.${stops[0].cls}` : null,
      reachedMain: reachedMain === -1 ? null : reachedMain + 1,
      unnamed: unnamed.length,
      blind: blind.length,
      ghosts: ghosts.length,
      srOnly: srOnly.length,
      longestRun,
      revealedOnFocus,
      chain: stops.slice(0, 10).map(named),
    },
    errors,
    warnings,
  });
  if (errors.length) failures.push(`${route} (keyboard) logged ${errors.length} error(s): ${errors.slice(0, 2).join(" | ")}`);
  if (stops[0]?.tag === "body") failures.push(`${route}: the first Tab went nowhere — nothing in the document is focusable`);
  if (!/skip/.test(stops[0]?.cls ?? "")) failures.push(`${route}: the first Tab stop is ${stops[0]?.tag}.${stops[0]?.cls}, not the skip link — a keyboard guest has to cross the whole nav on every page`);
  if (unnamed.length) failures.push(`${route}: ${unnamed.length} of ${distinct.length} Tab stops have no accessible name: ${unnamed.slice(0, 3).map(named).join(", ")}`);
  if (blind.length) failures.push(`${route}: ${blind.length} of ${distinct.length} Tab stops show no focus indicator on the control or its field: ${blind.slice(0, 4).map(named).join(", ")}`);
  if (ghosts.length) failures.push(`${route}: ${ghosts.length} Tab stops are elements with no box and no visible proxy: ${ghosts.slice(0, 4).map(named).join(", ")}`);
  if (longestRun > 6) failures.push(`${route}: ${longestRun} consecutive Tabs stayed on ${named(live[0])} — the keyboard cannot leave that control`);
  if (audit.sinks) failures.push(`${route}: ${audit.sinks} focusable element(s) are invisible with no reveal waiting on them (${audit.which.join(", ")})`);
  if (revealedOnFocus && (!revealedOnFocus.inViewport || revealedOnFocus.opacity < 0.9)) {
    failures.push(`${route}: focusing one of the ${audit.pendingReveal} controls that were transparent while unrevealed left it at opacity ${revealedOnFocus.opacity}, ${revealedOnFocus.inViewport ? "on" : "off"} screen — the fade-up reveal is keeping content out of the keyboard's sight`);
  }
  if (audit.positives) failures.push(`${route}: ${audit.positives} element(s) carry a positive tabindex, which pulls the tab path out of DOM order`);
}

// The two shortcuts the menu page promises in its own copy, pressed rather than inspected.
await goto("/menu");
await press("/");
const slashFocus = await focusStop();
for (const ch of "chai") await press(ch);
await sleep(400);
const typed = await evaluate(`
  const el = document.activeElement;
  const count = document.querySelector("[data-count]");
  return { value: el && el.tagName === "INPUT" ? el.value : null, count: count ? count.textContent.replace(/\\s+/g, " ").trim().slice(0, 60) : null };
`);
await press("Escape");
await sleep(300);
const afterEscape = await evaluate(`
  const search = document.querySelector("input[type=search], input[name=q], [data-search]");
  const count = document.querySelector("[data-count]");
  return {
    focused: document.activeElement === document.body ? "body" : document.activeElement.tagName.toLowerCase(),
    value: search ? search.value : null,
    count: count ? count.textContent.replace(/\\s+/g, " ").trim().slice(0, 60) : null,
    visible: [...document.querySelectorAll("[data-card]")].filter((c) => !c.hasAttribute("hidden")).length,
    total: document.querySelectorAll("[data-card]").length,
  };
`);
results.push({ path: "/menu (shortcuts)", value: { slashFocus, typed, afterEscape }, errors: [], warnings: [] });
if (slashFocus.tag !== "input") failures.push(`/menu: "/" moved focus to ${slashFocus.tag}.${slashFocus.cls}, not the search box the page promises`);
if (typed.value !== "chai") failures.push(`/menu: typing after "/" put ${JSON.stringify(typed.value)} in the box, not "chai"`);
if (!typed.count || !/chai/i.test(typed.count)) failures.push(`/menu: filtering to "chai" left the status line reading “${typed.count}” — it does not describe the filter`);
if (afterEscape.value !== "") failures.push(`/menu: Escape left “${afterEscape.value}” in the search box instead of releasing the filter`);
if (afterEscape.visible !== afterEscape.total) failures.push(`/menu: after Escape only ${afterEscape.visible} of ${afterEscape.total} dishes are visible — the reset did not restore the menu`);

// A control reached by Tab has to answer Enter, and answer it the way a click does.
await goto("/table");
const partyBefore = await evaluate(`const el = document.querySelector("[data-party-count]"); return el ? el.textContent.trim() : null;`);
let foundStepper = null;
for (let i = 0; i < 40; i += 1) {
  await press("Tab");
  const s = await focusStop();
  if (s.data.split(",").includes("party")) { foundStepper = { ...s, tabs: i + 1 }; break; }
}
if (foundStepper) await press("Enter");
await sleep(250);
const partyAfter = await evaluate(`const el = document.querySelector("[data-party-count]"); return el ? el.textContent.trim() : null;`);
results.push({ path: "/table (enter)", value: { foundStepper, partyBefore, partyAfter }, errors: [], warnings: [] });
if (!foundStepper) failures.push("/table: the party stepper was never reached in 40 Tabs — the configurator is mouse-only");
else if (partyBefore === partyAfter) failures.push(`/table: Enter on the focused stepper left the guest count at ${partyAfter} — the button did not answer the keyboard`);

// The frame budget, measured on the machine running the gate. The absolute number is not portable — this
// Chrome runs `--use-angle=swiftshader`, so the scene is rasterised on the CPU and every claim about
// milliseconds here is a claim about a software rasteriser, not about a phone or a laptop with a GPU. The
// portable part is the shape of the loop: it runs while the door is on screen, it stops when the door is
// off screen, and it does not exist at all on a page with no door or a tier that draws one frame.
await goto("/");
const inView = await measure(1300);
const glInfo = await evaluate(`
  const host = document.querySelector("[data-door]");
  const c = host ? host.querySelector("canvas") : null;
  const gl = c && (c.getContext("webgl2") || c.getContext("webgl"));
  const dbg = gl && gl.getExtension("WEBGL_debug_renderer_info");
  return {
    tier: host ? host.dataset.tier : null,
    tierReason: host ? host.dataset.tierReason : null,
    buffer: c ? [c.width, c.height] : null,
    dpr: devicePixelRatio,
    renderer: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl ? gl.getParameter(gl.RENDERER) : null,
    contextLost: gl ? gl.isContextLost() : null,
    hidden: document.hidden,
    fps: null,
  };
`);
glInfo.fps = inView.span ? Math.round((inView.frames / (inView.span / 1000)) * 10) / 10 : null;
await evaluate('scrollTo({ top: Math.round(document.documentElement.scrollHeight * 0.55), behavior: "instant" }); return true;');
await sleep(500);
const awayGeometry = await evaluate(`
  const r = document.querySelector("[data-door]").getBoundingClientRect();
  return { top: Math.round(r.top), bottom: Math.round(r.bottom), vh: innerHeight };
`);
const outOfView = await measure(1300);
await goto("/menu");
const menuFrames = await measure(1100);
await inPage("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
await goto("/");
const posterFrames = await measure(1100);
await inPage("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "no-preference" }] });
results.push({ path: "frames", value: { glInfo, inView, outOfView, awayGeometry, menuFrames, posterFrames }, errors: [], warnings: [] });
if (glInfo.contextLost) failures.push("/ the WebGL context is lost on the page under test — every frame count below is meaningless");
if (inView.frames < 1) failures.push(`/ the door produced ${inView.frames} frames in ${inView.span}ms while on screen (hidden=${glInfo.hidden}) — the render loop is not running`);
if (inView.frames >= 20 && inView.maxPerFrame > 3) failures.push(`/ ${inView.maxPerFrame} rAF callbacks shared a frame on the home page: the door, the preloader countdown and the cursor trail account for three, and a fourth is a loop nobody wrote (see the cursor block, which measures the steady state after the preloader is gone)`);
if (awayGeometry.bottom > 0 && awayGeometry.top < awayGeometry.vh) failures.push(`/ the door was still on screen after the scroll (${JSON.stringify(awayGeometry)}) — the off-screen measurement proved nothing`);
if (outOfView.frames > 3) failures.push(`/ the door kept painting ${outOfView.frames} frames after it left the viewport (${JSON.stringify(awayGeometry)})`);
if (menuFrames.frames > 3) failures.push(`/menu ran ${menuFrames.frames} rAF frames with no door on the page — a page without a scene should not hold a loop`);
if (posterFrames.frames > 3) failures.push(`/ under reduced motion the page ran ${posterFrames.frames} rAF frames — the poster tier draws one frame and stops`);

// The 30-frame probe counts frames, not seconds. On this machine a frame costs ~300 ms of software
// rasterisation, so the probe needs ~13 s of page life before it can conclude anything — longer than any of
// the windows above. It gets its own page and its own deadline, because the claim worth testing is not "is
// WebGL fast" (a property of the hardware) but "when the scene is slow, does the page say so". A gate that
// rebuilds the room and leaves data-tier="full" in the DOM would pass every assertion above and still lie to
// the next person who opens a debugger on a weak device.
const readProbe = () =>
  evaluate(`
    const host = document.querySelector("[data-door]");
    if (!host) return null;
    return {
      tier: host.dataset.tier || null,
      reason: host.dataset.tierReason || null,
      probeMs: host.dataset.probeMs === undefined ? null : Number(host.dataset.probeMs),
      canvas: !!host.querySelector("canvas"),
      live: !!host.querySelector("canvas[data-live]"),
    };
  `);
await goto("/");
const probeEarly = await measure(1300);
const probeStarted = await readProbe();
if (probeStarted && probeStarted.tier === "full") {
  const deadline = Date.now() + 20000;
  let probe = probeStarted;
  while (probe && probe.probeMs === null && probe.tier === "full" && Date.now() < deadline) {
    await sleep(400);
    probe = await readProbe();
  }
  const probeLate = await measure(1300);
  results.push({ path: "probe", value: { early: probeEarly, late: probeLate, outcome: probe }, errors: [], warnings: [] });
  if (probe && probe.probeMs === null) {
    failures.push(`/ the door rendered at ${probeEarly.fps} fps on this page (the probe's own threshold is 24 ms a frame, i.e. 41 fps)
      and after 20 s the page still reports no data-probe-ms — the 30-frame probe is the only thing that reacts to
      a slow device after load, and its outcome is not readable from the DOM, so nobody can tell it fired`);
  } else if (probe && probe.tier !== "lite") {
    failures.push(`/ the probe measured ${probe.probeMs} ms a frame and the page still claims tier "${probe.tier}"
      (reason "${probe.reason}") — changing the geometry without changing the evidence is worse than no probe at
      all, because data-tier is exactly what a debugger reads to decide what a guest was shown`);
  }
}

// ---------------------------------------------------------------- the cursor
// The page's other rAF consumer, and the one whose failure mode is silent waste rather than a visible bug:
// the trailing ring is an exponential lag, which never mathematically arrives, so a loop that always
// re-requests repaints two unchanged numbers 60 times a second for as long as the tab is open. Tested in the
// steady state — preloader removed, pointer parked — where the only loop that should remain is the door's.
// And tested through a blur and a return, because the fix (stop when settled) turns the re-arm test into
// `if (!raf)`, which only works if cancelling also zeroes the id.
//
// This browser reports `(pointer: fine)` true, so the override below is normally not installed. It exists for
// the case where it is not: without a fine pointer the component attaches no listeners at all, and the whole
// desktop cursor path would ship untested rather than fail the gate. When it does get installed the result
// line says so, because a test that quietly changes the environment it is measuring is how a green run comes
// to mean nothing.
const pointerClass = await evaluate(`return matchMedia("(pointer: fine)").matches;`);
// Installed as a document-start script so the page's own scripts see it, and removed straight afterwards —
// the component reads the media query once, at parse time, so patching it after load would change nothing.
const POINTER_OVERRIDE = [
  "(() => {",
  "  const real = window.matchMedia.bind(window);",
  "  window.matchMedia = (query) => (String(query).indexOf('pointer') !== -1 && String(query).indexOf('fine') !== -1",
  "    ? { matches: true, media: String(query), onchange: null, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }",
  "    : real(query));",
  "  window.__hhPointerOverride = true;",
  "})();",
].join("\n");
let patched = null;
if (!pointerClass) patched = await inPage("Page.addScriptToEvaluateOnNewDocument", { source: POINTER_OVERRIDE });
if (pointerClass || patched) {
  await goto("/");
  const overrideActive = await evaluate(`return window.__hhPointerOverride === true && matchMedia("(pointer: fine)").matches;`);
  let curtainWait = 0;
  while (curtainWait < 4000) {
    const stillCovered = await evaluate(`return !!document.querySelector("[data-preloader]");`);
    if (!stillCovered) break;
    await sleep(200);
    curtainWait += 200;
  }
  const idle = await measure(800);
  await inPage("Input.dispatchMouseEvent", { type: "mouseMoved", x: 260, y: 240, buttons: 0 });
  await sleep(150);
  await inPage("Input.dispatchMouseEvent", { type: "mouseMoved", x: 900, y: 520, buttons: 0 });
  await sleep(120);
  // Two claims, in order: the loop starts when a real pointer arrives, and it stops when the pointer stops
  // being interesting. The first is measured while the ring is still chasing.
  const chasing = await measure(800);
  const moved = await evaluate(`
    return {
      on: document.body.classList.contains("cursor-on"),
      dot: document.querySelector("[data-cursor]").style.transform,
      ring: document.querySelector("[data-ring]").style.transform,
    };
  `);
  // The ring closes the gap by 18% per *frame*, so "settled" arrives after about fifty frames — sixteen
  // seconds on this software-rasterised page and under a second on a GPU. Waiting a fixed number of
  // milliseconds measured a chase still in mid-flight and called it a leak. The honest deadline is the
  // write itself: two identical inline transforms in a row means nothing is writing any more.
  const chase = { samples: [], began: Date.now() };
  let converged = null;
  let previousRing = moved.ring;
  while (Date.now() - chase.began < 30000) {
    await sleep(600);
    const ringNow = await evaluate(`return document.querySelector("[data-ring]").style.transform;`);
    chase.samples.push(ringNow === previousRing ? "=" : "≠");
    if (ringNow === previousRing) {
      converged = { transform: ringNow, afterMs: Date.now() - chase.began, frames: chase.samples.length };
      break;
    }
    previousRing = ringNow;
  }
  const settled = await measure(900);
  await evaluate(`window.dispatchEvent(new Event("blur")); return true;`);
  await sleep(150);
  const blurred = await evaluate(`return { on: document.body.classList.contains("cursor-on") };`);
  await inPage("Input.dispatchMouseEvent", { type: "mouseMoved", x: 640, y: 400, buttons: 0 });
  await sleep(220);
  const rearmed = await evaluate(`
    return { on: document.body.classList.contains("cursor-on"), ring: document.querySelector("[data-ring]").style.transform };
  `);
  results.push({ path: "cursor", value: { pointerNative: pointerClass, overrideActive, curtainWait, idle, chasing, moved, converged, settled, blurred, rearmed }, errors: [], warnings: [] });
  if (patched && overrideActive !== true) failures.push("/ the (pointer: fine) override did not reach the page scripts, so nothing below this line tested the cursor");
  if (moved.on !== true) failures.push(`/ (pointer: fine) is true but two real mouse moves never put cursor-on on the body — the pointer this design promises does not appear`);
  if (chasing.maxPerFrame !== 2) failures.push(`/ while the ring was chasing a moving pointer, ${chasing.maxPerFrame} rAF callbacks shared a frame — the door is one and the cursor should be the second, so one of them never started (${JSON.stringify(chasing)})`);
  if (idle.frames >= 1 && idle.maxPerFrame > 1) failures.push(`/ before the pointer ever moved, ${idle.maxPerFrame} rAF callbacks shared each of ${idle.frames} frames with the preloader gone — something is arming the cursor without a mouse`);
  if (!moved.dot || !moved.ring) failures.push(`/ after moving, the inline transforms were ${JSON.stringify([moved.dot, moved.ring])} — the dot and the ring are both supposed to be positioned by the loop`);
  if (!converged) failures.push(`/ 30 s after a pointer move the ring was still writing a new transform every sample (${chase.samples.length} samples, all "≠") — an exponential chase that never stops is a permanent second loop on every page with the cursor enabled`);
  else if (settled.frames < 1) failures.push(`/ the door produced ${settled.frames} frames in the window after the ring settled (${JSON.stringify(settled)}) — there is nothing to judge about the second loop`);
  else if (settled.maxPerFrame > 1) failures.push(`/ the ring stopped writing after ${converged.afterMs} ms, yet ${settled.maxPerFrame} rAF callbacks still shared each of the ${settled.frames} frames that followed — the loop is running to repaint two numbers that are not changing`);
  if (blurred.on !== false) failures.push(`/ window blur left cursor-on on the body — switch tabs and come back to a dot that belongs to nobody`);
  if (rearmed.on !== true) failures.push(`/ after a blur the cursor never returned when the mouse moved again (${JSON.stringify(rearmed)}) — cancelling a rAF leaves its id set, so the re-arm guard stays false and the cursor is dead until the page reloads`);
} else {
  results.push({ path: "cursor", value: { pointerNative: pointerClass, skipped: "no (pointer: fine) and no override installed" }, errors: [], warnings: [] });
}
// The override was borrowed for one block. Leaving it installed would mean every later page load in this
// run — and there are none, which is exactly why it has to be said out loud rather than relied on.
if (patched) await inPage("Page.removeScriptToEvaluateOnNewDocument", { identifier: patched.identifier });

// ---------------------------------------------------------------- the router
/*
  Every battery above reaches a route with Page.navigate. That is the honest way to test a first arrival,
  and it is also the only condition that hides the router's entire failure mode: on a fresh document every
  module runs exactly once, so a component that can never re-mount looks flawless. lib/page.mjs exists
  precisely because Astro marks the incoming page's scripts as already executed, which means that between
  a nav click and a dead menu there is only the lifecycle sweep — and a sweep that misses is invisible to
  a harness that has never clicked anything.

  So this battery clicks. It also distinguishes a swap from a reload with a value only a document
  tear-down can lose: `window.__hhMark` is set on the first load and read after every navigation. If it
  survives, the same document served all four pages, which is the claim the router is making.
*/
const navStep = (expected) =>
  evaluate(`
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const link =
      document.querySelector('.nav a[href="${expected}"]') ||
      document.querySelector('main a[href="${expected}"]') ||
      document.querySelector('a[href="${expected}"]');
    if (!link) return { clicked: false, expected: ${JSON.stringify(expected)} };
    let swapped = 0, loaded = 0;
    // document, not window: astro/dist/transitions/router.js fires these with
    // document.dispatchEvent(new Event(name)), and a plain Event does not bubble — a window listener
    // here would sit out every navigation and report a router that never ran.
    document.addEventListener("astro:after-swap", () => { swapped += 1; }, { once: true });
    document.addEventListener("astro:page-load", () => { loaded += 1; }, { once: true });
    link.click();
    const t0 = Date.now();
    while (Date.now() - t0 < 9000 && !(swapped && loaded)) await wait(40);
    await wait(700);
    const root = getComputedStyle(document.documentElement);
    const curtain = document.querySelector("[data-preloader]");
    return {
      clicked: true,
      expected: ${JSON.stringify(expected)},
      landed: location.pathname,
      swapped,
      loaded,
      title: document.title,
      announced: (document.querySelector(".astro-route-announcer") || {}).textContent ?? null,
      mark: window.__hhMark ?? null,
      jsOn: document.documentElement.classList.contains("js"),
      hour: root.getPropertyValue("--hour").trim(),
      canvases: document.querySelectorAll("[data-door] canvas").length,
      curtain: curtain
        ? { present: true, opacity: getComputedStyle(curtain).opacity, pointerEvents: getComputedStyle(curtain).pointerEvents }
        : { present: false },
      navCurrent: ((document.querySelector(".nav [aria-current]") || {}).textContent || "").trim(),
    };
  `);

await goto("/");
drain();
await evaluate(`window.__hhMark = "router"; return true;`);

// Dial first, while there is a dial to dial: the hour is the one piece of state this site invents, and the
// one a page swap can silently erase (the incoming <html> only knows the clock the build ran at).
const routerDial = await dialTo(3);
const toMenu = await navStep("/menu");
const menuLive = await evaluate(`
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const q = (s) => document.querySelector(s);
  const vis = () => [...document.querySelectorAll("[data-card]")].filter((c) => c.getBoundingClientRect().height > 0);
  if (!q("[data-q]")) return { mounted: false };
  const open = vis().length;
  q("[data-q]").value = "chai";
  q("[data-q]").dispatchEvent(new Event("input", { bubbles: true }));
  await wait(300);
  const searched = vis().length;
  q("[data-reset]").click();
  await wait(250);
  const reset = vis().length;
  const chip = [...document.querySelectorAll("[data-tag]")].find((b) => /goat/i.test(b.textContent));
  if (chip) { chip.click(); await wait(300); }
  return {
    mounted: true,
    open,
    searched,
    reset,
    chipped: vis().length,
    chip: chip ? chip.textContent.trim() : null,
    pressed: chip ? chip.getAttribute("aria-pressed") : null,
    count: (q("[data-count]") || {}).textContent?.replace(/\\s+/g, " ").trim().slice(0, 60) ?? null,
    dock: !!document.querySelector("[data-dock]"),
  };
`);
const toTable = await navStep("/table");
// The table starts empty unless localStorage says otherwise, and the M4 battery clears the key behind it.
// So `[data-inc]` — the stepper inside a row — cannot be counted before a dish exists: seed through the
// real "add" control first, then prove the stepper that the swap just built is wired to the total.
const tableLive = await evaluate(`
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const q = (s) => document.querySelector(s);
  const add = document.querySelector("[data-add]");
  if (!add) return { mounted: false, rows: 0 };
  add.click();
  await wait(300);
  const seededRows = document.querySelectorAll("[data-inc]").length;
  const before = (q("[data-total]") || {}).textContent?.trim() ?? null;
  const inc = document.querySelector("[data-inc]");
  if (inc) { inc.click(); await wait(300); }
  return {
    mounted: true,
    seededRows,
    rows: document.querySelectorAll("[data-inc]").length,
    before,
    after: (q("[data-total]") || {}).textContent?.trim() ?? null,
    party: (q("[data-party-count]") || {}).textContent?.trim() ?? null,
  };
`);
const backHome = await navStep("/");
// Home is the one route that ships a curtain: the preloader exists in its server HTML and is taken away
// when the door paints. On a first arrival that is polite. On a swap it is a decision — so measure it
// rather than assume it, and give it time to finish before judging.
const curtainAfterHome = await evaluate(`
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  for (let i = 0; i < 30; i += 1) {
    const c = document.querySelector("[data-preloader]");
    if (!c) return { present: false, waitedMs: i * 100 };
    const st = getComputedStyle(c);
    if (Number(st.opacity) < 0.05 && st.pointerEvents === "none") return { present: true, transparent: true, waitedMs: i * 100 };
    await wait(100);
  }
  const c = document.querySelector("[data-preloader]");
  return { present: true, transparent: false, opacity: c && getComputedStyle(c).opacity, pointerEvents: c && getComputedStyle(c).pointerEvents, waitedMs: 3000 };
`);
const dialsHome = await evaluate(`
  const all = [...document.querySelectorAll("[data-dial]")];
  return {
    dials: all.length,
    values: all.map((d) => (d.querySelector("[data-dial-input]") || {}).value ?? null),
    hour: getComputedStyle(document.documentElement).getPropertyValue("--hour").trim(),
    canvas: document.querySelectorAll("[data-door] canvas").length,
    live: !!document.querySelector("[data-door] canvas[data-live]"),
  };
`);
// Back and forward are the navigation a demo does most (the owner looks at the menu, then taps back to the
// door) and the one the router implements itself rather than through a link click.
const wentBack = await evaluate(`
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  history.back();
  const t0 = Date.now();
  while (Date.now() - t0 < 6000 && location.pathname !== "/table") await wait(40);
  await wait(600);
  return {
    landed: location.pathname,
    mark: window.__hhMark ?? null,
    jsOn: document.documentElement.classList.contains("js"),
    hour: getComputedStyle(document.documentElement).getPropertyValue("--hour").trim(),
    rows: document.querySelectorAll("[data-inc]").length,
  };
`);
const cameForward = await evaluate(`
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  history.forward();
  const t0 = Date.now();
  while (Date.now() - t0 < 6000 && location.pathname !== "/") await wait(40);
  await wait(800);
  return {
    landed: location.pathname,
    canvas: document.querySelectorAll("[data-door] canvas").length,
    live: !!document.querySelector("[data-door] canvas[data-live]"),
    hour: getComputedStyle(document.documentElement).getPropertyValue("--hour").trim(),
    jsOn: document.documentElement.classList.contains("js"),
  };
`);
// drain() answers {errors, warnings} — handing the object to a report row is how a green battery
// manages to crash the reporter instead of the site.
const routerLog = drain();
results.push({
  path: "/ ⇄ /menu ⇄ /table (clicked)",
  value: { routerDial, toMenu, menuLive, toTable, tableLive, backHome, curtainAfterHome, dialsHome, wentBack, cameForward },
  errors: routerLog.errors,
  warnings: routerLog.warnings,
});
if (routerLog.errors.length) failures.push(`router navigation logged ${routerLog.errors.length} error(s): ${routerLog.errors.slice(0, 3).join(" | ")}`);

// One document, four swaps.
for (const step of [toMenu, toTable, backHome]) {
  if (!step.clicked) {
    failures.push(`the router battery could not find a link to ${step.expected} — nothing here proves navigation at all`);
    continue;
  }
  if (step.landed !== step.expected)
    failures.push(`clicking to ${step.expected} ended at ${step.landed} — the router took the click and did not finish the job`);
  if (step.swapped !== 1 || step.loaded !== 1)
    failures.push(`${step.expected}: after-swap fired ${step.swapped} time(s) and page-load ${step.loaded} — a component sweep depends on exactly one of each (${JSON.stringify({ swapped: step.swapped, loaded: step.loaded })})`);
  if (step.mark !== "router")
    failures.push(`${step.expected}: window.__hhMark did not survive the navigation — that was a document reload, not a router swap`);
  if (!step.jsOn)
    failures.push(`${step.expected}: html.js is missing after the swap — every [data-reveal] rule on this page is gated on it, so the content is showing in its no-JavaScript state`);
  if (!step.title) failures.push(`${step.expected}: the document title is empty after the swap`);
}
// The door belongs to one page, and it must not follow the visitor around or arrive twice.
if (toMenu.canvases !== 0)
  failures.push(`/menu after a click carries ${toMenu.canvases} door canvas(es) — the scene is a home-page feature and it came along in the swap`);
if (backHome.canvases !== 1)
  failures.push(`/ after a click carries ${backHome.canvases} door canvas(es), expected exactly 1 — a second context on a swapped-in home is the leak lib/gate.mjs exists to prevent`);
if (!dialsHome.live && backHome.canvases === 1)
  failures.push(`/ after a click has a canvas that never got data-live — the door mounted and then did not paint`);
if (cameForward.canvas !== 1)
  failures.push(`forward back to / left ${cameForward.canvas} canvas(es), expected 1`);
// The hour the visitor dialled outranks the hour the build ran at, on every page and in both directions.
if (routerDial.missing) failures.push("the router battery could not dial the room — no dial or door was present to drive");
if (routerDial.hour !== "3") failures.push(`dialling 03:00 left --hour at ${JSON.stringify(routerDial.hour)} — the state was never written, so the later comparisons mean nothing`);
for (const step of [toMenu, toTable, backHome]) {
  if (step.clicked && step.hour !== "3")
    failures.push(`${step.expected}: --hour is ${JSON.stringify(step.hour)} after the swap, not the 3 this visitor dialled — the incoming <html> overwrote it and nothing re-asserted it`);
}
if (dialsHome.dials !== 2) failures.push(`/ after a click has ${dialsHome.dials} dial(s); the home hero and the rig section each carry one, so both have to come back`);
if (dialsHome.dials === 2 && dialsHome.values.filter((v) => Number(v) === 3).length !== 2)
  failures.push(`/ after a click shows the dialled hour on only ${JSON.stringify(dialsHome.values)} — one of the two dials remounted reading the build's clock instead of this visitor's`);
if (wentBack.rows === 0)
  failures.push("back to /table rebuilt nothing — the table builder has no rows, so its mount did not run on the restored document");
if (wentBack.landed !== "/table" || cameForward.landed !== "/")
  failures.push(`history back/forward landed on ${JSON.stringify([wentBack.landed, cameForward.landed])}, expected /table then /`);
if (wentBack.mark !== "router" || cameForward.mark !== "router")
  failures.push("back/forward tore the document down (window.__hhMark gone) — the router is not handling popstate in this build");
if (wentBack.hour !== "3" || cameForward.hour !== "3")
  failures.push(`back/forward reset --hour to ${JSON.stringify([wentBack.hour, cameForward.hour])} — the restored document's own attributes won over the dialled hour`);
if (!menuLive.mounted) failures.push("/menu after a click has no [data-q] — the explorer arrived as dead markup, which is the exact failure lib/page.mjs exists to prevent");
if (menuLive.mounted && !menuLive.dock)
  failures.push("/menu after a click lost its action dock — the sticky order control is chrome, and it has to be on every page of the demo");
if (backHome.curtain.present && !curtainAfterHome.transparent)
  failures.push(`/ after a click is still behind its curtain after ${curtainAfterHome.waitedMs} ms (opacity ${curtainAfterHome.opacity}, pointer-events ${curtainAfterHome.pointerEvents}) — the preloader is for a first arrival, not a second lap`);
if (menuLive.mounted) {
  if (!(menuLive.searched < menuLive.open))
    failures.push(`/menu after a click: searching "chai" left ${menuLive.searched} of ${menuLive.open} rows visible — the filter is wired to nothing on a swapped-in page`);
  if (!(menuLive.reset > menuLive.searched))
    failures.push(`/menu after a click: reset did not bring the rows back (${JSON.stringify({ open: menuLive.open, searched: menuLive.searched, reset: menuLive.reset })})`);
  if (menuLive.chip && menuLive.pressed !== "true")
    failures.push(`/menu after a click: the "${menuLive.chip}" chip was clicked and still reads aria-pressed=${JSON.stringify(menuLive.pressed)}`);
  if (!(menuLive.chipped < menuLive.reset))
    failures.push(`/menu after a click: the "${menuLive.chip}" chip changed nothing (${menuLive.chipped} of ${menuLive.reset} rows still visible)`);
}
if (tableLive.mounted && tableLive.before === tableLive.after)
  failures.push(`/table after a click: pressing a row's + left the total at ${JSON.stringify(tableLive.before)} — the builder mounted without its handlers`);
if (!tableLive.mounted)
  failures.push("/table after a click has no [data-add] control — the configurator did not mount on the swapped-in document");
else if (tableLive.seededRows === 0)
  failures.push('/table after a click: the first "add" built no row ([data-inc] still 0) — the dish list is markup with no builder behind it');
// Reduced motion must not cost a visitor the router: what the swap buys is that the document is never
// torn down, and a cross-fade is not the swap. So turn the preference on, click again, and check both
// halves — that the animation rule actually reached the applied stylesheet, and that the navigation is
// still a swap with its lifecycle intact.
await inPage("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
const reduceSwap = await navStep("/menu");
const vtRules = await evaluate(`
  const hits = [];
  for (const sheet of document.styleSheets) {
    let rules;
    try {
      rules = sheet.cssRules;
    } catch {
      continue; // the font stylesheet is cross-origin and has no readable rules — not our business here
    }
    for (const rule of rules) {
      const text = rule.cssText || "";
      if (text.includes("view-transition")) hits.push({ media: rule.conditionText ?? null });
    }
  }
  return {
    total: hits.length,
    medias: hits.map((h) => h.media),
    inMedia: hits.filter((h) => (h.media || "").includes("prefers-reduced-motion")).length,
  };
`);
await inPage("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "no-preference" }] });
const reduceLog = drain();
results.push({ path: "/ → /menu (reduced motion)", value: { reduceSwap, vtRules }, errors: reduceLog.errors, warnings: reduceLog.warnings });
if (reduceLog.errors.length)
  failures.push(`the reduced-motion navigation logged ${reduceLog.errors.length} error(s): ${reduceLog.errors.slice(0, 2).join(" | ")}`);
if (vtRules.total === 0)
  failures.push("no ::view-transition rule reached the browser — the page change is running on the UA's own cross-fade, and nothing in Astro gates that on prefers-reduced-motion");
else if (vtRules.inMedia === 0)
  failures.push(`the view-transition rules are applied but none of them sits inside a reduced-motion block (${JSON.stringify(vtRules.medias)}) — a visitor who asked for no motion still gets the fade`);
if (reduceSwap.clicked && reduceSwap.mark !== "router")
  failures.push("with prefers-reduced-motion the navigation was no longer a swap — the suppression path is reloading the document instead of skipping its animation");
if (reduceSwap.clicked && reduceSwap.landed !== "/menu")
  failures.push(`with prefers-reduced-motion the click to /menu landed on ${JSON.stringify(reduceSwap.landed)}`);
if (reduceSwap.clicked && !reduceSwap.jsOn)
  failures.push("/menu after a reduced-motion click lost html.js — the re-assertion has to run regardless of the motion preference");

// Leave the guest's table empty for the batteries that run after this one, the same way M4 does.
await evaluate(`localStorage.removeItem("habibi-haven:table:v1"); return true;`);
await stillVisible();
drain();

// ---------------------------------------------------------------- phone width
/*
  Every battery above runs at the viewport Chrome was launched with, which is a desktop width — and a
  desktop width is exactly where ActionDock hides itself. So the thumb-reachable Call / WhatsApp / Book a
  table controls were the one part of the site with no runtime proof: `display: none` at 1440 is correct
  behaviour and `display: none` at 390 is a missing feature, and nothing so far could tell them apart.

  Three claims, measured at 390x844 on each route:
    1. the dock paints, and a thumb landing in its middle hits a dock link rather than the page beneath it;
    2. each action is a real destination — tel:, wa.me, /table — in a box a finger can actually press;
    3. nothing the guest can see is lying underneath it. Every on-screen link must answer elementFromPoint
       with itself, because the document gives the dock its own padding instead of overlapping the footer.
  Plus the cheap one that only a phone reveals: horizontal overflow.
*/
const PHONE_ROUTES = ["/", "/menu", "/table", "/visit"];
await inPage("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
for (const route of PHONE_ROUTES) {
  await goto(route);
  const read = await evaluate(`
    const bar = document.querySelector("[data-dock]");
    if (!bar) return { present: false };
    const box = bar.getBoundingClientRect();
    const centre = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
    const actions = Array.from(bar.querySelectorAll("a")).map((a) => ({
      text: (a.getAttribute("aria-label") || a.textContent || "").trim().slice(0, 26),
      href: a.getAttribute("href"),
      w: Math.round(a.getBoundingClientRect().width),
      h: Math.round(a.getBoundingClientRect().height),
    }));
    // The page animates its own scrolls, so measuring at the bottom means turning that off first — an
    // animated scrollTo would have the audit reading a page still on its way down.
    document.documentElement.style.scrollBehavior = "auto";
    scrollTo(0, document.documentElement.scrollHeight);
    await new Promise((r) => setTimeout(r, 350));
    const buried = [];
    for (const a of document.querySelectorAll("main a[href], footer a[href]")) {
      const r = a.getBoundingClientRect();
      if (r.width < 10 || r.height < 10) continue;
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      if (r.top < 0 || r.bottom > innerHeight || cx < 0 || cx > innerWidth || cy < 0 || cy > innerHeight) continue;
      const hit = document.elementFromPoint(cx, cy);
      if (hit && bar.contains(hit) && !a.contains(hit)) {
        buried.push((a.textContent || a.getAttribute("aria-label") || a.getAttribute("href") || "").trim().slice(0, 26));
      }
    }
    document.documentElement.style.scrollBehavior = "";
    return {
      present: true,
      display: getComputedStyle(bar).display,
      dockBox: [Math.round(box.top), Math.round(box.bottom)],
      viewport: [innerWidth, innerHeight],
      hitIsDock: !!centre && bar.contains(centre),
      actions,
      buried: buried.slice(0, 6),
      buriedCount: buried.length,
      overflowX: document.documentElement.scrollWidth - innerWidth,
    };
  `);
  const logged = drain();
  results.push({ path: `phone ${route}`, value: read, errors: logged.errors, warnings: logged.warnings });
  if (!read || read.present !== true) {
    failures.push(`${route}: at 390px there is no [data-dock] at all — the sticky order controls are missing`);
    continue;
  }
  if (read.display === "none") failures.push(`${route}: the dock is display:none at 390px — it only ever shows on a desktop, which is the reverse of what it is for`);
  if (!read.hitIsDock) failures.push(`${route}: the middle of the dock (${read.dockBox.join("–")}) resolves to something other than the dock — it is painted under the page`);
  const kinds = (read.actions || []).map((a) => a.href || "");
  if (!kinds.some((h) => h.startsWith("tel:+"))) failures.push(`${route}: no tap-to-call action in the dock`);
  if (!kinds.some((h) => h.startsWith("https://wa.me/"))) failures.push(`${route}: no WhatsApp order action in the dock`);
  if (route !== "/table" && !kinds.some((h) => h === "/table")) failures.push(`${route}: the dock does not offer a route to the table builder`);
  const stub = (read.actions || []).filter((a) => a.w < 40 || a.h < 40);
  if (stub.length) failures.push(`${route}: ${stub.map((a) => `${a.text} ${a.w}x${a.h}`).join(", ")} in the dock is too small to press on a phone`);
  if (read.buriedCount) failures.push(`${route}: ${read.buriedCount} visible link(s) sit under the dock at the bottom of the page (${read.buried.join(", ")}) — the document is not giving it room`);
  if (read.overflowX > 1) failures.push(`${route}: the page is ${read.overflowX}px wider than a 390px viewport — a phone gets a horizontal scrollbar`);
}
await inPage("Emulation.clearDeviceMetricsOverride", {});

// ---------------------------------------------------------------- report
const pad = (s, n) => String(s).padEnd(n);
console.log(`verify-runtime  browser ${browser.split("/").pop()}  ${base}\n`);
for (const r of results) {
  console.log(`${pad(r.path, 22)} errors ${r.errors.length}  warnings ${r.warnings.length}`);
  for (const e of r.errors) console.log(`   ERR ${e}`);
  for (const w of r.warnings) console.log(`   warn ${w}`);
}
console.log("\n--- measurements");
console.log(JSON.stringify(results.map((r) => ({ [r.path]: r.value })), null, 1));

if (failures.length) {
  console.error(`\nverify-runtime: ${failures.length} problem(s)`);
  console.error(failures.map((f) => `  ${f}`).join("\n"));
  await goodbye(1);
}
console.log("\nverify-runtime: ok — no console errors on any route, door paints, dial drives the rig, menu and table interactions respond, no-JS still renders");
await goodbye(0);

// The report is the last thing this script needs from the browser. An open DevTools socket and a live
// Chrome child keep Node's event loop alive forever, so a green run printed its verdict and then never
// exited — which is how orphaned headless browsers piled up on the debug port and made the following run
// attach to someone else's. Both paths say goodbye on the way out.
async function goodbye(code) {
  try {
    ws?.close();
  } catch {
    /* the socket is already gone */
  }
  chrome.kill();
  await sleep(150);
  try {
    rmSync(profile, { recursive: true, force: true });
  } catch {
    /* cleanup already ran, or Windows has not let go of the directory yet */
  }
  process.exit(code);
}
