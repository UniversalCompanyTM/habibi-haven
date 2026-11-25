import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { readFile } from "node:fs/promises";
import { registerHooks } from "node:module";
import { decodeTable, encodeTable } from "../site/src/lib/table.mjs";

// Astro/Vite accepts JSON imports without an attribute; plain Node does not. Load the same committed
// menu bytes through a test-only module hook so this suite exercises the real client module unchanged.
const MENU_URL = new URL("../site/src/data/menu.json", import.meta.url).href;
const MENU_SOURCE = await readFile(new URL(MENU_URL), "utf8");
registerHooks({
  load(url, context, nextLoad) {
    if (url === MENU_URL) return { format: "module", source: `export default ${MENU_SOURCE};`, shortCircuit: true };
    return nextLoad(url, context);
  },
});

const KEY = "habibi-haven:table:v1";
let instance = 0;

function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
    values,
  };
}

async function loadClient({ url = "https://example.test/table", stored = {}, routerState = null } = {}) {
  const location = new URL(url);
  const listeners = new Map();
  const window = {
    addEventListener(type, fn) {
      const list = listeners.get(type) ?? [];
      list.push(fn);
      listeners.set(type, list);
    },
    removeEventListener(type, fn) {
      listeners.set(type, (listeners.get(type) ?? []).filter((entry) => entry !== fn));
    },
    dispatchEvent(event) {
      for (const fn of [...(listeners.get(event.type) ?? [])]) fn(event);
      return true;
    },
  };
  const document = new EventTarget();
  const localStorage = memoryStorage(stored);
  const history = {
    state: routerState,
    replaceStates: [],
    replaceState(state, _title, next) {
      this.state = state;
      this.replaceStates.push(state);
      const resolved = new URL(next, location.href);
      location.pathname = resolved.pathname;
      location.search = resolved.search;
      location.hash = resolved.hash;
    },
  };
  Object.assign(globalThis, {
    location,
    history,
    localStorage,
    window,
    document,
    addEventListener: window.addEventListener.bind(window),
    removeEventListener: window.removeEventListener.bind(window),
  });
  instance += 1;
  const client = await import(`../site/src/lib/table-client.mjs?test=${instance}`);
  return { client, location, localStorage, window, document, history };
}

