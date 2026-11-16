// site/src/lib/table-client.mjs — the one place that owns the table in a browser.
//
// The maths lives in lib/table.mjs: pure, tested, and unaware of the DOM. This module adds the three
// things a browser needs and a unit test cannot check — where the table is stored, and how the page
// is told it changed.
//
//   * localStorage keeps a guest's table between visits, which is the point of a configurator that is
//     not a shopping cart: you decide on Tuesday what you want on Friday.
//   * ?t= in the address wins over storage when present, so a link someone sent you shows what they
//     sent rather than what you left half-built last week.
//   * One event, "hh:table", on document. The builder sheet, the count in the nav and the ticks in
//     the menu all listen to it; none of them keeps a copy of the state.
import menu from "../data/menu.json";
import {
  addLine,
  clampParty,
  decodeTable,
  emptyTable,
  findItem,
  removeLine,
  setOption,
  setQty,
  shareUrl,
  totals,
} from "./table.mjs";

/* This module is imported by TableBuilder's frontmatter as well as by its client script, so every
   line of it is evaluated during `astro build` on a server that has no `location`, no `localStorage`
   and no `addEventListener`. One named test states the rule where both uses can see it — the
   alternative was a guard at each call site, and a guard you have to remember is a guard that gets
   forgotten: the first build of this site died twice on exactly that. */
const ON_CLIENT = typeof location !== "undefined" && typeof localStorage !== "undefined";

const KEY = "habibi-haven:table:v1";
export const EVENT = "hh:table";

function readStored() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.lines)) return null;
    return parsed;
  } catch {
    // private mode, a full quota, or a shape from an older build — all of them mean "start clean"
    return null;
  }
}

function writeStored(table) {
  try {
    localStorage.setItem(KEY, JSON.stringify(table));
  } catch {
    /* storage is a courtesy; the in-memory table still carries this visit */
  }
}

/**
 * Drop lines whose id no longer exists.
 *
 * They renamed a dish upstream and we rebuilt, so a stored table can point at an id that is gone.
 * A row the totals cannot price is worse than a row that quietly disappeared, and this is the only
 * place both the sheet and the nav read from, so filtering here filters it for everyone.
 */
export function sanitize(table) {
  const lines = table.lines.filter((line) => Boolean(findItem(menu, line.id)));
  // The party is clamped to the site's own limit rather than to a wider one: a stored table from an older
  // build (or a hand-edited share link) that says 99 would be accepted here and then 422'd by the book, so
  // the guest would be told the sheet they are looking at is impossible. clampParty is the same window the
  // stepper and the decoder use, and tests/api.mjs compares it against the Worker's.
  const party = clampParty(table.party);
  return { party, lines };
}

/**
 * The table this module starts with.
 *
 * `location` and `localStorage` are browser globals, and this module is imported by TableBuilder's
 * frontmatter as well as by its client script — so this function runs during `astro build`, on the
 * server, where neither exists. The server does not need the guest's table: it renders the empty one
 * and the client replaces it on hydration, which is the same shape the page had before any
 * JavaScript. The environment test is the whole fix, and it is why the check is here rather than at
 * each call site — a guard someone has to remember is a guard that gets forgotten.
 */
function initial() {
  if (!ON_CLIENT) return emptyTable();
  const fromUrl = new URLSearchParams(location.search).get("t");
  const source = fromUrl ? decodeTable(fromUrl) : readStored();
  return sanitize(source || emptyTable());
}

let current = initial();

export function getTable() {
  return current;
}

export function getTotals() {
  return totals(menu, current);
}

function commit(next) {
  current = sanitize(next);
  writeStored(current);
  const snapshot = totals(menu, current);
  document.dispatchEvent(new CustomEvent(EVENT, { detail: { table: current, totals: snapshot, menu } }));
  return current;
}

export function setParty(party) {
  // table.mjs has no setParty because the party is not maths — it is a preference about how to split
  // the bill, so it is written straight onto the table object here.
  return commit({ ...current, party });
}

/** One more plate. The menu's add button and the sheet's + both call this. */
export function addToTable(id, option) {
  return commit(addLine(current, id, option));
}

export function changeQty(id, option, qty) {
  return commit(setQty(current, id, option, qty));
}

export function dropLine(id, option) {
  return commit(removeLine(current, id, option));
}

/** The sheet's "choose your side" select. */
export function changeOption(id, option, nextOption) {
  return commit(setOption(current, id, option, nextOption));
}

export function clearTable() {
  return commit(emptyTable(current.party));
}

/** Whether the item is already on the table, so a card can tick itself without knowing the maths. */
export function isOnTable(id) {
  return current.lines.some((line) => line.id === id);
}

/** The address that carries this exact table to another person. */
export function tableLink() {
  // shareUrl() appends /table itself, so the origin is all this side supplies — passing the current
  // pathname as well is how a link built on /menu would end up as /menu/table.
  return shareUrl(location.origin, current);
}

/* A table built in one tab shows up in another without either of them reloading. The listener is
   conditional for the same reason `initial()` is: `addEventListener` is a global on a page and is
   not a global in the Node process that renders this component into HTML. */
if (ON_CLIENT) {
  addEventListener("storage", (event) => {
    if (event.key !== KEY) return;
    commit(event.newValue ? JSON.parse(event.newValue) : emptyTable(current.party));
  });
}
