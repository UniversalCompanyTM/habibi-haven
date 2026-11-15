// probe-menu.mjs — one page, one tab, no concurrency. A second opinion on the claim
// "verify-runtime says /menu shows 0 of 243 rows".
//
// verify-runtime drives seven batteries over a single attached target and starts some of them without
// awaiting the previous one, so a measurement taken on /menu can be taken while another battery is
// scrolling, hiding and navigating the same document. This script exists only to answer one question:
// what does /menu look like when nothing else touches it?
//
// Usage: node scripts/probe-menu.mjs [path]            (default /menu)
//        node scripts/probe-menu.mjs /menu --chrome <exe>
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const args = process.argv.slice(2);
const pathArg = args.find((a) => a.startsWith("/")) ?? "/menu";
const base = (args.find((a) => a.startsWith("--base=")) ?? "--base=http://127.0.0.1:4322").slice(7).replace(/\/$/, "");
const chrome =
  args.find((a) => a === "--chrome") ? args[args.indexOf("--chrome") + 1]
  : process.env.HH_CHROME ??
    "C:/Program Files/Google/Chrome/Application/chrome.exe";

const port = 9333;
const profile = mkdtempSync(join(tmpdir(), "hh-probe-"));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const chromeProc = spawn(
  chrome,
  [
    "--headless=new",
    "--enable-unsafe-swiftshader",
    "--use-gl=angle",
    "--use-angle=swiftshader",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-dev-shm-usage",
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
    "--window-size=1440,1000",
    "about:blank",
  ],
  { stdio: "ignore" }
);
const kill = () => {
  try { chromeProc.kill(); } catch {}
  try { rmSync(profile, { recursive: true, force: true }); } catch {}
};
process.on("exit", kill);

let ws, nextId = 1;
const pending = new Map();
const events = [];
const send = (method, params = {}, sessionId) => {
  const id = nextId++;
  ws.send(JSON.stringify(sessionId ? { id, method, params, sessionId } : { id, method, params }));
  return new Promise((res, rej) => pending.set(id, { res, rej, method }));
};

for (let i = 0; i < 80; i += 1) {
  try {
    const info = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
    ws = new WebSocket(info.webSocketDebuggerUrl);
    await new Promise((res, rej) => {
      ws.addEventListener("open", res, { once: true });
      ws.addEventListener("error", () => rej(new Error("socket failed")), { once: true });
    });
    break;
  } catch {
    if (i === 79) throw new Error("no DevTools endpoint");
    await sleep(250);
  }
}
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
await inPage("Log.enable");
await inPage("Page.enable");

const errs = [];
ws.addEventListener("message", () => {});

async function goto(url) {
  events.length = 0;
  await inPage("Page.navigate", { url });
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline && !events.some((e) => e.method === "Page.loadEventFired")) await sleep(100);
  await sleep(1500);
  for (const e of events) {
    if (e.method === "Runtime.exceptionThrown") errs.push("uncaught: " + (e.params.exceptionDetails.exception?.description ?? e.params.exceptionDetails.text).split("\n")[0]);
    if (e.method === "Log.entryAdded" && e.params.entry.level === "error") errs.push(`${e.params.entry.source}/${e.params.entry.text.slice(0, 200)}`);
    if (e.method === "Runtime.consoleAPICalled" && e.params.type === "error") errs.push("console.error: " + e.params.args.map((a) => a.value ?? a.description).join(" ").slice(0, 200));
  }
  events.length = 0;
}

async function evl(body) {
  const out = await inPage("Runtime.evaluate", {
    expression: `(async () => {\n${body}\n})()`,
    awaitPromise: true,
    returnByValue: true,
  });
  if (out.exceptionDetails) throw new Error("probe threw: " + (out.exceptionDetails.exception?.description ?? out.exceptionDetails.text));
  return out.result.value;
}

