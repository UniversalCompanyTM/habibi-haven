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

// The row cap the harness enforces has to be the row cap the site states. Importing it is the difference
// between a gate and a guess: `LINES_MAX` is the same constant the button, the hint, the guard and (through
// tests/api.mjs) the Worker's `LIMITS.linesMax` read, so a fifth copy of the number cannot disagree here.
import { LINES_MAX } from "../site/src/lib/table.mjs";

// The same reasoning for the When pair: the harness asserts against the constants the pages use, never against
// dates it worked out for itself, so a change in the horizon moves the gate with the site rather than breaking it.
import { CLOSE_LABEL, CLOSE_MINUTES, HORIZON_DAYS, LAST_SITTING_LABEL, OPEN_LABEL, OPEN_MINUTES, minutesToLabel } from "../site/src/lib/hours.mjs";

// The slots /table offers, derived from the same hours the page's own loop uses. Asserting against a list built
// here rather than a count typed here is the only reason this gate exists: the page once offered
// 06:00/12:00/18:00/00:00 — two of which the book refuses — because its loop fed minutes to a function that
// takes hours, and nothing on either side compared the list with the window.
const openSlots = [];
for (let m = OPEN_MINUTES; m <= CLOSE_MINUTES - 30; m += 30) openSlots.push(minutesToLabel(m));

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
  { stdio: ["ignore", "pipe", "pipe"] },
);

// Chrome's own words are kept so a browser that refuses to open its debugging port can say why. They are read
// continuously and only the tail is held: an un-read pipe fills at 64 KiB, and a headless Chrome whose stdout
// blocks takes the run down with it — which is a worse failure than the one being diagnosed.
let chromeLog = "";
const captureChrome = (chunk) => {
  chromeLog += chunk.toString();
  if (chromeLog.length > 32_000) chromeLog = chromeLog.slice(-16_000);
};
chrome.stdout?.on("data", captureChrome);
chrome.stderr?.on("data", captureChrome);

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
  // 180 attempts, not 60. Run 43857740739 failed the whole gate with "no DevTools endpoint on 9333" sixteen
  // seconds after the preview server answered, on the same workflow that had been green sixteen minutes earlier
  // — so the binary was found and the port simply was not open inside fifteen seconds. Which runner was slow,
  // and why, is not proven: what is proven is that a budget tuned to the fastest observation is a coin flip on
  // the slowest machine, and a harness that fails for that reason trains everyone to re-run CI instead of
  // reading it. The message below now carries Chrome's own output, so the next one of these says something.
  for (let i = 0; i < 180; i += 1) {
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
      // and the exit check above is what makes a dead browser a real error instead of a 45-second wait.
      await sleep(250);
    }
  }
  if (!info) {
    const tail = chromeLog.trim().split("\n").slice(-12).join("\n");
    throw new Error(
      `no DevTools endpoint on ${port} after 45s — is Chrome/Edge installed at ${browser}?` +
        (tail ? `\n--- browser output ---\n${tail}` : "\n(the browser wrote nothing to stdout or stderr)"),
    );
  }
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
// answer it. Wrapping requestAnimationFrame before any page script runs gives the harness a record of every
// frame the page armed, so a render loop that is running, a loop that stopped when the door scrolled out of
// sight, and a page that never started one are three different measurable answers.
//
// Each registration is attributed to the component that made it, and the attribution is read off the stack
// at the moment `requestAnimationFrame` is CALLED — which is the caller's own frame, not the callback's.
// Vite emits one chunk per Astro `<script>` block and keeps the component name in the filename
// (`DoorScene.astro_astro_type_script_index_0_lang.<hash>.js`), so the chunk in the stack names the loop
// without the shipped code carrying a test hook. That matters more than it looks: the page now has FOUR
// legitimate loops (the door, the cursor trail, the dial's playback and the sky layer), and a gate that can
// only count callbacks per frame has to guess which ones are allowed. Guessing means the ceiling gets raised
// until the assertion stops meaning anything. Naming them means the ceiling can be exact, and a loop nobody
// wrote arrives as `unknown` — which is the one thing every window below refuses to tolerate.
const FRAME_PROBE = `(() => {
  const native = window.requestAnimationFrame.bind(window);
  const f = { on: false, events: [] };
  window.__hhFrames = f;
  const LOOPS = [["door", /DoorScene/], ["cursor", /Cursor/], ["ambient", /Atmosphere/], ["dial", /HoursClock/], ["preloader", /Preloader/]];
  window.requestAnimationFrame = (cb) => {
    let name = "unknown";
    let stack = "";
    try { stack = new Error().stack || ""; } catch (e) { stack = ""; }
    for (const [label, re] of LOOPS) { if (re.test(stack)) { name = label; break; } }
    return native((now) => {
      if (f.on) f.events.push([name, now]);
      return cb(now);
    });
  };
})()`;
await inPage("Page.addScriptToEvaluateOnNewDocument", { source: FRAME_PROBE });

async function startFrames() {
  await evaluate("window.__hhFrames.events.length = 0; window.__hhFrames.on = true; return true;");
}

// Read the window back as frame statistics. Distinct timestamps are frames; the per-loop counts say which of
// them each component armed, which is how a leaked loop gets caught by name instead of by an arithmetic
// guess about how many loops a page is expected to have. The old version of this comment allowed "two, not
// one" on the home page and defended the number by listing the components — a list that is now four long and
// one short of the truth, because the sky layer arrived after the sentence was written.
async function stopFrames() {
  return evaluate(`
    window.__hhFrames.on = false;
    const ev = window.__hhFrames.events.slice();
    window.__hhFrames.events.length = 0;
    const times = ev.map((e) => e[1]);
    const uniq = [...new Set(times)].sort((a, b) => a - b);
    const perFrame = new Map();
    for (const t of times) perFrame.set(t, (perFrame.get(t) || 0) + 1);
    const by = {};
    for (const [name] of ev) by[name] = (by[name] || 0) + 1;
    const d = [];
    for (let i = 1; i < uniq.length; i += 1) d.push(Math.round((uniq[i] - uniq[i - 1]) * 100) / 100);
    d.sort((a, b) => a - b);
    const pct = (p) => (d.length ? d[Math.min(d.length - 1, Math.floor(d.length * p))] : null);
    return {
      callbacks: ev.length,
      frames: uniq.length,
      by,
      maxPerFrame: perFrame.size ? Math.max(...perFrame.values()) : null,
      p50: pct(0.5),
      p95: pct(0.95),
      worst: d.length ? d[d.length - 1] : null,
      span: uniq.length > 1 ? Math.round(uniq[uniq.length - 1] - uniq[0]) : 0,
    };
  `);
}

/**
 * The assertion every window shares: nothing that is not one of the five named loops held the page.
 * `unknown` is what an unattributed registration looks like, and a leak from a component that was renamed
 * or a loop written in a file the list above does not know about is exactly as expensive as the leak the
 * gate was built to catch — it just used to be invisible behind a raised ceiling.
 */
