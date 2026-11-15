// probe-who.mjs — "who puts hidden on a dish card?"
//
// The menu page contradicts itself: [data-count] reports "Showing all 243 items" (which apply() only
// writes when visibleCount === cards.length) while every card carries the hidden attribute. Only
// MenuExplorer writes card.hidden, so either the write is being undone, or a second writer exists that
// grep cannot see. This script wraps the `hidden` IDL setter and setAttribute() in a new-document script,
// so the synchronous stack at the moment of the write names the culprit.
//
// Usage: node scripts/probe-who.mjs [path]
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const args = process.argv.slice(2);
const pathArg = args.find((a) => a.startsWith("/")) ?? "/menu";
const base = (args.find((a) => a.startsWith("--base=")) ?? "--base=http://127.0.0.1:4322").slice(7).replace(/\/$/, "");
const chrome =
  args.find((a) => a === "--chrome")
    ? args[args.indexOf("--chrome") + 1]
    : process.env.HH_CHROME ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";

const port = 9334;
const profile = mkdtempSync(join(tmpdir(), "hh-who-"));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const proc = spawn(
  chrome,
  ["--headless=new", "--enable-unsafe-swiftshader", "--use-gl=angle", "--use-angle=swiftshader",
   "--no-first-run", "--no-default-browser-check", "--disable-dev-shm-usage",
   `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, "--window-size=1440,1000", "about:blank"],
  { stdio: "ignore" }
);
const kill = () => { try { proc.kill(); } catch {} try { rmSync(profile, { recursive: true, force: true }); } catch {} };
process.on("exit", kill);

let ws, nextId = 1;
const pending = new Map();
const events = [];
const send = (method, params = {}, sessionId) => {
  const id = nextId++;
  ws.send(JSON.stringify(sessionId ? { id, method, params, sessionId } : { id, method, params }));
  return new Promise((res, rej) => pending.set(id, { res, rej, method }));
};
ws = await (async () => {
  for (let i = 0; i < 80; i += 1) {
    try {
      const info = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
      const sock = new WebSocket(info.webSocketDebuggerUrl);
      await new Promise((res, rej) => {
        sock.addEventListener("open", res, { once: true });
        sock.addEventListener("error", () => rej(new Error("socket")), { once: true });
      });
      return sock;
    } catch {
      if (i === 79) throw new Error("no DevTools endpoint");
      await sleep(250);
    }
  }
})();
ws.addEventListener("message", (frame) => {
  const msg = JSON.parse(frame.data);
  if (msg.id && pending.has(msg.id)) {
    const { res, rej, method } = pending.get(msg.id);
    pending.delete(msg.id);
    msg.error ? rej(new Error(`${method}: ${msg.error.message}`)) : res(msg.result);
    return;
  }
  if (msg.method) events.push(msg);
});

const { targetId } = await send("Target.createTarget", { url: "about:blank" });
const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
const inPage = (m, p) => send(m, p, sessionId);
await inPage("Runtime.enable");
await inPage("Page.enable");
await inPage("Log.enable");

await inPage("Page.addScriptToEvaluateOnNewDocument", {
  source: `(() => {
    const log = [];
    window.__hhLog = log;
    // No cap on the aggregate: the first apply() writes 243 un-hides and a later one writes 243 hides,
    // and a 40-record ring buffer shows only the innocent half.
    const agg = new Map();
    window.__hhAgg = agg;
    const name = (el) => (el.dataset && el.dataset.id) || el.className || el.tagName;
    const rec = (kind, el, value, stack) => {
      const frames = String(stack || "").split("\\n").slice(2, 7).map((s) => s.trim().replace(/https?:\\/\\/[^/]+/, "")).join(" <- ");
      const key = kind + "=" + String(value) + " :: " + frames;
      agg.set(key, (agg.get(key) ?? 0) + 1);
      window.__hhWrites = (window.__hhWrites ?? 0) + 1;
    };
    addEventListener("DOMContentLoaded", () => {
      // Timeline: how many cards carry the attribute, and when that changes.
      window.__hhTimeline = [];
      const snap = (label) =>
        window.__hhTimeline.push({ t: Math.round(performance.now()), label, hidden: document.querySelectorAll("[data-card][hidden]").length });
      window.__hhSnap = snap;
      snap("DOMContentLoaded");
      const mo = new MutationObserver(() => snap("mutation"));
      mo.observe(document.documentElement, { attributes: true, attributeFilter: ["hidden"], subtree: true });
    });
    const desc = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "hidden");
    Object.defineProperty(HTMLElement.prototype, "hidden", {
      configurable: true, enumerable: desc.enumerable, get: desc.get,
      set(v) { rec("set.hidden", this, v, new Error().stack); desc.set.call(this, v); },
    });
    const set = Element.prototype.setAttribute;
    Element.prototype.setAttribute = function (k, v) {
      if (k === "hidden" || k === "aria-hidden") rec("setAttribute:" + k, this, v, new Error().stack);
      return set.call(this, k, v);
    };
    const rm = Element.prototype.removeAttribute;
    Element.prototype.removeAttribute = function (k) {
      if (k === "hidden") rec("removeAttribute", this, "", new Error().stack);
      return rm.call(this, k);
    };
    addEventListener("error", (e) => log.push({ kind: "page-error", target: e.filename, value: e.message }), true);
  })();`,
});

async function goto(url) {
  events.length = 0;
  await inPage("Page.navigate", { url });
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline && !events.some((e) => e.method === "Page.loadEventFired")) await sleep(100);
  await sleep(1600);
  return events.filter((e) => e.method === "Runtime.exceptionThrown" || (e.method === "Log.entryAdded" && e.params.entry.level === "error")).map((e) => e.method === "Runtime.exceptionThrown" ? "uncaught: " + e.params.exceptionDetails.exception?.description?.split("\n")[0] : `${e.params.entry.source}/${e.params.entry.text.slice(0, 200)}`);
}

async function evl(body) {
  const out = await inPage("Runtime.evaluate", { expression: `(async () => {\n${body}\n})()`, awaitPromise: true, returnByValue: true });
  if (out.exceptionDetails) throw new Error("threw: " + (out.exceptionDetails.exception?.description ?? out.exceptionDetails.text));
  return out.result.value;
}

const errs = await goto(base + pathArg);
console.log("errors:", errs.length ? errs : "none");

const tally = await evl(`
  const agg = [...(window.__hhAgg ?? new Map()).entries()].sort((a, b) => b[1] - a[1]);
  const tl = window.__hhTimeline ?? [];
  const condensed = [];
  for (const s of tl) if (!condensed.length || condensed.at(-1).hidden !== s.hidden) condensed.push(s);
  return {
    totalWrites: window.__hhWrites ?? 0,
    writers: agg.slice(0, 12),
    timeline: condensed.slice(0, 24),
    dom: {
      cards: document.querySelectorAll("[data-card]").length,
      attrHidden: document.querySelectorAll("[data-card][hidden]").length,
      sectionsHidden: document.querySelectorAll("[data-section][hidden]").length,
      groupsHidden: document.querySelectorAll(".group[hidden]").length,
      scripts: [...document.querySelectorAll("script[src]")].map((s) => s.src.split("/").pop()),
      count: document.querySelector("[data-count]")?.textContent.trim().slice(0, 80),
    },
  };
`);
console.log(JSON.stringify(tally, null, 2));

// Now the direct question: does assigning false actually clear the attribute in this document?
const direct = await evl(`
  const c = document.querySelector("[data-card]");
  const before = { attr: c.hasAttribute("hidden"), prop: c.hidden, display: getComputedStyle(c).display };
  c.hidden = false;
  const afterSet = { attr: c.hasAttribute("hidden"), prop: c.hidden, display: getComputedStyle(c).display };
  c.removeAttribute("hidden");
  const afterRemove = { attr: c.hasAttribute("hidden"), display: getComputedStyle(c).display, height: c.getBoundingClientRect().height };
  const sub = c.closest("[data-section]"); const wasSub = sub.hidden; sub.hidden = false;
  const afterUnhideSub = { display: getComputedStyle(c).display, height: c.getBoundingClientRect().height, wasSub };
  return { before, afterSet, afterRemove, afterUnhideSub, writes: window.__hhLog.length };
`);
console.log(JSON.stringify(direct, null, 2));

kill();
process.exit(0);