const GEOMETRY = `
  const all = (s) => [...document.querySelectorAll(s)];
  const cards = all("[data-card]");
  const first = cards[0];
  const cs = first ? getComputedStyle(first) : null;
  return {
    url: location.href,
    total: cards.length,
    attrHidden: all("[data-card][hidden]").length,
    rectHeightPositive: cards.filter((c) => c.getBoundingClientRect().height > 0).length,
    displayNone: cards.filter((c) => getComputedStyle(c).display === "none").length,
    opacityZero: cards.filter((c) => Number(getComputedStyle(c).opacity) < 0.05).length,
    zeroButNotHidden: cards.filter((c) => c.getBoundingClientRect().height === 0 && !c.hasAttribute("hidden")).length,
    first: first ? {
      id: first.dataset.id, hidden: first.hasAttribute("hidden"), display: cs.display,
      opacity: cs.opacity, contentVisibility: cs.contentVisibility, visibility: cs.visibility,
      rect: first.getBoundingClientRect().toJSON(),
      deckRect: first.parentElement.getBoundingClientRect().toJSON(),
      deckDisplay: getComputedStyle(first.parentElement).display,
      subgroupHidden: !!first.closest("[data-section]")?.hasAttribute("hidden"),
      groupHidden: !!first.closest(".group")?.hasAttribute("hidden"),
      bodyLen: document.body.innerText.length,
    } : null,
    count: document.querySelector("[data-count]")?.textContent.trim().slice(0, 140),
    scrollHeight: document.documentElement.scrollHeight,
  };
`;

await goto(base + pathArg);
const initial = await evl(GEOMETRY);
console.log("INITIAL  ", JSON.stringify(initial, null, 2));

const afterScroll = await evl(`
  const all = (s) => [...document.querySelectorAll(s)];
  const cards = all("[data-card]");
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const opacityRevealed = () => all("[data-reveal], .kin").filter((el) => Number(getComputedStyle(el).opacity) > 0.9).length;
  const revealTotal = all("[data-reveal], .kin").length;
  const stops = [];
  for (const frac of [0, 0.2, 0.4, 0.6, 0.8, 1]) {
    scrollTo({ top: Math.max(0, document.documentElement.scrollHeight * frac - 200), behavior: "instant" });
    // 1400ms: the reveal transition carries a delay of up to --i * 70ms (490ms at --i 7) on top of
    // 700ms of opacity and 800ms of transform. A sample taken 600ms after the jump reads opacity 0 for
    // elements that are on their way in, which is how "4 of 10 reveals never fired" got reported once.
    await wait(1500);
    const near = cards.filter((c) => { const r = c.getBoundingClientRect(); return r.top < innerHeight && r.bottom > 0; });
    stops.push({
      frac,
      y: Math.round(scrollY),
      revealed: opacityRevealed(),
      inViewport: near.length,
      // the class is the mechanism; the opacity is its consequence, measured a full transition later
      inViewportIn: near.filter((c) => c.classList.contains("is-in")).length,
      inViewportVisible: near.filter((c) => Number(getComputedStyle(c).opacity) > 0.9).length,
    });
  }
  // what is still invisible, and is it tall, short, above or below the fold?
  const stuck = all("[data-reveal], .kin")
    .filter((el) => Number(getComputedStyle(el).opacity) < 0.9)
    .slice(0, 10)
    .map((el) => {
      const r = el.getBoundingClientRect();
      return { tag: el.tagName.toLowerCase(), cls: String(el.className).slice(0, 40), h: Math.round(r.height), top: Math.round(r.top), ratioMax: +(Math.min(r.height, innerHeight) / Math.max(r.height, 1)).toFixed(3), isIn: el.classList.contains("is-in") };
    });
  scrollTo({ top: 0 });
  return { revealTotal, stops, stuck, finalRevealed: opacityRevealed() };
`);
console.log("SCROLLED ", JSON.stringify(afterScroll));

const typing = await evl(`
  const q = document.querySelector("[data-q]");
  q.value = "chai"; q.dispatchEvent(new Event("input", { bubbles: true }));
  await new Promise((r) => setTimeout(r, 300));
  const vis = [...document.querySelectorAll("[data-card]")].filter((c) => !c.hasAttribute("hidden"));
  return { chaiVisible: vis.length, names: vis.slice(0, 6).map((c) => c.dataset.name), count: document.querySelector("[data-count]").textContent.trim().slice(0, 90), url: location.search };
`);
console.log("SEARCH   ", JSON.stringify(typing));

const cleared = await evl(`
  document.querySelector("[data-reset]").click();
  await new Promise((r) => setTimeout(r, 300));
  const vis = [...document.querySelectorAll("[data-card]")].filter((c) => !c.hasAttribute("hidden"));
  return { visible: vis.length, boxValue: document.querySelector("[data-q]").value, count: document.querySelector("[data-count]").textContent.trim().slice(0, 90), url: location.search };
`);
console.log("RESET    ", JSON.stringify(cleared));

console.log("\nconsole/log errors on this load:", errs.length ? errs.slice(0, 8) : "none");
kill();
process.exit(0);