function unknownLoop(where, stat) {
  const n = stat?.by?.unknown ?? 0;
  if (n > 0) failures.push(`${where}: ${n} rAF frame(s) armed by a loop this gate cannot name — add it to the list or stop it`);
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

/**
 * How far one hour's frames scatter around that hour's OWN mean.
 *
 * `meanStep` above is the wrong denominator for the question "did the room relight", and the reason is
 * arithmetic rather than taste: the step between two consecutive frames is roughly √2 times the scatter of
 * a frame around the mean, so a scene with a lot of motion reports a large "noise floor" even when the
 * average of twenty frames is perfectly stable. What decides whether a guest can see the hour change is the
 * uncertainty in the two averaged states, not the size of a single frame-to-frame move — and averaging is
 * exactly what `avgSig` does. This is that quantity: the standard deviation of a frame about its hour, from
 * which the standard error of the hour's mean follows by dividing by the frame count.
 */
function sigScatter(frames) {
  const mean = avgSig(frames);
  if (!mean) return null;
  const usable = frames.filter((f) => f?.sig);
  if (!usable.length) return null;
  let total = 0;
  let n = 0;
  for (const f of usable) {
    for (let b = 0; b < f.sig.length; b += 1) {
      if (f.sig[b] < 0 || mean.sig[b] < 0) continue;
      total += (f.sig[b] - mean.sig[b]) ** 2;
      n += 1;
    }
  }
  return n ? Math.round(Math.sqrt(total / n) * 100) / 100 : null;
}

/** Mean of the blocks in an averaged signature — the room's overall brightness, ignoring masked blocks. */
function sigLuma(sig) {
  if (!sig) return null;
  const vals = sig.filter((v) => v >= 0);
  return vals.length ? Math.round((vals.reduce((s, v) => s + v, 0) / vals.length) * 100) / 100 : null;
}


// ---------------------------------------------------------------- batteries
const results = [];
const failures = [];

// The report has to be unskippable. Every finding this script makes is pushed into the two arrays above, and
// until now the only code that printed them sat at the bottom of a script that can throw on any of the
// browser round-trips above it. It did throw, on the first CI cycle of the arm battery: one diagnostic read
// `[data-request-form]` from the wrong document, Node printed a stack, and the thirteen arms that had already
// executed left no evidence of anything they had learned. These two handlers turn that case into a line at the
// top of a report that still contains the rows, which is the difference between a red run that tells you where
// to look and a red run that tells you to run it again. They are installed here, before the first battery,
// because a crash on the way in has not reached the bottom of the file.
process.on("uncaughtException", (error) => {
  setTimeout(() => process.exit(1), 30_000).unref();
  printReport(error).catch(() => process.exit(1));
});
process.on("unhandledRejection", (reason) => {
  setTimeout(() => process.exit(1), 30_000).unref();
  printReport(reason ?? new Error("promise rejected with no reason")).catch(() => process.exit(1));
});
// The timer is unref'd so it cannot keep a healthy run alive, and it exists because installing these
// handlers removes Node's own default of printing and dying: if the report ever failed to reach goodbye,
// the runner would sit holding a Chrome process until GitHub cancelled it after six hours — a worse
// outcome than the crash it was meant to report.

// The rig has written `--hour` and `--night` at four decimal places since A19 took the half-hour detent
// out — a continuous day means 18:25 arrives as "18.4167", not "18.5". Every assertion about "the hour this
// visitor dialled" therefore compares numbers rather than the literal text on the root, with a tolerance of
// a tenth of an hour. That is far looser than the rounding a 4-dp write introduces and far tighter than any
// real disagreement: a lost state lands on the build's wall clock, which is hours away.
const hourEquals = (actual, wanted) => Number.isFinite(Number(actual)) && Math.abs(Number(actual) - wanted) < 0.1;

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
    return { total: nodes.length, missed: missed.length, which: missed.slice(0, 6).map((el) => { const r = el.getBoundingClientRect(); return el.tagName.toLowerCase() + "." + String(el.className).replace(/\\s+/g, ".").slice(0, 40) + " \\"" + String(el.textContent).replace(/\\s+/g, " ").trim().slice(0, 34) + "\\" at " + Math.round(r.top) + ".." + Math.round(r.bottom); }) };
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
  if (!hourEquals(dial.at20.hour, 20)) failures.push(`/ dial at 20:00 wrote --hour ${dial.at20.hour}`);
  if (dial.at20.dialText && /closed/i.test(dial.at20.dialText)) failures.push(`/ dial at 20:00 reads “${dial.at20.dialText}” — 20:00 is inside the hours of record`);
  if (dial.at3.dialText && /open now/i.test(dial.at3.dialText)) failures.push(`/ dial at 03:00 reads “${dial.at3.dialText}” — it should say closed`);
  const nowHour = Number(dial.afterBackToNow);
  const eatHour = Number(dial.nairobiNow.slice(0, 2)) + Number(dial.nairobiNow.slice(3, 5)) / 60;
  // The day is a circle now: the dial runs 00:00 → 24:00 continuously, so a click one side of midnight
  // must not read as a 23-hour error. Six minutes of slack covers the minute the sample is quantised to
  // and the round trip that produced it, and nothing more — the old tolerance was wide because the rig
  // used to snap to a half hour, which is the behaviour A19 removed.
  const backToNowGap = Number.isFinite(nowHour) ? Math.abs(nowHour - eatHour) : null;
  if (backToNowGap !== null && Math.min(backToNowGap, 24 - backToNowGap) > 0.1) {
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

// ---- scripts killed mid-session: the poster is still the renderer when the bundle dies
// Not the no-JS battery — the row below this section is. Deleting the tags after the fact leaves html.js
// set and the already-intersected sections revealed, so it measures a page whose JavaScript died halfway,
// which is its own failure mode and the one the WebGL door has to survive.
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
results.push({ path: "/ (scripts killed mid-run)", value: { noJs, noJsFacts }, errors: [], warnings: [] });
if (!noJsFacts.stillPainted) failures.push("/ after the scripts were deleted the CSS still is not painted — the poster fallback is not the renderer of record");

// ---- the document that never executed a script, measured without executing one
/*
  Deleting the tags is not the same as JavaScript never running, and the difference is the whole claim.
  Base.astro:132 puts html.js on the root from an inline script during head parsing, so by the time the
  tags could be deleted the class was already there — and global.css:327 then holds every [data-reveal] at
  opacity 0 until an IntersectionObserver adds .is-in. A scriptless guest never sets the class and reads
  global.css:323 (opacity 1) instead. Those are two different documents, and only one of them is the
  promise the site makes: nobody has to run JavaScript to read Habibi Haven.

  So this probe asks the browser rather than the page. Emulation.setScriptExecutionDisabled stops the next
  load from executing anything, the inline setter included, which is the point of it. DOM.getDocument and
  CSS.getComputedStyleForNode then answer from the renderer's own tree and style engine: neither evaluates
  JavaScript in the page, so the measurement cannot wake the site up in order to prove it was awake.
*/
async function noJsStyleProbe(route) {
  const probe = { route, jsClassOnRoot: null, revealNodes: null, opacity: [], probeError: null };
  try {
    await inPage("DOM.enable");
    await inPage("CSS.enable");
    const { root } = await inPage("DOM.getDocument", { depth: 0 });
    const jsClass = await inPage("DOM.querySelectorAll", { nodeId: root.nodeId, selector: "html.js" });
    const reveals = await inPage("DOM.querySelectorAll", { nodeId: root.nodeId, selector: "[data-reveal]" });
    const ids = reveals.nodeIds || [];
    probe.jsClassOnRoot = (jsClass.nodeIds || []).length;
    probe.revealNodes = ids.length;
    // First, middle and last in document order. The last is the block furthest down the page — the one an
    // observer would never have reached on a guest's first screen, and therefore the one a no-JS claim
    // actually lives or dies on.
    const picks = [...new Set([0, Math.floor(ids.length / 2), ids.length - 1])].filter((i) => i >= 0 && i < ids.length);
    for (const i of picks) {
      const { computedStyle } = await inPage("CSS.getComputedStyleForNode", { nodeId: ids[i] });
      const found = (computedStyle || []).find((p) => p.name === "opacity");
      probe.opacity.push(found ? found.value : null);
    }
  } catch (error) {
    probe.probeError = String(error?.message ?? error).slice(0, 180);
  }
  return probe;
}

await inPage("Emulation.setScriptExecutionDisabled", { value: true });
await goto("/");
const noJsHome = await noJsStyleProbe("/");
const noJsHomeLog = drain();
await goto("/menu");
const noJsMenu = await noJsStyleProbe("/menu");
const noJsMenuLog = drain();
await inPage("Emulation.setScriptExecutionDisabled", { value: false });
// goto clears the event buffer, so each load's complaints have to be collected while that load is current.
results.push({
  path: "no-JS (execution off)",
  value: { noJsHome, noJsMenu },
  errors: [...noJsHomeLog.errors, ...noJsMenuLog.errors],
  warnings: [...new Set([...noJsHomeLog.warnings, ...noJsMenuLog.warnings])],
});
for (const row of [noJsHome, noJsMenu]) {
  if (row.probeError) {
    failures.push(`${row.route}: the script-disabled probe could not run (${row.probeError}) — the no-JS readability claim is unmeasured, and an unmeasured claim does not get to stay in the pitch`);
    continue;
  }
  if (row.jsClassOnRoot !== 0)
    failures.push(`${row.route}: html.js is on the root with script execution disabled, so global.css:327 is hiding every [data-reveal] at opacity 0 with no observer left to reveal them`);
  if (!row.opacity.length || row.opacity.some((v) => v !== "1"))
    failures.push(`${row.route}: [data-reveal] computes to ${JSON.stringify(row.opacity)} in a document that executed no script — content is invisible to a guest without JavaScript`);
}
await goto("/");

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
// each hour is averaged over the burst and the question is whether the gap between the two averaged states
// clears the uncertainty of that gap (see `sigScatter`), and whether it goes the right way: evening darker
// than afternoon.
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
  // Ten frames per hour, not six. The statistic below is a ratio of the hour gap to the standard error of
  // the two averages, and the error falls with the square root of the sample: at six frames an honest 3.5%
  // shift sits at 2.7× and reads as "the room is not relighting", when what is thin is the sample. Four
  // more screenshots per hour is the cheapest way to make the claim mean what it says.
  for (let i = 0; i < 10; i += 1) {
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
  scatterDusk: sigScatter(dusk.frames),
  scatterNoon: sigScatter(noon.frames),
  cross: sigDistance(avgSig(dusk.frames), avgSig(noon.frames)),
  lumaDusk: sigLuma(avgSig(dusk.frames)?.sig),
  lumaNoon: sigLuma(avgSig(noon.frames)?.sig),
};
// The margin matters as much as the ordering. With the sprites sampling their texture the soft glow and the
// drifting motes cover real area, so two frames of the SAME hour now sit tens of luminance units apart on
// their own — a single pair is mostly motion. Averaging each burst leaves the hour, and what the hour gap
// has to clear is the uncertainty of those two averages, not the size of one frame's step: see `sigScatter`.
hourFrames.sem =
  hourFrames.scatterDusk !== null && hourFrames.scatterNoon !== null && dusk.frames.length && noon.frames.length
    ? Math.round(Math.sqrt(hourFrames.scatterDusk ** 2 / dusk.frames.length + hourFrames.scatterNoon ** 2 / noon.frames.length) * 100) / 100
    : null;
hourFrames.snr =
  hourFrames.cross !== null && hourFrames.sem ? Math.round((hourFrames.cross / hourFrames.sem) * 100) / 100 : null;
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
    // The old claim here was `cross > 1.5 × meanStep`, and it was the wrong statistic rather than the wrong
    // threshold: the step between two frames is ~√2 × the scatter about the mean, so a scene with drifting
    // dust and breathing lamps reports a huge "floor" for an average that is in fact stable. What a guest
    // sees is the averaged state of the room, so what the hour gap has to clear is the standard error of the
    // difference between the two averaged states. Three standard errors is the point at which a difference is
    // not a coincidence of which frames the burst happened to catch.
    if (hourFrames.snr === null) {
      failures.push(`/ the two hour bursts gave ${hourFrames.framesDusk} and ${hourFrames.framesNoon} usable frame(s) — the hour gap of ${hourFrames.cross} has no noise estimate, so the relighting claim is unmeasured rather than true`);
    } else if (hourFrames.snr < 3) {
      failures.push(`/ the door at 20:00 vs 14:00 differs by ${hourFrames.cross} luminance units, ${hourFrames.snr}× the standard error of that gap (${hourFrames.sem}) — under 3× the change is inside the motion, and the room is not visibly relighting`);
    }
    // And it has to be the right change. Two palettes can be far apart while the evening reads brighter than
    // the afternoon, which is a scene that answers the dial with a different colour rather than with less
    // light — rigValues walks the daylight down to a fifth of its noon strength, and the ambient term that
    // the lite tier is left with drops further still, for exactly this reason.
    if (hourFrames.lumaDusk === null || hourFrames.lumaNoon === null) {
      failures.push("/ the door frames carried no luminance grid, so the room's brightness at the two hours is unmeasured");
    } else if (hourFrames.lumaDusk >= hourFrames.lumaNoon) {
      failures.push(`/ the door averages ${hourFrames.lumaDusk} luminance at 20:00 against ${hourFrames.lumaNoon} at 14:00 — the evening is not darker than the afternoon, so the dial changed the palette and not the light`);
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
  const rs = q("[data-rs]");
  const tick = q("[data-ticker-root]");
  const track = q("[data-ticker]");
  // Two of the moving things on this page are new answers to the owner's list, and both have to behave
  // when motion is asked for: the review samples must stop advancing but keep every sample reachable by
  // hand, and the ticker must not offer a Stop button for a line that is not moving.
  const indexBefore = rs ? Number(rs.getAttribute("data-rs-index")) : null;
  q("[data-rs-next]")?.click();
  return {
    tier: door ? door.dataset.tier : null,
    reason: door ? door.dataset.tierReason : null,
    doorCanvas: !!q("[data-door] canvas"),
    anyCanvas: all("canvas").length,
    stillPainted: q(".hero__still") ? getComputedStyle(q(".hero__still")).backgroundImage.includes("venue-facade-night") : false,
    heroText: q("h1") ? q("h1").textContent.trim().slice(0, 44) : null,
    cards: all("[data-card]").length,
    stuckAtLoad: all("[data-reveal]").filter((el) => Number(getComputedStyle(el).opacity) < 0.1).length,
    samples: all("[data-rs-slide]").length,
    rsState: rs ? rs.getAttribute("data-rs-state") : null,
    rsStepped: rs ? Number(rs.getAttribute("data-rs-index")) - indexBefore : null,
    tickerState: tick ? tick.getAttribute("data-ticker-state") : null,
    tickerAnim: track ? getComputedStyle(track).animationName : null,
    tickerCtlHidden: q("[data-ticker-play]") ? q("[data-ticker-play]").hidden : null,
    tickerHintHidden: q("[data-ticker-hint]") ? q("[data-ticker-hint]").hidden : null,
  };
`);
drain();
results.push({ path: "/ (reduced motion)", value: poster, errors: [], warnings: [] });
if (poster.tier !== "poster") failures.push(`/ a browser asking for reduced motion was given tier ${JSON.stringify(poster.tier)} (${poster.reason}), not poster`);
if (poster.doorCanvas) failures.push("/ under reduced motion the door mounted a canvas anyway — the WebGL branch is supposed to stop at poster");
if (!poster.stillPainted) failures.push("/ under reduced motion the CSS photograph is not painted, so the fallback has nothing to show");
if (poster.stuckAtLoad > 0) failures.push(`/ under reduced motion ${poster.stuckAtLoad} reveal element(s) sit at opacity 0 at load — motion was removed and the content with it`);
if (poster.samples < 5) failures.push(`/ under reduced motion the review rotator has ${poster.samples} samples — the count comes from press.json and motion cannot change it`);
if (poster.rsState !== "paused") failures.push(`/ the review samples read state ${JSON.stringify(poster.rsState)} under reduced motion, not paused — a timer that moves text is motion, and this one has to obey`);
if (poster.rsStepped !== 1) failures.push(`/ under reduced motion the rotator's Next button moved ${poster.rsStepped} sample(s) — motion off must not mean content unreachable`);
if (poster.tickerState !== "static") failures.push(`/ the ticker reports ${JSON.stringify(poster.tickerState)} under reduced motion instead of static — it is claiming to control an animation it does not have`);
if (poster.tickerAnim !== "none") failures.push(`/ under reduced motion the ticker track still runs animation-name ${JSON.stringify(poster.tickerAnim)} — the stylesheet is the layer that stops it`);
if (poster.tickerCtlHidden !== true || poster.tickerHintHidden !== true) failures.push("/ under reduced motion the ticker still shows a Stop button or a drag hint for a line that is not moving — a control that does nothing is worse than no control");

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
// …and one window where the sky is the only thing on the page: /menu has no door, so the ambient layer is
// the entire expected loop set there. Measured separately from menuFrames because that window is taken with
// the media query at its default, and the claim being tested is "the layer that replaces the door's job is
// the one that stays".
await goto("/menu");
const menuAmbient = await measure(1100);
results.push({ path: "frames", value: { glInfo, inView, outOfView, awayGeometry, menuFrames, menuAmbient, posterFrames }, errors: [], warnings: [] });
if (glInfo.contextLost) failures.push("/ the WebGL context is lost on the page under test — every frame count below is meaningless");
// Each window now names its loops, so every sentence below is about the component it mentions rather than
// about an arithmetic average of everything on the page. That is the difference between a gate that catches
// "the door never stopped" and one that catches "something on the home page is busy", which is what the old
// `frames > 3` assertions actually measured once a background layer existed.
if ((inView.by.door ?? 0) < 1) failures.push(`/ the door armed ${inView.by?.door ?? 0} frames in ${inView.span}ms while on screen (hidden=${glInfo.hidden}) — the render loop is not running`);
if ((inView.by.ambient ?? 0) < 1) failures.push(`/ the sky layer armed ${inView.by?.ambient ?? 0} frames while on screen — the atmosphere is mounted but not painting, so the room is a still image`);
if (awayGeometry.bottom > 0 && awayGeometry.top < awayGeometry.vh) failures.push(`/ the door was still on screen after the scroll (${JSON.stringify(awayGeometry)}) — the off-screen measurement proved nothing`);
// One frame of slack: the callback that was already scheduled when the door left the view still runs.
if ((outOfView.by.door ?? 0) > 1) failures.push(`/ the door kept painting ${outOfView.by?.door ?? 0} frames after it left the viewport (${JSON.stringify(awayGeometry)})`);
if ((menuFrames.by.door ?? 0) > 0) failures.push(`/menu ran ${menuFrames.by?.door ?? 0} door frames with no door on the page`);
if ((menuAmbient.by.ambient ?? 0) < 1) failures.push(`/menu ran ${menuAmbient.by?.ambient ?? 0} sky frames — the page has no scene, and the layer that carries its light stopped`);
if ((posterFrames.by.door ?? 0) > 1) failures.push(`/ under reduced motion the door armed ${posterFrames.by?.door ?? 0} frames — the poster tier draws one frame and stops`);
if ((posterFrames.by.ambient ?? 0) > 0) failures.push(`/ under reduced motion the sky layer armed ${posterFrames.by?.ambient ?? 0} frames — the atmosphere is animation, and it is supposed to read the same preference the door does`);
for (const [where, stat] of [["/ in view", inView], ["/ away", outOfView], ["/menu", menuFrames], ["/menu sky", menuAmbient], ["/ reduced motion", posterFrames]]) unknownLoop(where, stat);
// The sky's own budget, measured as draws rather than as callbacks — because those are not the same number,
// and the first version of this gate got them confused and reported a working limiter as a broken one. The
// component keeps one requestAnimationFrame chain alive so event-driven updates stay immediate, and skips the
// GPU work inside it (Atmosphere.astro, `if (now - lastDraw < 1000 / FPS) return`). Counting rAF wake-ups, as
// loopRate does, therefore reads the display rate (53.6 here) whatever the cap is; the claim "capped at 24 fps"
// is about the thing that costs power. So the prototype's draw entry points are wrapped for one window and the
// draws on the atmosphere canvas are counted, which is the only rate that can falsify the sentence in the file.
const skyDraws = await evaluate(`
    const canvas = document.querySelector("[data-atmosphere-canvas]");
    if (!canvas) return { present: false };
    const gl = canvas.getContext("webgl2") || canvas.getContext("webgl") || canvas.getContext("experimental-webgl");
    if (!gl) return { present: true, noContext: true };
    const tally = { sky: 0, other: 0 };
    const protos = [window.WebGL2RenderingContext && window.WebGL2RenderingContext.prototype, window.WebGLRenderingContext && window.WebGLRenderingContext.prototype].filter(Boolean);
    let patched = 0;
    for (const proto of protos) {
      for (const name of ["drawArrays", "drawElements", "drawArraysInstanced", "drawElementsInstanced"]) {
        const orig = proto[name];
        if (typeof orig !== "function" || orig.__hhCounted) continue;
        const wrapped = function () {
          // this.canvas, not the captured gl: one page can hold two contexts and the sentence is about the sky.
          tally[this && this.canvas === canvas ? "sky" : "other"] += 1;
          return orig.apply(this, arguments);
        };
        wrapped.__hhCounted = true;
        proto[name] = wrapped;
        patched += 1;
      }
    }
    const t0 = performance.now();
    await new Promise((r) => setTimeout(r, 1100));
    const span = performance.now() - t0;
    return {
      present: true,
      patched,
      span: Math.round(span),
      sky: tally.sky,
      other: tally.other,
      drawsPerSecond: Math.round((tally.sky / span) * 10000) / 10,
    };
  `);
results.push({ path: "frames (sky draws)", value: skyDraws, errors: [], warnings: [] });
if (!skyDraws.present) failures.push("/menu has no [data-atmosphere-canvas] — the layer that carries the sky on a page without a door is not in the document");
else if (skyDraws.noContext) failures.push("/menu the atmosphere canvas has no WebGL context and no data-css fallback was asserted — the sky is either a gradient or nothing");
else if (skyDraws.patched === 0) failures.push("/menu: no WebGL draw entry point could be wrapped, so the sky's frame budget is unmeasured rather than met");
else if (skyDraws.sky === 0) failures.push(`/menu: the sky layer woke ${menuAmbient.by?.ambient ?? 0} times in ${menuAmbient.span}ms and issued 0 draw calls — a loop that paints nothing is still a loop on somebody's main thread`);
else if (skyDraws.drawsPerSecond > 30)
  failures.push(`/menu: the sky issued ${skyDraws.sky} draws in ${skyDraws.span}ms = ${skyDraws.drawsPerSecond} fps against a 24 fps cap — the limiter in Atmosphere.astro is not holding`);


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
  // The cursor is judged by its own counter now, not by how many callbacks shared a vsync. The old test
  // could only ask "is the total 2?", and a page that carries a sky layer paints three loops in steady
  // state — so the number that used to prove the cursor had stopped would, after A19, merely prove that
  // somebody had added a component. Named loops keep the same guarantee and stop colliding with design.
  if (!(chasing.by?.cursor > 0)) failures.push(`/ while the ring was chasing a moving pointer the cursor loop armed ${chasing.by?.cursor ?? 0} frames — the pointer moved and nothing followed (${JSON.stringify(chasing.by)})`);
  if (!(chasing.by?.door > 0)) failures.push(`/ while chasing, the door armed ${chasing.by?.door ?? 0} frames — the scene stopped painting during the cursor test, so the window measured one loop and called it two`);
  if (idle.by?.cursor > 0) failures.push(`/ before the pointer ever moved, the cursor loop armed ${idle.by.cursor} of the ${idle.frames} frames with the preloader gone — something is arming the cursor without a mouse`);
  if (!moved.dot || !moved.ring) failures.push(`/ after moving, the inline transforms were ${JSON.stringify([moved.dot, moved.ring])} — the dot and the ring are both supposed to be positioned by the loop`);
  if (!converged) failures.push(`/ 30 s after a pointer move the ring was still writing a new transform every sample (${chase.samples.length} samples, all "≠") — an exponential chase that never stops is a permanent second loop on every page with the cursor enabled`);
  else if (!(settled.by?.door > 0)) failures.push(`/ the door armed ${settled.by?.door ?? 0} frames in the window after the ring settled (${JSON.stringify(settled.by)}) — there is nothing to judge about the second loop`);
  else if (settled.by?.cursor > 0) failures.push(`/ the ring stopped writing after ${converged.afterMs} ms, yet the cursor loop armed ${settled.by.cursor} of the ${settled.frames} frames that followed — it is running to repaint two numbers that are not changing`);
  // The dial's playback loop belongs to HoursClock and only to the seconds it is asked to run. Nothing in
  // this window presses play, so a dial frame here is a loop that outlived its own button.
  for (const [where, stat] of [["/ cursor idle", idle], ["/ cursor chasing", chasing], ["/ cursor settled", settled]]) {
    if (stat.by?.dial > 0) failures.push(`${where}: the dial loop armed ${stat.by.dial} frames while nothing was playing it`);
    unknownLoop(where, stat);
  }

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
    // document, not window: astro/dist/transitions/router.js fires these with
    // document.dispatchEvent(new Event(name)), and a plain Event does not bubble — a window listener
    // here would sit out every navigation and report a router that never ran.
    // And not with once: true. A listener that detaches itself on its first firing can only ever report 0 or 1,
    // which makes "exactly one page-load per navigation" unfalsifiable: the duplicate it exists to catch
    // would be invisible by construction. Count every firing, then unbind — the Document object survives a
    // swap (swapBodyElement replaces the <body> element, not the document), so the removal is real and the
    // next step starts from zero.
    let swapped = 0, loaded = 0;
    const onSwap = () => { swapped += 1; };
    const onLoad = () => { loaded += 1; };
    document.addEventListener("astro:after-swap", onSwap);
    document.addEventListener("astro:page-load", onLoad);
    link.click();
    const t0 = Date.now();
    while (Date.now() - t0 < 9000 && !(swapped && loaded)) await wait(40);
    // announce() runs after astro:page-load and sets its text in a further 60ms timeout, so this settle
    // window is also what makes announced and announcers mean anything.
    await wait(700);
    document.removeEventListener("astro:after-swap", onSwap);
    document.removeEventListener("astro:page-load", onLoad);
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
      announcers: document.querySelectorAll(".astro-route-announcer").length,
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
    mark: window.__hhMark ?? null,
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
  // Run 43760030228 measured this holding on a real swap — router.js announce() reads document.title 60ms
  // after astro:page-load — so it is a claim and not a guess: the page a screen reader is told about has to
  // be the page that arrived.
  if (step.announced !== step.title)
    failures.push(`${step.expected}: the route announcer said ${JSON.stringify(step.announced)} while the title is ${JSON.stringify(step.title)} — assistive tech is announced a different page than the one that landed`);
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
if (!hourEquals(routerDial.hour, 3)) failures.push(`dialling 03:00 left --hour at ${JSON.stringify(routerDial.hour)} — the state was never written, so the later comparisons mean nothing`);
for (const step of [toMenu, toTable, backHome]) {
  if (step.clicked && !hourEquals(step.hour, 3))
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
  failures.push(`back/forward tore the document down (window.__hhMark reads ${JSON.stringify([wentBack.mark, cameForward.mark])}) — the router is not handling popstate in this build`);
if (!hourEquals(wentBack.hour, 3) || !hourEquals(cameForward.hour, 3))
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

// --------------------------------------------------------- filter bar geometry
/* ---- M-bis: the filter bar is geometry, and geometry is measurable

   Four of the fifteen complaints against this page are about the same rectangle: it blocked content (15),
   the menu overlapped (13), the spacing on desktop was too large (6), and the search and sort did not feel
   like they belonged (14). Every one of those is a number, and a number can be pinned, so the pitch does
   not have to rest on whether anyone agrees the bar looks better today:
     · how tall it is, as a share of the viewport and in pixels;
     · what it paints itself with — an 84% wash over a scrolling menu is how dish copy ended up reading up
       through the search placeholder, which is what "overlapping" meant;
     · whether the sort control is still the operating system's grey box;
     · how much text is clipped by its own box (the duplicated dish names on the pending cards);
     · how much air a section spends on a desktop.
*/
await goto("/menu");
const barGeo = await evaluate(`
    const q = (s) => document.querySelector(s);
    const cs = (el) => getComputedStyle(el);
    const bar = q("[data-bar]");
    if (!bar) return { missing: true };
    const r = bar.getBoundingClientRect();
    const bg = cs(bar).backgroundColor;
    /* Alpha, read the way Chrome actually serialises a token. A background of var(--bg-0) resolves through
       color-mix() and comes back as oklab(0.88 -0.001 0.006) or oklab(… / 0.84), not as rgba() — a parser
       that only knows rgb()/rgba() reads a real opacity as null and reports an opaque plate as a ghost.
       The rule is the one CSS uses: a slash introduces the alpha, everything else is solid. */
    const alpha = (() => {
      const s = String(bg);
      const slash = s.indexOf("/");
      if (slash > -1) return parseFloat(s.slice(slash + 1));
      const m = /rgba?\\(([^)]*)\\)/.exec(s);
      if (!m) return s.startsWith("rgb") ? null : 1;
      const parts = m[1].split(/[,/\\s]+/).filter(Boolean).map(parseFloat);
      return parts.length > 3 ? parts[3] : 1;
    })();
    // Anything whose own box is smaller than its content is clipped text. Three exclusions, each
    // deliberate: .card__desc is clamped to three lines (that overflow is the design, and a long scraped
    // description would trip it on dozens of cards); .explorer__count and .explorer__src are the only
    // lines allowed to ellipsis; and a .kin headline that has not been revealed yet is translated 105%
    // inside its own mask, so its overflow is the animation waiting to happen, not a clipped word. That
    // last one cost a run to learn: the audit reported "The kitchen" as overlapping text because the
    // geometry battery measures the bar at load, before anything below the fold has arrived.
    const clipped = [];
    for (const el of document.querySelectorAll(".card__name, .card__price, .frame--type em, .frame__mark, .chips button, .section-head h2, .section-head h3")) {
      if (el.offsetParent === null) continue;
      if (el.classList.contains("kin") && !el.classList.contains("is-in")) continue;
      if (el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1) {
        clipped.push(el.className + ":" + (el.textContent || "").trim().slice(0, 22));
      }
    }
    const stage = q(".stage") || q("main > *");
    return {
      missing: false,
      viewport: [innerWidth, innerHeight],
      bar: { h: Math.round(r.height), w: Math.round(r.width), top: Math.round(r.top) },
      share: Math.round((r.height / innerHeight) * 1000) / 1000,
      navH: cs(document.documentElement).getPropertyValue("--nav-h").trim(),
      barH: cs(document.documentElement).getPropertyValue("--bar-h").trim() || cs(bar.parentElement).getPropertyValue("--bar-h").trim(),
      bg,
      alpha,
      blur: cs(bar).backdropFilter || cs(bar).webkitBackdropFilter,
      sticky: cs(bar).position,
      selectAppearance: cs(q("[data-sort]")).appearance,
      selectCursor: cs(q("[data-sort]")).cursor,
      foldedAtLoad: q("#explorer-filters") ? q("#explorer-filters").hidden : null,
      toggleHidden: q("[data-filters]") ? q("[data-filters]").hidden : null,
      clipped: clipped.length,
      clippedExample: clipped.slice(0, 4),
      stagePaddingTop: stage ? Math.round(parseFloat(cs(stage).paddingTop) || 0) : null,
    };
  `);
const geoLogged = drain();
results.push({ path: "/menu (bar geometry)", value: barGeo, errors: geoLogged.errors, warnings: geoLogged.warnings });
if (barGeo.missing) failures.push("/menu has no [data-bar] — the filter bar the guest scrolls under is gone");
else {
  if (barGeo.sticky !== "sticky") failures.push(`/menu the filter bar is position:${barGeo.sticky}, so it does not stay with the guest through 243 dishes`);
  if (barGeo.bar.top < 0) failures.push(`/menu the filter bar sits at top ${barGeo.bar.top} — above the viewport, so the header covers it`);
  if (barGeo.alpha !== 1) failures.push(`/menu the sticky bar paints itself with ${barGeo.bg} (alpha ${barGeo.alpha}) over a scrolling menu — dish copy reads through the search box again`);
  if (barGeo.blur !== "none") failures.push(`/menu the bar still runs a backdrop-filter (${barGeo.blur}) on a plate that is meant to be opaque — it costs a compositor layer for a effect nobody can see`);
  if (barGeo.bar.h > 180 || barGeo.share > 0.18) failures.push(`/menu the filter bar is ${barGeo.bar.h}px tall on a ${barGeo.viewport[1]}px viewport (${Math.round(barGeo.share * 100)}%) — it is still taking the screen instead of the menu`);
  if (barGeo.selectAppearance !== "none") failures.push(`/menu the sort control computes appearance:${barGeo.selectAppearance} — the guest is being offered the operating system's grey box`);
  if (barGeo.clipped > 0) failures.push(`/menu ${barGeo.clipped} element(s) have text clipped by their own box (${barGeo.clippedExample.join(" | ")}) — this is the overlap the menu was criticised for`);
  if (barGeo.stagePaddingTop !== null && barGeo.stagePaddingTop > 116) failures.push(`/menu a section spends ${barGeo.stagePaddingTop}px of top padding on a ${barGeo.viewport[0]}px desktop — more air than restaurant`);
}

/* The fold half of the same complaint. At 390px the two chip rows sit behind a button, and that button has
   to be real rather than decorative: aria-expanded has to flip, the panel has to appear, the bar has to
   grow by roughly the panel, and folding again has to put it back. Measured here rather than in the phone
   battery below because this is about the bar, not the dock. */
await inPage("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await goto("/menu");
const fold = await evaluate(`
    const q = (s) => document.querySelector(s);
    const bar = q("[data-bar]");
    const panel = q("#explorer-filters");
    const toggle = q("[data-filters]");
    const before = {
      barH: Math.round(bar.getBoundingClientRect().height),
      panelHidden: panel.hidden,
      toggleHidden: toggle.hidden,
      expanded: toggle.getAttribute("aria-expanded"),
      chipsReachable: Array.from(panel.querySelectorAll("button")).some((b) => b.offsetParent !== null),
    };
    toggle.click();
    await new Promise((r) => setTimeout(r, 120));
    const after = {
      panelHidden: panel.hidden,
      expanded: toggle.getAttribute("aria-expanded"),
      chipsReachable: Array.from(panel.querySelectorAll("button")).some((b) => b.offsetParent !== null),
      barH: Math.round(bar.getBoundingClientRect().height),
      badgeHidden: q("[data-filters-n]").hidden,
    };
    toggle.click();
    await new Promise((r) => setTimeout(r, 120));
    return { before, after, refolded: panel.hidden };
  `);
const foldLogged = drain();
results.push({ path: "/menu (bar folds on a phone)", value: fold, errors: foldLogged.errors, warnings: foldLogged.warnings });
if (fold.before.toggleHidden) failures.push("/menu at 390px hides the Filters button — the chips are stacked over the menu with nothing to fold them");
if (!fold.before.panelHidden) failures.push("/menu at 390px ships with both chip rows open, which is the sticky bar that was criticised for blocking content");
if (fold.before.barH > 150) failures.push(`/menu's folded bar is still ${fold.before.barH}px on an 844px phone (${Math.round((fold.before.barH / 844) * 100)}%)`);
if (fold.before.chipsReachable) failures.push("/menu at 390px: the folded chip panel still leaves its buttons focusable — a keyboard guest is tabbing into controls they cannot see");
if (fold.after.panelHidden || fold.after.expanded !== "true" || !fold.after.chipsReachable) failures.push("/menu: tapping Filters did not open the panel (aria-expanded went to " + fold.after.expanded + ")");
if (fold.after.barH <= fold.before.barH) failures.push(`/menu: opening the filters left the bar no taller (${fold.before.barH} → ${fold.after.barH}px) — the panel is not the thing that grows the bar`);
if (!fold.refolded) failures.push("/menu: tapping Filters a second time did not fold the panel back");
await inPage("Emulation.clearDeviceMetricsOverride", {});
await goto("/menu");

// ------------------------------------------- review samples and the moving line
/* ---- M-ter: two new moving things, and both have to answer to a hand

   Item 11 asked for samples of the reviews that shift after a while; item 12 asked for the ticker to be
   pausable, draggable left and right, and worth reading. Those are opposite failures waiting to happen:
   a rotator that moves but cannot be stopped is a WCAG 2.2.2 problem and a reading problem, and one that
   can be stopped but never moves is the complaint the owner actually made. So each claim is measured:

     · the samples exist, one is shown, the rest are `inert`, and a keyboard cannot land inside a hidden
       quotation — proven by actually calling focus() on its link and checking it was refused;
     · with nobody touching it, the sample changes on its own inside the declared window;
     · the Stop button stops it, and it stays stopped over the same window;
     · Next steps by one, a dot jumps to one, and releasing Stop starts it again;
     · the ticker's own animation is what the controls act on — Stop pauses it and the clock does not
       drift, a drag seeks the track by exactly the arithmetic the component documents, and releasing
       resumes from where the reader put it;
     · the line carries the facts it now claims to carry: a price, an emoji, a quotation.

   The pointer is parked in the corner first, because both components treat a hover as a hold, and a
   virtual cursor left over from the cursor battery would read as a reader with a finger on it. */
await inPage("Input.dispatchMouseEvent", { type: "mouseMoved", x: 4, y: 4, buttons: 0 });
await goto("/");
const samples = await evaluate(`
    const q = (s) => document.querySelector(s);
    const rs = q("[data-rs]");
    if (!rs) return { missing: true };
    const slides = [...rs.querySelectorAll("[data-rs-slide]")];
    const shown = slides.filter((s) => s.classList.contains("is-on"));
    const off = slides.find((s) => !s.classList.contains("is-on"));
    // A hidden quotation must not be a tab stop. This is the real test, not a grep for an attribute:
    // ask the browser to focus a link inside it and see whether it obeys.
    const link = off ? off.querySelector("a") : null;
    let focusRefused = null;
    if (link) {
      link.focus();
      focusRefused = document.activeElement !== link;
    }
    const quotes = [...rs.querySelectorAll("blockquote")].map((b) => b.textContent.trim());
    return {
      missing: false,
      slides: slides.length,
      shown: shown.length,
      inertOff: slides.filter((s) => !s.classList.contains("is-on")).every((s) => s.hasAttribute("inert")),
      focusRefused,
      state: rs.getAttribute("data-rs-state"),
      index: Number(rs.getAttribute("data-rs-index")),
      live: rs.querySelector(".rs__stage").getAttribute("aria-live"),
      dots: rs.querySelectorAll("[data-rs-dot]").length,
      selected: rs.querySelectorAll('[data-rs-dot][aria-selected="true"]').length,
      links: rs.querySelectorAll("[data-rs-slide] a[target=_blank]").length,
      quoted: quotes.length,
      quoteSample: quotes[0] ? quotes[0].slice(0, 60) : null,
      hasCounts: /of the 541 Google Maps reviews/.test(rs.textContent),
      rel: [...rs.querySelectorAll("a")].every((a) => a.rel.includes("noopener")),
    };
  `);
const samplesLogged = drain();
results.push({ path: "/ (review samples)", value: samples, errors: samplesLogged.errors, warnings: samplesLogged.warnings });
if (samples.missing) {
  failures.push("/ has no review rotator — item 11 of the owner's list is unanswered");
} else {
  if (samples.slides < 5) failures.push(`/ the rotator shows ${samples.slides} samples; press.json holds 3 linked clips and the themes with double-digit counts, so a missing one is a build bug, not a design choice`);
  if (samples.shown !== 1) failures.push(`/ ${samples.shown} review samples are on screen at once — they are stacked in one cell, so this is the transition not landing`);
  if (!samples.inertOff) failures.push("/ a review sample that is not on screen is still interactive — the reader would be tabbing into a quotation they cannot see");
  if (samples.focusRefused !== true) failures.push("/ a keyboard can focus a link inside a hidden review sample, despite the inert attribute — the sample is invisible, not unreachable");
  if (samples.state !== "playing") failures.push(`/ the rotator loaded in state ${JSON.stringify(samples.state)} — with nobody touching it and motion allowed, it must be moving (item 11) but not before the guest has seen the first one`);
  if (samples.live !== "off") failures.push(`/ the rotator's live region is "${samples.live}" while it auto-advances — a timer that announces itself every seven seconds interrupts the reader`);
  if (samples.dots !== samples.slides || samples.selected !== 1) failures.push(`/ the rotator has ${samples.dots} dots for ${samples.slides} samples and ${samples.selected} selected — the dot row is the map of what exists`);
  if (samples.links !== samples.slides || !samples.rel) failures.push(`/ ${samples.links} of ${samples.slides} samples link out to their source, and cross-origin safety reads ${samples.rel} — a quoted review without a way to read it is an accusation`);
  if (samples.quoted < 3) failures.push(`/ the rotator quotes ${samples.quoted} block(s) — the third-party clips are verbatim and must not arrive rewritten as prose`);
  if (!samples.hasCounts) failures.push("/ the counted themes are not stating their panel and depth (\"of the 541 Google Maps reviews\") — a theme with no denominator is a mood, not a finding");
}

// Does it actually shift on its own? The owner's words were "shifting after sometime", so the claim is
// timed against the component's own window rather than eyeballed.
const shift = await evaluate(`
    const rs = document.querySelector("[data-rs]");
    const before = Number(rs.getAttribute("data-rs-index"));
    await new Promise((r) => setTimeout(r, 8600));
    const after = Number(rs.getAttribute("data-rs-index"));
    return { before, after, state: rs.getAttribute("data-rs-state") };
  `);
const shiftLogged = drain();
results.push({ path: "/ (review samples shift)", value: shift, errors: shiftLogged.errors, warnings: shiftLogged.warnings });
if (!samples.missing && shift.after === shift.before) {
  failures.push(`/ the review sample was still index ${shift.before} after 8.6 seconds — the owner asked for the samples to move by themselves, and the timer is the answer to that`);
}

// Every control, pressed.
const controls = await evaluate(`
    const q = (s) => document.querySelector(s);
    const rs = q("[data-rs]");
    const play = q("[data-rs-play]");
    const slides = rs.querySelectorAll("[data-rs-slide]").length;
    const at = Number(rs.getAttribute("data-rs-index"));
    play.click();
    const pausedAt = Number(rs.getAttribute("data-rs-index"));
    const state = rs.getAttribute("data-rs-state");
    const pressed = play.getAttribute("aria-pressed");
    const live = rs.querySelector(".rs__stage").getAttribute("aria-live");
    const label = play.textContent.trim();
    await new Promise((r) => setTimeout(r, 8600));
    const heldAt = Number(rs.getAttribute("data-rs-index"));
    q("[data-rs-next]").click();
    const stepped = Number(rs.getAttribute("data-rs-index"));
    q("[data-rs-dot]").click();
    const jumped = Number(rs.getAttribute("data-rs-index"));
    const onCount = rs.querySelectorAll(".rs__slide.is-on").length;
    const inertNow = [...rs.querySelectorAll("[data-rs-slide]")].filter((s) => !s.classList.contains("is-on") && !s.hasAttribute("inert")).length;
    play.click();
    return {
      at, pausedAt, state, pressed, live, label, heldAt, stepped, jumped, onCount, inertNow,
      resumed: rs.getAttribute("data-rs-state"),
      pressedAfter: play.getAttribute("aria-pressed"),
      slides,
    };
  `);
const controlsLogged = drain();
results.push({ path: "/ (review sample controls)", value: controls, errors: controlsLogged.errors, warnings: controlsLogged.warnings });
if (!samples.missing) {
  if (controls.state !== "paused" || controls.pressed !== "true") failures.push(`/ pressing Stop left the rotator ${JSON.stringify(controls.state)} with aria-pressed ${JSON.stringify(controls.pressed)} — the button is not reporting what it did`);
  if (!/Resume/.test(controls.label)) failures.push(`/ the Stop button reads "${controls.label}" while paused — a reader cannot tell what pressing it again does`);
  if (controls.live !== "polite") failures.push(`/ a paused rotator has aria-live "${controls.live}" — when a person is driving the samples, their screen reader has to follow`);
  if (controls.heldAt !== controls.pausedAt) failures.push(`/ the samples kept advancing while stopped (${controls.pausedAt} → ${controls.heldAt}) — "pause" is a decoration, which is the standing rule this site is built to`);
  if (controls.stepped !== (controls.pausedAt + 1) % controls.slides) failures.push(`/ Next went ${controls.pausedAt} → ${controls.stepped}, not +1 mod ${controls.slides}`);
  if (controls.jumped !== 0) failures.push(`/ the first dot jumped to sample ${controls.jumped} — the dots are a map, and a wrong map is worse than none`);
  if (controls.onCount !== 1) failures.push(`${controls.onCount} samples marked as shown after using the controls — the swap is leaving two on screen`);
  if (controls.inertNow !== 0) failures.push(`${controls.inertNow} sample(s) are hidden but not inert after the controls were used — a keyboard would land in a quotation nobody is reading`);
  if (controls.resumed !== "playing" || controls.pressedAfter !== "false") failures.push(`/ releasing Stop left the rotator ${JSON.stringify(controls.resumed)} / aria-pressed ${JSON.stringify(controls.pressedAfter)}`);
}

// The ticker: one CSS animation, and the controls must act on that same animation rather than on a
// second loop of our own.
const line = await evaluate(`
    const q = (s) => document.querySelector(s);
    const root = q("[data-ticker-root]");
    if (!root) return { missing: true };
    const track = q("[data-ticker]");
    const btn = q("[data-ticker-play]");
    const anim = () => track.getAnimations()[0];
    const mod = (n, m) => ((n % m) + m) % m;
    const out = {};
    out.buttonHiddenAtLoad = btn.hidden;
    out.stateAtLoad = root.getAttribute("data-ticker-state");
    out.playStateAtLoad = anim().playState;
    const cycle = Number(anim().effect.getComputedTiming().duration);
    out.cycle = cycle;
    out.halfWidth = Math.round(track.scrollWidth / 2);
    out.items = track.querySelectorAll('.ticker__item:not([aria-hidden="true"])').length;
    out.hasPrice = /KSh /.test(track.textContent);
    out.hasEmoji = /\\p{Extended_Pictographic}/u.test(track.textContent);
    out.hasQuote = /\\u201c/.test(track.textContent);
    out.text = track.textContent.replace(/\\s+/g, " ").trim().slice(0, 96);

    btn.click();
    out.stopState = root.getAttribute("data-ticker-state");
    out.stopPressed = btn.getAttribute("aria-pressed");
    out.stopPlayState = anim().playState;
    const tStop = Number(anim().currentTime);
    await new Promise((r) => setTimeout(r, 1200));
    out.driftWhileStopped = Math.round(Number(anim().currentTime) - tStop);
    btn.click();
    out.runPlayState = anim().playState;

    root.focus();
    out.focusIsRoot = document.activeElement === root;
    const tKey = Number(anim().currentTime);
    root.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    out.keyMoved = Math.round(Number(anim().currentTime)) !== Math.round(tKey);
    out.keyPaused = anim().playState;
    out.keyPressed = btn.getAttribute("aria-pressed");
    btn.click();
    await new Promise((r) => setTimeout(r, 150));

    const rect = root.getBoundingClientRect();
    const y = Math.round(rect.top + rect.height / 2);
    const x0 = Math.round(rect.left + 240);
    const send = (type, x) => root.dispatchEvent(new PointerEvent(type, {
      bubbles: true, cancelable: true, pointerId: 1, pointerType: "mouse", isPrimary: true, clientX: x, clientY: y,
    }));
    send("pointerdown", x0);
    out.holdState = root.getAttribute("data-ticker-state");
    out.holdPlayState = anim().playState;
    const t0 = Number(anim().currentTime);
    send("pointermove", x0 + 120);
    out.seeked = Number(anim().currentTime);
    out.seekError = Math.abs(out.seeked - mod(t0 - (120 / out.halfWidth) * cycle, cycle));
    out.shiftAttr = root.getAttribute("data-ticker-shift");
    send("pointerup", x0 + 120);
    out.releaseState = root.getAttribute("data-ticker-state");
    out.releasePlayState = anim().playState;
    out.holdAttrCleared = !root.hasAttribute("data-ticker-hold");
    const tAfter = Number(anim().currentTime);
    await new Promise((r) => setTimeout(r, 500));
    out.movedAfterRelease = Number(anim().currentTime) !== tAfter;
    return out;
  `);
const lineLogged = drain();
results.push({ path: "/ (the moving line)", value: line, errors: lineLogged.errors, warnings: lineLogged.warnings });
if (line.missing) {
  failures.push("/ has no [data-ticker-root] — the ticker the owner asked to be able to stop is gone");
} else {
  if (line.buttonHiddenAtLoad) failures.push("/ the ticker's Stop button is still hidden with a running animation — the control exists but the reader cannot see it");
  if (line.stateAtLoad !== "playing" || line.playStateAtLoad !== "running") failures.push(`/ the ticker loaded ${JSON.stringify(line.stateAtLoad)} / ${JSON.stringify(line.playStateAtLoad)} — with motion allowed and nothing touching it, it moves`);
  if (line.items < 12) failures.push(`/ the ticker walks ${line.items} facts; it used to walk ten captions and the owner called it dry — the factual surface is now most of the line`);
  if (!line.hasPrice || !line.hasEmoji || !line.hasQuote) failures.push(`/ the line is missing its content claims (price ${line.hasPrice}, emoji ${line.hasEmoji}, quoted caption ${line.hasQuote}): "${line.text}"`);
  if (line.stopPlayState !== "paused" || line.stopPressed !== "true" || line.stopState !== "paused") failures.push(`/ pressing Stop left the animation ${JSON.stringify(line.stopPlayState)} and the button aria-pressed ${JSON.stringify(line.stopPressed)} — WCAG 2.2.2 wants a real pause on content that moves for more than five seconds`);
  if (line.driftWhileStopped !== 0) failures.push(`/ the ticker drifted ${line.driftWhileStopped}ms of animation time while stopped — pause has to mean stopped`);
  if (line.runPlayState !== "running") failures.push(`/ releasing Stop returned the animation to ${JSON.stringify(line.runPlayState)}`);
  if (!line.focusIsRoot) failures.push("/ the ticker is not focusable as a region — the arrow-key path the hint promises does not exist");
  if (!line.keyMoved || line.keyPaused !== "paused") failures.push(`/ an arrow key moved the line ${line.keyMoved} and left it ${JSON.stringify(line.keyPaused)} — a reader stepping through text does not want it running underneath`);
  if (line.holdPlayState !== "paused" || line.holdState !== "paused") failures.push(`/ holding the line left it at ${JSON.stringify(line.holdPlayState)} — "hold it to pause" is item 12 verbatim`);
  if (line.seekError > 2) failures.push(`/ dragging 120px right seeked the animation ${line.seekError.toFixed(1)}ms off the arithmetic (${line.shiftAttr}px reported) — the text would not track the finger`);
  if (line.releasePlayState !== "running" || !line.holdAttrCleared) failures.push(`/ letting go left the line ${JSON.stringify(line.releasePlayState)} with the hold flag ${line.holdAttrCleared ? "cleared" : "still set"} — a scrub should hand the line back`);
  if (!line.movedAfterRelease) failures.push("/ the line did not resume moving after the drag was released — it is parked where the reader left it, which is a stop, not a scrub");
}

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

  // "Sticky" is a behaviour, and everything above can pass on a bar that scrolls away with the document. The
  // dock is `position: fixed` under 720px (ActionDock.astro), so the honest claim is that it is in the viewport
  // at every depth — a guest who has walked down to the biryani should not have to climb back for the two
  // actions this site is a pitch about. Sampled at three depths rather than one, because the interesting failure
  // is the middle of a long page.
  const depths = await evaluate(`
    const bar = document.querySelector("[data-dock]");
    if (!bar) return { missing: true };
    const doc = document.documentElement;
    const out = [];
    for (const frac of [0, 0.5, 0.95]) {
      scrollTo({ top: Math.max(0, (doc.scrollHeight - innerHeight) * frac), behavior: "instant" });
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const r = bar.getBoundingClientRect();
      out.push({ frac, top: Math.round(r.top), bottom: Math.round(r.bottom), vh: innerHeight, inView: r.height > 0 && r.top >= 0 && r.bottom <= innerHeight + 1 });
    }
    scrollTo({ top: 0, behavior: "instant" });
    return out;
  `);
  results.push({ path: `phone ${route} dock`, value: depths, errors: drain().errors, warnings: [] });
  if (depths?.missing) failures.push(`${route}: the dock disappeared between the two reads — nothing to sample at depth`);
  else {
    const lost = (depths ?? []).filter((d) => !d.inView);
    if (lost.length)
      failures.push(`${route}: at ${lost.map((d) => `${Math.round(d.frac * 100)}% scrolled (${d.top}–${d.bottom} of a ${d.vh}px viewport)`).join(", ")} the dock is not on screen — the sticky Order/Book controls do not follow the guest, which is the whole reason they exist`);
  }
}
await inPage("Emulation.clearDeviceMetricsOverride", {});

// ---- the book's answer, arm by arm, in a browser
/*
   Both submit handlers have five exits — recorded, invalid, busy, unreachable, and a server that answered
   without recording — and until now a browser had never taken a single one of them. The unit suites in
   tests/run.mjs pin `outcome()` and `firstBadControl()` as pure functions, and A13–A16 pin what the deployed
   Worker actually replies with; neither of those is the claim this section makes, which is that the page in
   front of a guest turns one into the right sentence, the right cursor, the right handoff link and an
   enabled button.

   `window.fetch` is replaced with a planned queue, not pointed at the deployment. That is deliberate twice
   over. A passing 201 arm writes a row into D1, and this file runs on every push, so the live book would
   fill with test bookings and a real floor manager would read them as guests. And the arms a live Worker
   will agree to answer are only the ones it happens to accept today: a 422 for a party of 2, a 429 on
   someone else's timing, a priceDrift that only appears if the two price lists disagree. The refusals are
   the interesting arms, and they cannot be summoned on demand from production. What the production replies
   actually are stays measured in A13–A16; this section is about the page's reading of them.

   `submitRequest` takes `post` as a default parameter bound at call time (`{ post = globalThis.fetch }`), so
   replacing `window.fetch` before `requestSubmit()` is the seam the shipped code already exposes rather than
   a patch into it.
*/
const GUEST = { name: "Amani Wanjiru", phone: "+254 712 345 678", notes: "A quiet corner if there is one" };

const armSetup = (formSel, plan) =>
  evaluate(`
    const state = { plan: ${JSON.stringify(plan.map((arm) => ({ status: arm.status, body: arm.body, network: !!arm.network })))}, sent: [], thrown: [] };
    window.__hhArms = state;
    window.addEventListener("unhandledrejection", (event) => state.thrown.push(String(event.reason?.message ?? event.reason)));
    window.fetch = async (input, init) => {
      const arm = state.plan.shift();
      state.sent.push({
        url: typeof input === "string" ? input : (input && input.url) || String(input),
        method: (init && init.method) || (input && input.method) || "GET",
        json: init && typeof init.body === "string" ? JSON.parse(init.body) : null,
      });
      if (!arm) throw new TypeError("the arm plan ran out — the page sent a request nobody planned for");
      if (arm.network) throw new TypeError("Failed to fetch");
      return new Response(JSON.stringify(arm.body), { status: arm.status, headers: { "content-type": "application/json" } });
    };
    const sel = ${JSON.stringify(formSel)};
    const form = document.querySelector(sel);
    if (!form) throw new Error("arm battery: no " + sel + " in the document at " + location.pathname + location.search + " — this battery is reading the wrong page");
    // A form the CSS has hidden cannot be focused into, and the html.js class is what makes these forms exist
    // at all, so the precondition is stated here rather than assumed: measured, and reported if the page is
    // not the JavaScript page. (No backticks are allowed inside one of these bodies — they end the template.)
    return { api: form?.dataset.api ?? null, wa: form?.dataset.wa ?? null, visible: !!form && getComputedStyle(form).display !== "none", controls: form ? [...form.elements].filter((e) => e.name).map((e) => e.name) : [] };
  `);

const armFill = (formSel, values) =>
  evaluate(`
    const sel = ${JSON.stringify(formSel)};
    const form = document.querySelector(sel);
    if (!form) throw new Error("arm battery: no " + sel + " in the document at " + location.pathname + location.search + " — this battery is reading the wrong page");
    for (const [name, value] of Object.entries(${JSON.stringify(values)})) {
      const el = form.elements[name];
      if (!el) continue;
      el.value = value;
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    }
    return [...form.elements]
      .filter((el) => el.willValidate && !el.checkValidity())
      .map((el) => el.name + ": " + el.validationMessage);
  `);

// One submit, read back as a guest would notice it: the sentence in the live region, where the cursor went,
// what the handoff link now carries, whether the sheet survived, whether the button can be pressed again.
//
// `wait` is false for the refusals that never leave the handler: the empty-sheet guard returns before it
// touches the button, which is the correct behaviour, so waiting for it to re-enable would burn the whole
// 8-second deadline and then report a working page as broken.
const armSubmit = (formSel, { wait = true } = {}) =>
  evaluate(`
    const sel = ${JSON.stringify(formSel)};
    const form = document.querySelector(sel);
    if (!form) throw new Error("arm battery: no " + sel + " in the document at " + location.pathname + location.search + " — this battery is reading the wrong page");
    const live = form.querySelector("[data-outcome], [data-record-state]");
    const send = form.querySelector("[data-send], [data-record-send]");
    const handoff = form.querySelector("[data-handoff]");
    const rows = () => document.querySelectorAll("[data-inc]").length;
    const before = { state: live.textContent, href: handoff?.getAttribute("href") ?? null, rows: rows(), sent: window.__hhArms.sent.length };
    form.requestSubmit();
    if (${wait}) {
      const until = performance.now() + 8000;
      await new Promise((resolve) => {
        const step = () => {
          if (!send.disabled) resolve();
          else if (performance.now() > until) resolve();
          else requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
      });
    }
    return {
      state: live.textContent.trim(),
      changed: live.textContent !== before.state,
      sendEnabled: !send.disabled,
      focused: document.activeElement ? document.activeElement.name || document.activeElement.id || document.activeElement.tagName : null,
      href: handoff?.getAttribute("href") ?? null,
      hrefChanged: handoff ? handoff.getAttribute("href") !== before.href : null,
      rows: [before.rows, rows()],
      request: window.__hhArms.sent.slice(-1)[0] ?? null,
      sentCount: window.__hhArms.sent.length,
      newRequests: window.__hhArms.sent.length - before.sent,
      thrown: window.__hhArms.thrown.slice(),
      waited: window.__hhArms.plan.length,
    };
  `);

async function armRows(route, formSel, plan, { values, seed } = {}) {
  await goto(route);
  // The sheet is the thing a table request is about, so an empty one has to be filled the way a guest fills
  // it — the same [data-add] press the M4 battery uses, not a localStorage write.
  const seeded = seed ? await evaluate(seed) : null;
  const setup = await armSetup(formSel, plan);
  const invalid = values ? await armFill(formSel, values) : [];
  const by = {};
  if (setup.visible !== true) failures.push(`${route}: ${formSel} is not displayed under html.js — the arms below cannot be read as what a guest sees`);
  if (invalid.length) failures.push(`${route}: the typed form is not valid before any submit (${invalid.join("; ")}) — the handler never runs and every arm is measuring nothing`);
  if (!setup.api) failures.push(`${route}: ${formSel} has an empty data-api, so submitRequest would answer "unreachable" without a network call and the arms would prove nothing`);
  let index = 0;
  for (const arm of plan) {
    index += 1;
    if (arm.pre) await evaluate(arm.pre);
    const read = await armSubmit(formSel, { wait: !arm.noRequest });
    const logged = drain();
    by[arm.name] = { ...read, pre: arm.pre ? true : false, console: logged.errors };
    results.push({
      path: `${route} ${arm.name}`,
      value: { state: read.state, focused: read.focused, sendEnabled: read.sendEnabled, href: read.href?.slice(0, 160), rows: read.rows, sent: read.request ? { method: read.request.method, url: read.request.url, json: read.request.json } : null, thrown: read.thrown },
      errors: logged.errors,
      warnings: logged.warnings,
    });
    // Five invariants that belong to every exit the handler has, checked here so no future arm can quietly
    // leave the guest staring at a dead button or an uncaught error.
    if (!read.changed) failures.push(`${route} ${arm.name}: the live region still reads "${read.state}" — the submit produced no sentence at all`);
    if (read.thrown.length) failures.push(`${route} ${arm.name}: the handler threw (${read.thrown.join("; ")}) instead of saying something`);
    if (logged.errors.length) failures.push(`${route} ${arm.name}: the arm put ${logged.errors.length} console error(s) on the page (${logged.errors.join(" | ")})`);
    if (arm.noRequest) {
      if (read.newRequests) failures.push(`${route} ${arm.name}: the page called the book ${read.newRequests} time(s) when it should have refused to send`);
      // A guard is not a response. The button has to still be sitting disabled: a live Record over an empty
      // sheet is an invitation to press it again into the same nothing, which is the bug this arm exists to
      // keep from coming back.
      if (read.sendEnabled) failures.push(`${route} ${arm.name}: the page refused to send and left the button enabled — the guest can press it again into an empty sheet`);
    } else {
      if (!read.sendEnabled) failures.push(`${route} ${arm.name}: the send button is still disabled — the guest cannot retry without reloading`);
      if (!read.request) {
        failures.push(`${route} ${arm.name}: fetch was never called — nothing went to the book`);
      } else {
        if (read.request.method !== "POST") failures.push(`${route} ${arm.name}: the request is ${read.request.method}, not POST`);
        if (!/\/v1\/requests$/.test(read.request.url)) failures.push(`${route} ${arm.name}: the request went to ${read.request.url}, not the /v1/requests route`);
      }
    }
    if (!arm.noRequest && read.waited !== plan.length - index)
      failures.push(`${route} ${arm.name}: ${read.waited} arms still queued after this one, expected ${plan.length - index} — the page sent more than one request`);
    for (const phrase of arm.expect ?? []) if (!read.state.includes(phrase)) failures.push(`${route} ${arm.name}: the live region reads “${read.state}” and not “…${phrase}…”`);
    for (const phrase of arm.reject ?? []) if (read.state.includes(phrase)) failures.push(`${route} ${arm.name}: the live region says “${phrase}” when it should not`);
  }
  return { by, setup, seeded };

}

const visitArms = [
  {
    name: "recorded",
    status: 201,
    body: { ok: true, reference: "HH-ARMVIS1", kind: "reservation", totalKes: 0, priceDrift: null },
    expect: ["Recorded as HH-ARMVIS1", "is still who decides"],
  },
  {
    name: "invalid",
    status: 422,
    body: {
      code: "invalid",
      message: "Some of that needs fixing.",
      errors: [
        { field: "party", code: "bad_party", message: "A party is a whole number from 1 to 30." },
        { field: "contact.phone", code: "bad_number", message: "Use a Kenyan mobile number, like 0712 345 678 or +254 712 345 678." },
      ],
    },
    expect: ["A party is a whole number from 1 to 30", "Use a Kenyan mobile number"],
  },
  // The field name the deployed Worker was measured answering with (A15). Interpolating it into a CSS
  // selector was the bug; this arm is the regression, executed rather than described.
  {
    name: "indexed-field",
    status: 422,
    body: { code: "invalid", errors: [{ field: "lines[0]", code: "shape", message: "Each line needs an item id and a quantity." }] },
    expect: ["Each line needs an item id and a quantity."],
  },
  {
    name: "busy",
    status: 429,
    body: { code: "slow_down", message: "Too many at once.", retry_after_seconds: 20 },
    expect: ["Try again in 20 seconds"],
  },
  { name: "unreachable", network: true, expect: ["could not be reached", "carries everything you typed"], reject: ["The book answered"] },
  {
    name: "server-failure",
    status: 500,
    body: { code: "not_recorded", message: "Nothing was saved. Try again, or send it on WhatsApp." },
    // The book was reached and refused to write. Until this arm ran, the page called that "could not be
    // reached", which told the guest something the network never confirmed — and dropped the server's own
    // sentence, the one thing they could act on. Both halves are now required, and the conflation is forbidden.
    expect: ["The book answered, but it did not record this", "no reference was issued", "It said: Nothing was saved"],
    reject: ["could not be reached", "Recorded as"],
  },
  {
    // The Worker has a second 500 — `server_error` at backend/src/index.mjs:120 — with different words. This arm
    // exists to prove the page is quoting the book and not reciting a sentence it wrote for one occasion: the
    // previous arm's message must be absent here, and this one's must be present.
    name: "server-error",
    status: 500,
    body: { code: "server_error", message: "Something broke on our side. Nothing was recorded — try again, or send it on WhatsApp." },
    expect: ["The book answered, but it did not record this", "It said: Something broke on our side"],
    reject: ["could not be reached", "It said: Nothing was saved"],
  },
];

const tableArms = [
  {
    name: "recorded-with-drift",
    status: 201,
    body: { ok: true, reference: "HH-ARMTAB1", totalKes: 3100, priceDrift: { claimedKes: 2800, serverKes: 3100, deltaKes: 300 } },
    expect: ["Recorded as HH-ARMTAB1", "KSh 3,100", "KSh 300 more than this sheet said", "gap is on the record with you"],
  },
  {
    name: "recorded-matching",
    status: 201,
    body: { ok: true, reference: "HH-ARMTAB2", totalKes: 3100, priceDrift: { claimedKes: 3100, serverKes: 3100, deltaKes: 0 } },
    expect: ["Recorded as HH-ARMTAB2 — KSh 3,100, the same figure this sheet shows"],
    reject: ["more than this sheet said", "less than this sheet said"],
  },
  {
    name: "recorded-no-comparison",
    status: 201,
    body: { ok: true, reference: "HH-ARMTAB3", totalKes: 3100, priceDrift: null },
    expect: ["Recorded as HH-ARMTAB3"],
    reject: ["the same figure", "price list makes it"],
  },
  {
    name: "indexed-field",
    status: 422,
    body: {
      code: "invalid",
      errors: [
        { field: "lines[0].qty", code: "bad_qty", message: "Quantity has to be a whole number from 1 to 99." },
        { field: "contact.name", code: "too_short", message: "At least 2 characters." },
      ],
    },
    expect: ["Quantity has to be a whole number from 1 to 99", "At least 2 characters"],
  },
  {
    name: "busy",
    status: 429,
    body: { code: "slow_down", message: "You just sent one of these.", retry_after_seconds: 20 },
    expect: ["Give it 20 seconds and press Record again", "the sheet is still here"],
  },
  { name: "unreachable", network: true, expect: ["nothing was recorded and no reference was issued"], reject: ["The book answered"] },
  {
    name: "server-failure",
    status: 500,
    body: { code: "not_recorded", message: "Nothing was saved. Try again, or send it on WhatsApp." },
    // Same rule as /visit, tested here because /table has more to lose: the sheet is on screen with dishes and
    // an estimate, and a guest who is told "could not be reached" when the book actually answered will press
    // again without knowing the refusal was the book's, not the network's.
    expect: ["The book answered, but it did not record this sheet", "It said: Nothing was saved", "press Record again"],
    reject: ["could not be reached", "Recorded as"],
  },
  {
    name: "server-error",
    status: 500,
    body: { code: "server_error", message: "Something broke on our side. Nothing was recorded — try again, or send it on WhatsApp." },
    // Same proof on the sheet: the sentence must carry this arm's words, not the previous arm's.
    expect: ["The book answered, but it did not record this sheet", "It said: Something broke on our side"],
    reject: ["could not be reached", "It said: Nothing was saved"],
  },
  {
    name: "empty-sheet",
    pre: `
      const clear = document.querySelector("[data-clear]");
      if (clear) clear.click();
      await new Promise((resolve) => setTimeout(resolve, 250));
      return document.querySelectorAll("[data-inc]").length;
    `,
    noRequest: true,
    expect: ["There is nothing on the sheet to record"],
  },
];

const seedSheet = `
  const all = (s) => [...document.querySelectorAll(s)];
  for (const button of all("[data-add]").slice(0, 2)) { button.click(); await new Promise((resolve) => setTimeout(resolve, 180)); }
  return { rows: all("[data-inc]").length, total: document.querySelector("[data-total]")?.textContent.trim() ?? null, storage: localStorage.getItem("habibi-haven:table:v1") };
`;

const visitBook = await armRows("/visit", "[data-request-form]", visitArms, { values: { ...GUEST } });

// Read the fields while the /visit document is still the page, and check it here rather than in the shared
// tail below. Both of those were wrong before: the tail runs after the /table navigation, so the query for
// `[data-request-form]` returned null and the read threw `Cannot read properties of null (reading
// 'elements')` — a harness defect, not a site defect, and it cost a CI cycle plus the report for all
// thirteen arms. The distance from the page it belongs to is why the check now sits beside the battery.
const visitKept = await evaluate(`
  const form = document.querySelector("[data-request-form]");
  if (!form) return { missing: location.pathname + location.search };
  return { name: form.elements.name.value, phone: form.elements.phone.value, notes: form.elements.notes.value };
`);
if (visitKept.missing)
  failures.push(`/visit: [data-request-form] is not in the document at ${visitKept.missing} — the arms above were reading a page that had already left /visit`);
else if (visitKept.name !== GUEST.name || visitKept.phone !== GUEST.phone || visitKept.notes !== GUEST.notes)
  failures.push(`/visit did not leave the typed request in the fields (${JSON.stringify(visitKept)}) — a guest on bad Wi-Fi would retype their name, number and note`);

const tableBook = await armRows("/table", "[data-record-form]", tableArms, { values: { name: GUEST.name, phone: GUEST.phone }, seed: seedSheet });

// What the arms above cannot tell from their own sentences: whether the body that left the page is the body
// the Worker's validate.mjs says it needs. These are the shape rules lib/request-client.mjs claims to have
// inherited, checked against the bytes a real browser actually serialised.
const visitSent = visitArms.filter((arm) => !arm.noRequest).map((arm) => visitBook.by[arm.name].request.json);
if (visitSent.some((json) => json?.kind !== "reservation")) failures.push(`/visit sent kind ${JSON.stringify(visitSent[0]?.kind)}, not "reservation" — the Worker 422s on kind before anything else`);
if (visitSent.some((json) => typeof json?.contact?.name !== "string" || typeof json?.contact?.phone !== "string"))
  failures.push(`/visit sent a flat contact instead of the nested pair (${JSON.stringify(visitSent[0]?.contact)}) — flattening it is two required errors and a guest with no way to fix them`);
if (visitSent.some((json) => !/^\d{4}-\d{2}-\d{2}$/.test(json?.visitDate ?? "") || !/^\d{2}:\d{2}$/.test(json?.visitTime ?? "")))
  failures.push(`/visit sent visitDate/visitTime that are not the machine-checked pair (${visitSent[0]?.visitDate} ${visitSent[0]?.visitTime})`);
if (visitSent.some((json) => !Number.isInteger(json?.party))) failures.push(`/visit sent party as ${JSON.stringify(visitSent[0]?.party)} — the schema wants a number, not the string FormData hands back`);
// The pair the Worker reads is the one the guest picked, and `when` is the free-text label it stores
// unpolicied — a time in `when` and nothing in the pair is how a booking loses its hour.
if (visitSent.some((json) => json?.when)) failures.push(`/visit put a label in when (${JSON.stringify(visitSent[0]?.when)}) while the machine pair should be carrying the hour`);
// `source` is measured as the path it names, not as https: this harness serves the site over http, and the
// schema's https rule belongs to the deployment (Pages only ever answers https), so what is testable here is
// that the page sends the page it is on.
if (visitSent.some((json) => !/\/visit$/.test(json?.source ?? ""))) failures.push(`/visit sent source ${JSON.stringify(visitSent[0]?.source)} — the record should say where it came from`);
if (visitBook.by.recorded.href?.includes("text=")) failures.push("/visit recorded arm left the handoff carrying a message — the guest has a reference now, and a second copy of the request would be a duplicate booking");
if (!visitBook.by.recorded.state.includes(`+${visitBook.setup.wa}`))
  failures.push(`/visit recorded without naming the number that decides: “${visitBook.by.recorded.state}” (data-wa is ${visitBook.setup.wa})`);
if (visitBook.by.invalid.focused !== "party") failures.push(`/visit 422 put the cursor on ${visitBook.by.invalid.focused}, not on the party field the Worker named first`);
if (visitBook.by["indexed-field"].focused === "lines[0]") failures.push("/visit tried to focus a field that has no control — the A15 defect is back");
if (visitBook.by.busy.state.includes("could not be reached")) failures.push("/visit read a 429 as an unreachable book — the request is queued, not lost");
if (visitBook.by.unreachable.href?.includes("text=") !== true)
  failures.push("/visit could not be reached and still the WhatsApp button carries no message — the typed request vanished with the network");
else if (!decodeURIComponent(visitBook.by.unreachable.href).includes(GUEST.phone))
  failures.push("/visit armed the handoff with a message that does not contain the guest's number — the restaurant could not call back");
// The guest's words surviving a failure that is not their fault is checked beside the /visit battery, where
// the document still is /visit.

const sheetSent = tableArms.filter((arm) => !arm.noRequest).map((arm) => tableBook.by[arm.name].request.json);
if (sheetSent.some((json) => json?.kind !== "table")) failures.push(`/table sent a kind that is not "table" (${JSON.stringify(sheetSent[0]?.kind)})`);
if (sheetSent.some((json) => !Array.isArray(json?.lines) || json.lines.length === 0)) failures.push("/table sent no lines — the sheet on screen did not travel with the request");
// The whole point of the server repricing: the page may state a claim, never an amount.
const lineKeys = sheetSent.flatMap((json) => json?.lines ?? []).map((line) => Object.keys(line).sort().join(","));
if (lineKeys.some((keys) => keys !== "id,qty" && keys !== "id,option,qty")) failures.push(`/table sent line fields beyond id/option/qty (${[...new Set(lineKeys)].join(" | ")}) — a price written by the page is a bill the kitchen never agreed to`);
if (sheetSent.some((json) => !Number.isInteger(json?.claimedSubtotal) || json.claimedSubtotal <= 0))
  failures.push(`/table claimed a subtotal that is not a whole number (${JSON.stringify(sheetSent[0]?.claimedSubtotal)}) — the drift check compares the guest's own figure, so it has to be theirs exactly`);
if (!/\/table$/.test(sheetSent[0]?.source ?? "")) failures.push(`/table sent source ${JSON.stringify(sheetSent[0]?.source)}`);
if (tableBook.by["recorded-with-drift"].state.includes("KSh 2,800")) failures.push("/table quoted the guest's own figure back at them as the price — the server's number is the one on the record");
if (tableBook.by["indexed-field"].focused !== "name") failures.push(`/table 422 put the cursor on ${tableBook.by["indexed-field"].focused} — it should skip the line complaint that has no control and land on the name the Worker also named`);
if (tableBook.by["recorded-with-drift"].rows[1] === 0) failures.push("/table wiped the sheet after recording it — the guest loses the thing they just sent");
if (tableBook.by["unreachable"].href?.includes("text=") !== true) failures.push("/table handoff carries no message even though the sheet is on screen — the dishes never reached the link");
else if (tableBook.by["unreachable"].hrefChanged) failures.push("/table rebuilt the handoff only on a failed submit — the render pass keeps it current, so the link should already have been right");
if (tableBook.by["empty-sheet"].rows[1] !== 0) failures.push("/table did not clear the sheet before the refusal arm — that arm tested the guard with dishes still on it");
if (tableBook.by["empty-sheet"].state.includes("could not be reached")) failures.push("/table called a blank sheet a network failure — nothing was wrong with the connection");


// Leave the browser's storage as it was found: a test booking in localStorage is how a later battery starts
// with a sheet nobody built.
await evaluate(`
  const keys = Object.keys(localStorage).filter((k) => k.startsWith("habibi-haven:"));
  for (const key of keys) localStorage.removeItem(key);
  return keys;
`);

// ---- the two sheet controls no browser had pressed: the house set and the row cap
//
// `LINES_MAX` is the number `backend/src/validate.mjs` refuses above with a 422, and TableBuilder disables its
// own button and writes a hint about it — but nothing had ever put a sheet over that line in a page, so the two
// sentences it writes about the cap (the hint under the button, the guard inside the submit handler) had never
// been compared with each other, let alone read by a guest. Same for "Put the whole house set on the table":
// one press that writes a line per dish the page itself offers, gated by nothing. Both are built here the way a
// guest builds them — presses on `[data-add]`, no localStorage writes — because the state under test is what the
// controls produce, and a sheet assembled by hand would prove the guard works on a state nobody can reach.
//
// The cap is imported rather than typed: the number the harness enforces has to be the number the site states,
// or this becomes a fifth copy of a rule that already lives in four places (see PARTY_MIN in table.mjs).
const houseRead = await (async () => {
  await goto("/table");
  return evaluate(`
    const all = (s) => [...document.querySelectorAll(s)];
    const text = (s) => document.querySelector(s)?.textContent.trim() ?? null;
    const button = document.querySelector("[data-add-all]");
    if (!button) return { missing: true };
    const before = all("[data-inc]").length;
    const offers = all("[data-add]").length;
    button.click();
    await new Promise((resolve) => setTimeout(resolve, 450));
    const stored = JSON.parse(localStorage.getItem("habibi-haven:table:v1") ?? "{}");
    const wa = document.querySelector("[data-whatsapp]");
    return {
      before,
      offers,
      after: all("[data-inc]").length,
      lines: Array.isArray(stored.lines) ? stored.lines.length : null,
      total: text("[data-total]"),
      sendDisabled: document.querySelector("[data-record-send]")?.disabled ?? null,
      hint: text("[data-record-hint]"),
      waDisabled: wa ? wa.getAttribute("aria-disabled") === "true" : null,
    };
  `);
})();
{
  const logged = drain();
  results.push({ path: "/table house-set", value: houseRead, errors: logged.errors, warnings: logged.warnings });
  if (houseRead.missing) failures.push("/table: there is no [data-add-all] control — the whole-house-set button this page advertises is not in the document");
  else {
    if (houseRead.before !== 0) failures.push(`/table: the house-set press started from ${houseRead.before} line(s), not an empty sheet — the counts below measure a sheet that was already written`);
    if (houseRead.after !== houseRead.offers) failures.push(`/table: one press of the house set wrote ${houseRead.after} row(s) while the page offers ${houseRead.offers} dishes — the button and its own list disagree`);
    if (houseRead.lines !== houseRead.after) failures.push(`/table: the sheet shows ${houseRead.after} rows while the store holds ${houseRead.lines} lines — a reload would change the table the guest is looking at`);
    if (!houseRead.after) failures.push("/table: the house set wrote no rows at all");
    if (houseRead.sendDisabled !== false) failures.push(`/table: the house set filled the sheet and Record is still disabled (${houseRead.sendDisabled}) — the guest cannot record the table the button just built`);
    if (houseRead.waDisabled === true) failures.push("/table: the WhatsApp handoff still says 'add something first' with a full sheet on it — the render did not refresh it");
    if (logged.errors.length) failures.push(`/table house-set: ${logged.errors.length} console error(s) from one press (${logged.errors.join(" | ")})`);
  }
}

// Past the cap: fill from /menu (243 dishes live there, the house set's six do not), then try to record.
await goto("/menu");
const overSeed = await evaluate(`
  const adds = [...document.querySelectorAll("[data-add]")];
  const count = () => {
    const stored = JSON.parse(localStorage.getItem("habibi-haven:table:v1") ?? "{}");
    return Array.isArray(stored.lines) ? stored.lines.length : 0;
  };
  const target = ${LINES_MAX} + 1;
  let clicks = 0;
  for (const button of adds) {
    if (count() >= target) break;
    button.click();
    clicks += 1;
    if (clicks % 10 === 0) await new Promise((resolve) => setTimeout(resolve, 90));
  }
  await new Promise((resolve) => setTimeout(resolve, 250));
  return { clicks, lines: count(), offers: adds.length };
`);
if (overSeed.lines < LINES_MAX + 1)
  failures.push(`/menu: could not build an over-cap sheet (${overSeed.lines} lines from ${overSeed.clicks} presses of ${overSeed.offers} controls) — the cap arm below would be measuring a normal table`);

// Back to the page that owns the record form. The first run of this section omitted the navigation and failed
// with `Cannot read properties of null (reading 'elements')` — the same class A17 had finished describing
// minutes earlier: a read aimed at the document that is not on screen. The helpers now name the selector they
// could not find and the path they were looking at, so the mistake reports itself as a wrong page rather than a
// null.
await goto("/table");
const capSetup = await armSetup("[data-record-form]", []);
const capFill = await armFill("[data-record-form]", { name: GUEST.name, phone: GUEST.phone });
if (capFill.length) failures.push(`/table over-cap: the typed form is not valid before the refusal (${capFill.join("; ")}) — the guard never runs and the arm measures nothing`);
const capRead = await armSubmit("[data-record-form]", { wait: false });
const capHint = await evaluate(`
  const text = (s) => document.querySelector(s)?.textContent.trim() ?? null;
  const wa = document.querySelector("[data-whatsapp]");
  return { hint: text("[data-record-hint]"), state: text("[data-record-state]"), waDisabled: wa ? wa.getAttribute("aria-disabled") === "true" : null };
`);
{
  const logged = drain();
  results.push({
    path: "/table over-cap",
    value: { lines: capRead.rows[0], state: capRead.state, hint: capHint.hint, sendEnabled: capRead.sendEnabled, requests: capRead.newRequests, thrown: capRead.thrown, waDisabled: capHint.waDisabled },
    errors: logged.errors,
    warnings: logged.warnings,
  });
  if (!capSetup.api) failures.push("/table over-cap: data-api is empty, so this refusal cannot be told apart from a page that was never able to send anything");
  if (capSetup.visible !== true) failures.push("/table over-cap: the record form is not displayed under html.js — the refusal below is not a state a guest can reach");
  if (capRead.newRequests) failures.push(`/table over-cap: the page sent ${capRead.newRequests} request(s) for a sheet it knows the book will refuse — the guard is not the button's only job`);
  if (capRead.sendEnabled) failures.push("/table over-cap: Record is enabled over the cap — the guest can press into a 422 the site promised to prevent");
  if (capRead.thrown.length) failures.push(`/table over-cap: the refusal threw (${capRead.thrown.join("; ")}) instead of explaining itself`);
  if (logged.errors.length) failures.push(`/table over-cap: ${logged.errors.length} console error(s) (${logged.errors.join(" | ")})`);
  const capFromGuard = Number((capRead.state.match(/(\d+)\s+different dishes/) ?? [])[1] ?? NaN);
  const capFromHint = Number((capHint.hint?.match(/(\d+)\s+different dishes/) ?? [])[1] ?? NaN);
  if (!Number.isInteger(capFromGuard) || capFromGuard !== LINES_MAX)
    failures.push(`/table over-cap: the submit guard reads "${capRead.state}" and does not name the cap the site actually holds (${LINES_MAX})`);
  if (!Number.isInteger(capFromHint) || capFromHint !== LINES_MAX)
    failures.push(`/table over-cap: the hint under the button reads "${capHint.hint}" and does not name the same cap (${LINES_MAX}) — two sentences, two rules, one guest`);
  if (capFromHint !== capFromGuard) failures.push(`/table over-cap: the hint says ${capFromHint} dishes and the guard says ${capFromGuard} — the page states its own limit twice, differently`);
  if (!capRead.state.includes(`this sheet has ${capRead.rows[0]}`)) failures.push(`/table over-cap: the guard does not name the sheet it is refusing (${capRead.rows[0]} rows → "${capRead.state}")`);
  if (capRead.rows[1] !== capRead.rows[0]) failures.push(`/table over-cap: refusing the sheet changed it (${capRead.rows[0]} → ${capRead.rows[1]} rows) — a refusal must cost the guest nothing`);
  if (capHint.waDisabled === true) failures.push("/table over-cap: the WhatsApp route is disabled over the cap, but the page's own sentence recommends it — a message has no row limit");
}

// Leave the sheet where a guest would find it: nothing recorded, nothing half-written behind us.
await evaluate(`
  const clear = document.querySelector("[data-clear]");
  if (clear) clear.click();
  await new Promise((resolve) => setTimeout(resolve, 250));
  return document.querySelectorAll("[data-inc]").length;
`);

// ---- the When pair's bounds, read out of the forms a guest actually uses
//
// `lastBookableDay()` and `LAST_SITTING_LABEL` have Node tests, which prove the arithmetic and prove nothing
// about the page: a form can hold the right constant and still ship an input with no `max`, which is the state
// that produced the refusals A15 could not point at. So read the attributes the browser enforces on both
// routes, then try to send a date one day past the end and require that nothing leaves the page at all — the
// handler must never run, because native validity stops the submit before the script sees it.
for (const [route, daySel, timeSel] of [["/visit", "#rq-date", "#rq-time"], ["/table", "[data-when-day]", "[data-when-time]"]]) {
  await goto(route);
  const bound = await evaluate(`
    const day = document.querySelector(${JSON.stringify(daySel)});
    if (!day) return { missing: location.pathname + " has no " + ${JSON.stringify(daySel)} };
    const time = document.querySelector(${JSON.stringify(timeSel)});
    const options = time && time.tagName === "SELECT" ? Array.from(time.options).map((o) => o.value) : [];
    return {
      dayMin: day.min || null,
      dayMax: day.max || null,
      dayValue: day.value || null,
      timeMin: time ? time.min || null : null,
      timeMax: time ? time.max || null : null,
      timeStep: time ? time.step || null : null,
      timeValue: time ? time.value || null : null,
      lastOption: options.length ? options[options.length - 1] : null,
      options,
      rangeOverflow: day.validity ? day.validity.rangeOverflow === true : null,
    };
  `);
  const logged = drain();
  results.push({ path: `${route} bounds`, value: bound, errors: logged.errors, warnings: logged.warnings });
  if (bound.missing) { failures.push(`${route}: ${bound.missing}`); continue; }
  const iso = /^\d{4}-\d{2}-\d{2}$/;
  if (!iso.test(bound.dayMax ?? "")) failures.push(`${route}: the date input has no upper bound (max is ${JSON.stringify(bound.dayMax)}) — a guest can pick a year the book refuses as visitDate, a name no control answers to`);
  if (!iso.test(bound.dayMin ?? "")) failures.push(`${route}: the date input has no lower bound (min is ${JSON.stringify(bound.dayMin)})`);
  if (iso.test(bound.dayMax ?? "") && iso.test(bound.dayMin ?? "") && bound.dayMax < bound.dayMin)
    failures.push(`${route}: max ${bound.dayMax} is before min ${bound.dayMin} — the picker offers nothing`);
  if (iso.test(bound.dayMax ?? "")) {
    // The bound must be the horizon the site holds, not a stale date baked into a build: it has to sit within a
    // day of `now + HORIZON_DAYS`, whatever day this run happens to fall on.
    const want = new Date(`${bound.dayMax}T12:00:00Z`);
    const days = Math.round((want.getTime() - (Date.now() + HORIZON_DAYS * 86_400_000)) / 86_400_000);
    if (Math.abs(days) > 1) failures.push(`${route}: max is ${bound.dayMax}, which is ${days} day(s) off the ${HORIZON_DAYS}-day horizon the site states`);
  }
  if (route === "/visit") {
    if (bound.timeMax !== LAST_SITTING_LABEL) failures.push(`/visit: the time input's max is ${JSON.stringify(bound.timeMax)}, not the last sitting the site derives (${LAST_SITTING_LABEL}) — the page and the picker disagree about when the room stops taking sittings`);
    if (bound.timeMin !== OPEN_LABEL) failures.push(`/visit: the time input opens at ${JSON.stringify(bound.timeMin)} instead of ${OPEN_LABEL}`);
    if (Number(bound.timeStep) !== 900) failures.push(`/visit: the time step is ${JSON.stringify(bound.timeStep)}, not the 900 seconds the site's own step constant says — the offered values and the bound come from different numbers`);
  } else {
    const offered = Array.isArray(bound.options) ? bound.options : [];
    const wrong = offered.filter((v) => !openSlots.includes(v));
    const missing = openSlots.filter((v) => !offered.includes(v));
    if (offered.length !== openSlots.length || wrong.length || missing.length)
      failures.push(`/table: the When list offers ${offered.length} slots (${offered.slice(0, 4).join(", ")}${offered.length > 4 ? ", …" : ""}) but the room's half-hour window is ${openSlots.length} (${openSlots[0]}–${openSlots[openSlots.length - 1]}) — refused: ${wrong.join(",") || "none"}, absent: ${missing.join(",") || "none"}. A slot outside the window is a 422 about visitTime, which this form has no control named`);
    if (offered.length && !openSlots.includes(bound.timeValue))
      failures.push(`/table: the Time select is showing ${JSON.stringify(bound.timeValue)}, which is not a slot the book would accept — pressing Record without touching it sends a refusal`);
  }
  if (bound.rangeOverflow === true) failures.push(`${route}: the default date is already past its own max — every submit from a fresh page would be refused before the script runs`);
}

// The behavioural half, on the page that has the free-form time input: a date past the end must not reach the book.
await goto("/visit");
const overflowSetup = await armSetup("[data-request-form]", []);
const overflowFill = await armFill("[data-request-form]", { ...GUEST });
if (overflowFill.length) failures.push(`/visit bounds probe: the typed form is invalid before the overflow submit (${overflowFill.join("; ")}) — the check below measures nothing`);
const overflowRead = await evaluate(`
  const day = document.querySelector("#rq-date");
  const live = document.querySelector("[data-outcome]");
  const before = { state: live.textContent, sent: window.__hhArms.sent.length, max: day.max };
  const past = new Date(day.max + "T12:00:00Z");
  past.setUTCDate(past.getUTCDate() + 1);
  day.value = past.toISOString().slice(0, 10);
  day.dispatchEvent(new Event("input", { bubbles: true }));
  document.querySelector("[data-request-form]").requestSubmit();
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  return {
    attempted: past.toISOString().slice(0, 10),
    max: before.max,
    overflow: day.validity.rangeOverflow === true,
    valid: document.querySelector("[data-request-form]").checkValidity() === true,
    sent: window.__hhArms.sent.length - before.sent,
    stateChanged: live.textContent !== before.state,
    thrown: window.__hhArms.thrown.slice(),
  };
`);
{
  const logged = drain();
  results.push({ path: "/visit date past max", value: overflowRead, errors: logged.errors, warnings: logged.warnings });
  if (overflowRead.overflow !== true) failures.push(`/visit: ${overflowRead.attempted} (one day past ${overflowRead.max}) is not flagged as an overflow by the browser — the bound is decoration, not a check`);
  if (overflowRead.sent) failures.push(`/visit: a date one day past the max still reached the book (${overflowRead.sent} request(s)) — the horizon is enforced after the fact, which is the state that produces a refusal the cursor cannot point at`);
  if (overflowRead.stateChanged) failures.push("/visit: the overflow submit wrote a sentence in the live region although native validity should have stopped it before the handler ever ran — the guest is being told something about a request that was never attempted");
  if (overflowRead.thrown.length) failures.push(`/visit: the overflow submit threw (${overflowRead.thrown.join("; ")})`);
  if (logged.errors.length) failures.push(`/visit date past max: ${logged.errors.length} console error(s) (${logged.errors.join(" | ")})`);
  if (!overflowSetup.api) failures.push("/visit: data-api is empty, so this probe could not have reached the book even if it tried");
}

// ---------------------------------------------------------------- report
// Both exit paths run through here: the batteries end by calling it with nothing, and the two crash handlers
// call it with the error that stopped them. `reason` is the only argument, and the only difference it makes is
// that the report says the run was interrupted — the rows it collected before the interruption are printed
// either way, because they are the reason the run exists.
async function printReport(reason = null) {
  const pad = (s, n) => String(s).padEnd(n);
  console.log(`verify-runtime  browser ${browser.split("/").pop()}  ${base}\n`);
  if (reason) {
    const why = reason instanceof Error ? (reason.stack ?? reason.message) : String(reason?.stack ?? reason);
    console.error(`harness stopped before the batteries finished:\n${why}\n`);
    failures.push(`the harness threw before reaching the end of the file (${why.split("\n")[0]}) — the rows below are what it managed to learn first, and they are not a complete run`);
  }
  for (const r of results) {
    console.log(`${pad(r.path, 22)} errors ${r.errors.length}  warnings ${r.warnings.length}`);
    for (const e of r.errors) console.log(`   ERR ${e}`);
    for (const w of r.warnings) console.log(`   warn ${w}`);
  }
  // The verdict line below promises "no console errors on any route". Until now it printed that over any
  // number of errors, because a row's errors were only ever echoed — nothing turned them into a problem. A
  // promise the reporter cannot keep is worse than no promise, so the count is now a gate. Every route in
  // the last run reported errors 0, so this is tightening, not tripping.
  const loudRows = results.filter((r) => r.errors.length);
  if (loudRows.length)
    failures.push(`${loudRows.reduce((n, r) => n + r.errors.length, 0)} console error(s) across ${loudRows.map((r) => r.path).join(", ")} — the run cannot also say the routes are clean`);
  console.log("\n--- measurements");
  console.log(JSON.stringify(results.map((r) => ({ [r.path]: r.value })), null, 1));

  if (failures.length) {
    console.error(`\nverify-runtime: ${failures.length} problem(s)`);
    console.error(failures.map((f) => `  ${f}`).join("\n"));
    await goodbye(1);
  }
  console.log("\nverify-runtime: ok — no console errors on any route, door paints, dial drives the rig, menu and table interactions respond, no-JS still renders");
  await goodbye(0);
}

await printReport();

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
