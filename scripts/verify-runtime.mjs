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
// Usage: npm run build && node scripts/verify-runtime.mjs [--base http://localhost:4322] [--port 9333]
// --port is only the starting point: if something already holds it the run moves to the next free port,
// because attaching to another Chrome's endpoint reads another run's pages.
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import net from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { platform } from "node:process";

const argv = process.argv.slice(2);
const arg = (name, dflt) => {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? dflt : argv[i + 1];
};
const base = arg("base", "http://localhost:4322").replace(/\/$/, "");
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

const browser = CANDIDATES.find((p) => existsSync(p)) ?? CANDIDATES.at(-1);
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
    // stride: sample ~1 in every 900 pixels; enough to characterise a 1440x1000 frame, cheap to compare
    for (let i = 0; i < d.length; i += 4 * 887) {
      mean[0] += d[i]; mean[1] += d[i + 1]; mean[2] += d[i + 2]; n += 1;
      uniq.add((d[i] >> 4) + "," + (d[i + 1] >> 4) + "," + (d[i + 2] >> 4));
    }
    return { mean: mean.map((v) => Math.round(v / n)), uniq: uniq.size, size: [c.width, c.height] };
  `);
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