describe("table client", { concurrency: 1 }, () => {
test("stored tables use the same canonical ids, sides and quantities as shared tables", async () => {
  const { client } = await loadClient({
    stored: {
      [KEY]: JSON.stringify({
        party: 99,
        lines: [
          { id: "grilled-chicken-breast", qty: 1 },
          { id: "grilled-chicken-breast", option: "Not a side", qty: 2 },
          { id: "karak-chai", qty: 0 },
        ],
      }),
    },
  });
  assert.deepEqual(client.getTable(), {
    party: 30,
    lines: [{ id: "grilled-chicken-breast", option: "Chips", qty: 3 }],
  });
});

test("malformed cross-tab storage cannot throw or replace the current table", async () => {
  const { client, window, localStorage } = await loadClient({
    url: "https://example.test/table?t=2%7Ckarak-chaix1",
  });
  const before = client.getTable();
  assert.equal(before.lines.length, 1, "the regression must start with a table worth preserving");
  for (const newValue of ["{", "{}", '{"lines":"bad"}', "null", "[]"]) {
    const event = new Event("storage");
    Object.assign(event, { key: KEY, newValue });
    assert.doesNotThrow(() => window.dispatchEvent(event));
    assert.deepEqual(client.getTable(), before, `malformed storage value ${newValue} erased the table`);
    assert.deepEqual(JSON.parse(localStorage.getItem(KEY)), before, `malformed storage value ${newValue} was persisted`);
  }
});

const urlTable = (location) => new URLSearchParams(location.search).get("t");

test("a shared URL wins over storage and becomes the canonical persisted table", async () => {
  const shared = "4|grilled-chicken-breast>Mandy%20Ricex2|karak-chaix1";
  const { client, location, localStorage } = await loadClient({
    url: `https://example.test/table?t=${encodeURIComponent(shared)}`,
    stored: { [KEY]: JSON.stringify({ party: 2, lines: [{ id: "sinia", qty: 1 }] }) },
  });
  assert.equal(globalThis.location, location);
  assert.equal(urlTable(globalThis.location), shared);
  assert.deepEqual(client.getTable(), {
    party: 4,
    lines: [
      { id: "grilled-chicken-breast", option: "Mandy Rice", qty: 2 },
      { id: "karak-chai", qty: 1 },
    ],
  });
  assert.equal(urlTable(location), encodeTable(client.getTable()));
  assert.deepEqual(JSON.parse(localStorage.getItem(KEY)), client.getTable());
});

test("table URL commits preserve the router history state needed for later DOM swaps", async () => {
  const routerState = { current: "/table", forward: "/menu", scroll: 240 };
  const { client, history } = await loadClient({ routerState });
  client.addToTable("karak-chai");
  assert.equal(history.state, routerState, "replaceState(null) makes Astro treat later popstate as URL-only");
  assert.deepEqual(history.replaceStates, [routerState]);
});

test("table commits preserve menu filters and hashes while writing the shareable t parameter", async () => {
  const { client, location } = await loadClient({ url: "https://example.test/menu?q=chai&tag=bar#room" });
  client.addToTable("karak-chai");
  const params = new URLSearchParams(location.search);
  assert.equal(params.get("q"), "chai");
  assert.equal(params.get("tag"), "bar");
  assert.equal(params.get("t"), encodeTable(client.getTable()));
  assert.equal(location.hash, "#room");
  client.clearTable();
  const cleared = new URLSearchParams(location.search);
  assert.equal(cleared.get("q"), "chai");
  assert.equal(cleared.get("t"), null);
  assert.equal(location.hash, "#room");
});

test("router swaps and history navigation reconcile a changed table URL", async () => {
  const { client, location, localStorage, history, window, document } = await loadClient({
    url: "https://example.test/table?t=2%7Ckarak-chaix1",
  });
  history.replaceState(null, "", "/table?t=3%7Csiniax2");
  window.dispatchEvent(new Event("popstate"));
  assert.deepEqual(client.getTable(), { party: 3, lines: [{ id: "sinia", qty: 2 }] });
  assert.deepEqual(JSON.parse(localStorage.getItem(KEY)), client.getTable());

  history.replaceState(null, "", "/table?t=5%7Cfull-mandyx1");
  document.dispatchEvent(new Event("astro:after-swap"));
  assert.deepEqual(client.getTable(), { party: 5, lines: [{ id: "full-mandy", qty: 1 }] });
  assert.equal(urlTable(location), encodeTable(client.getTable()));
});

test("a router destination without t keeps the current table and writes it into the new URL", async () => {
  const { client, location, history, document } = await loadClient({
    url: "https://example.test/table?t=2%7Ckarak-chaix2",
  });
  history.replaceState(null, "", "/menu?q=tea#room");
  document.dispatchEvent(new Event("astro:page-load"));
  assert.deepEqual(client.getTable(), { party: 2, lines: [{ id: "karak-chai", qty: 2 }] });
  assert.equal(urlTable(location), encodeTable(client.getTable()));
  assert.equal(new URLSearchParams(location.search).get("q"), "tea");
  assert.equal(location.hash, "#room");
});

test("unchanged parties and repeated lifecycle synchronization do not dispatch duplicate table events", async () => {
  const { client, document } = await loadClient({ url: "https://example.test/table?t=2%7Ckarak-chaix1" });
  let events = 0;
  document.addEventListener("hh:table", () => { events += 1; });
  client.setParty(2);
  document.dispatchEvent(new Event("astro:after-swap"));
  document.dispatchEvent(new Event("astro:page-load"));
  assert.equal(events, 0);
});
});
