import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const source = (path) => readFile(new URL(path, `file://${ROOT.replaceAll("\\", "/")}/`), "utf8");
const module = () => import("../site/src/lib/dish-card.mjs");

class FakeTarget {
  constructor() {
    this.listeners = new Map();
  }

  addEventListener(type, fn) {
    const list = this.listeners.get(type) ?? [];
    list.push(fn);
    this.listeners.set(type, list);
  }

  removeEventListener(type, fn) {
    this.listeners.set(type, (this.listeners.get(type) ?? []).filter((entry) => entry !== fn));
  }

  dispatchEvent(event) {
    for (const fn of [...(this.listeners.get(event.type) ?? [])]) fn(event);
    return true;
  }

  count(type) {
    return (this.listeners.get(type) ?? []).length;
  }
}

function cardFixture(id, options = ["Chips", "Mandy Rice"]) {
  const card = new FakeTarget();
  card.attrs = new Map();
  card.dataset = { id };
  card.toggleAttribute = (name, on) => on ? card.attrs.set(name, "") : card.attrs.delete(name);
  card.setAttribute = (name, value) => card.attrs.set(name, String(value));
  card.closest = (selector) => selector === "[data-card]" ? card : null;

  const labels = options.map((option) => {
    const label = new FakeTarget();
    label.attrs = new Map();
    label.setAttribute = (name, value) => label.attrs.set(name, String(value));
    label.removeAttribute = (name) => label.attrs.delete(name);
    return label;
  });
  const radios = options.map((option, index) => {
    const radio = new FakeTarget();
    radio.value = option;
    radio.checked = index === 0;
    radio.closest = (selector) => selector === ".acc__option" ? labels[index] : null;
    return radio;
  });
  const button = new FakeTarget();
  button.textContent = "Add to table";
  button.dataset = { add: id };
  button.attrs = new Map();
  button.setAttribute = (name, value) => button.attrs.set(name, String(value));
  button.closest = (selector) => selector === "[data-add]" ? button : selector === "[data-card]" ? card : null;
  const note = { hidden: true, textContent: "" };

  card.querySelector = (selector) => {
    if (selector === "[data-add]") return button;
    if (selector === "[data-card-selection]") return note;
    if (selector === "[name^='acc-'][type='radio']:checked") return radios.find((radio) => radio.checked) ?? null;
    return null;
  };
  card.querySelectorAll = (selector) => selector === "input[type=radio]" ? radios : [];
  return { card, button, note, radios, labels };
}

function rootFixture(cards) {
  const root = new FakeTarget();
  root.querySelectorAll = (selector) => selector === "[data-card]" ? cards : [];
  return root;
}

test("a dish selection totals its quantity without collapsing distinct sides", async () => {
  const { dishSelection } = await module();
  assert.deepEqual(dishSelection({ lines: [
    { id: "grilled-chicken-breast", option: "Chips", qty: 1 },
    { id: "karak-chai", qty: 2 },
    { id: "grilled-chicken-breast", option: "Mandy Rice", qty: 2 },
  ] }, "grilled-chicken-breast"), {
    qty: 3,
    options: [
      { option: "Chips", qty: 1 },
      { option: "Mandy Rice", qty: 2 },
    ],
  });
});

test("one selected side restores its radio and states its quantity", async () => {
  const { paintDishCard } = await module();
  const { card, button, note, radios, labels } = cardFixture("grilled-chicken-breast");
  paintDishCard(card, { qty: 2, options: [{ option: "Mandy Rice", qty: 2 }] });
  assert.equal(radios[0].checked, false);
  assert.equal(radios[1].checked, true);
  assert.equal(labels[0].attrs.has("data-selected"), false);
  assert.equal(labels[1].attrs.get("data-selected"), "");
  assert.equal(labels[1].attrs.get("data-side-qty"), "2");
  assert.equal(button.textContent, "On your table · 2");
  assert.equal(button.attrs.get("aria-pressed"), "true");
  assert.equal(note.hidden, false);
  assert.equal(note.textContent, "2 selected · Mandy Rice × 2");
});

test("multiple sides stay visible instead of making one radio represent the whole table", async () => {
  const { paintDishCard } = await module();
  const { card, note, radios, labels } = cardFixture("grilled-chicken-breast");
  radios[1].checked = true;
  radios[0].checked = false;
  paintDishCard(card, { qty: 3, options: [
    { option: "Chips", qty: 1 },
    { option: "Mandy Rice", qty: 2 },
  ] });
  assert.equal(note.textContent, "3 selected · Chips × 1 · Mandy Rice × 2");
  assert.equal(labels[0].attrs.get("data-side-qty"), "1");
  assert.equal(labels[1].attrs.get("data-side-qty"), "2");
  assert.equal(labels.every((label) => label.attrs.has("data-selected")), true);
  assert.equal(radios.filter((radio) => radio.checked).length, 1, "the radio is the next side to add, not a summary of all sides");
  assert.equal(radios[1].checked, true, "an existing next-side choice remains usable");
});

test("clearing a dish restores the default next-side choice and hides its summary", async () => {
  const { paintDishCard } = await module();
  const { card, button, note, radios, labels } = cardFixture("grilled-chicken-breast");
  card.attrs.set("data-on", "");
  labels.forEach((label) => label.attrs.set("data-selected", ""));
  radios[1].checked = true;
  radios[0].checked = false;
  paintDishCard(card, { qty: 0, options: [] });
  assert.equal(card.attrs.has("data-on"), false);
  assert.equal(button.textContent, "Add to table");
  assert.equal(button.attrs.get("aria-pressed"), "false");
  assert.equal(note.hidden, true);
  assert.equal(note.textContent, "");
  assert.equal(radios[0].checked, true);
  assert.equal(labels.every((label) => !label.attrs.has("data-selected") && !label.attrs.has("data-side-qty")), true);
});

test("shared wiring paints stored state, adds the checked side, follows table events, and tears down", async () => {
  const { wireDishCards } = await module();
  const { card, button } = cardFixture("grilled-chicken-breast");
  const root = rootFixture([card]);
  const target = new FakeTarget();
  let table = { party: 2, lines: [{ id: "grilled-chicken-breast", option: "Mandy Rice", qty: 1 }] };
  const calls = [];
  const stop = wireDishCards(root, {
    target,
    event: "hh:table",
    getTable: () => table,
    addToTable: (id, option) => {
      calls.push([id, option]);
      table = { party: 2, lines: [{ id, option, qty: 2 }] };
      target.dispatchEvent({ type: "hh:table" });
    },
  });
  assert.equal(button.textContent, "On your table · 1", "stored selection paints immediately");
  root.dispatchEvent({ type: "click", target: button });
  assert.deepEqual(calls, [["grilled-chicken-breast", "Mandy Rice"]]);
  assert.equal(button.textContent, "On your table · 2", "the canonical table event repaints the card");
  assert.equal(target.count("hh:table"), 1);
  assert.equal(root.count("click"), 1);
  stop();
  assert.equal(target.count("hh:table"), 0);
  assert.equal(root.count("click"), 0);
});

test("Homepage and Menu both mount the shared card wiring", async () => {
  const [home, menu] = await Promise.all([
    source("site/src/pages/index.astro"),
    source("site/src/components/MenuExplorer.astro"),
  ]);
  assert.match(home, /data-signature-deck/, "the homepage needs a stable host for the signature cards");
  assert.match(home, /wireDishCards\(/, "homepage add controls must use the shared wiring");
  assert.match(menu, /wireDishCards\(/, "Menu must use the same selection painting and add behavior");
  assert.doesNotMatch(menu, /const paintOnTable =/, "the divergent Menu-only painter must be removed");
});
