#!/usr/bin/env node
// gallery-behavior.mjs — drive the real Gallery.astro client against a tiny deterministic DOM.
// Dependency-free: only the browser edge and clock are replaced; paint, step, tick and the Tab trap are real.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { dishPhotographs, galleryTally, photographedRows } from "../site/src/lib/gallery.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const source = await readFile(join(ROOT, "site/src/components/Gallery.astro"), "utf8");
const menu = JSON.parse(await readFile(join(ROOT, "site/src/data/menu.json"), "utf8"));
const sha256 = async (path) => createHash("sha256").update(await readFile(path)).digest("hex");
const script = source.match(/<script>([\s\S]*?)<\/script>/)?.[1];
assert.ok(script, "Gallery.astro must contain its client script");
// Node has no browser module loader. Remove only the import and inject the component registrar below.
const executable = script.replace(/^\s*import\s+\{\s*component\s*\}\s+from\s+"\.\.\/lib\/page\.mjs";\s*/m, "");

class FakeElement {
  constructor(document, name, attributes = {}) {
    this.document = document;
    this.name = name;
    this.attributes = new Map(Object.entries(attributes));
    this.listeners = new Map();
    this.style = {};
    this.textContent = "";
    this.hidden = false;
    this.offsetWidth = 320;
  }

  get src() {
    return this.getAttribute("src") ?? "";
  }

  set src(value) {
    this.setAttribute("src", String(value));
  }

  get alt() {
    return this.getAttribute("alt") ?? "";
  }

  set alt(value) {
    this.setAttribute("alt", String(value));
  }

  getAttribute(name) {
    return this.attributes.get(name) ?? null;
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  removeAttribute(name) {
    this.attributes.delete(name);
  }

  hasAttribute(name) {
    return this.attributes.has(name);
  }

  addEventListener(type, fn) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(fn);
  }

  removeEventListener(type, fn) {
    this.listeners.set(type, (this.listeners.get(type) ?? []).filter((bound) => bound !== fn));
  }

  dispatch(type, fields = {}) {
    const event = {
      type,
      target: this,
      defaultPrevented: false,
      preventDefault() {
        this.defaultPrevented = true;
      },
      ...fields,
    };
    for (const fn of [...(this.listeners.get(type) ?? [])]) fn(event);
    return event;
  }

  focus() {
    // A browser cannot focus an element hidden with the HTML hidden attribute.
    if (this.hidden) return;
    this.document.activeElement = this;
  }

  click() {
    return this.dispatch("click", { button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false });
  }
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

function transitionQueue() {
  const items = [];
  return {
    items,
    start(update) {
      const finished = deferred();
      const item = { update, finished, resolve: finished.resolve, reject: finished.reject };
      items.push(item);
      update();
      return { ready: Promise.resolve(), finished: finished.promise };
    },
  };
}

function mountGallery(t, { reducedMotion = false, decode, transitions, classes = new Set() } = {}) {
  const document = {
    activeElement: null,
    documentElement: {
      classList: {
        add: (...names) => names.forEach((name) => classes.add(name)),
        remove: (...names) => names.forEach((name) => classes.delete(name)),
      },
    },
  };
  if (transitions) document.startViewTransition = transitions.start;
  const make = (name, attributes) => new FakeElement(document, name, attributes);
  const media = make("reduced-motion");
  media.matches = reducedMotion;

  const box = make("dialog", { "data-gal-box": "" });
  box.hidden = true;
  const img = make("image", { src: "", alt: "" });
  if (typeof decode === "function") img.decode = decode;
  const title = make("title");
  const note = make("caption note");
  const meta = make("metadata");
  const count = make("count");
  const bar = make("progress bar");
  const play = make("Play", { "data-gal-play": "" });
  const prev = make("Previous", { "data-gal-prev": "" });
  const next = make("Next", { "data-gal-next": "" });
  const close = make("Close", { "data-gal-close": "" });
  const plate = make("plate");
  const selectors = new Map([
    ["[data-gal-box]", box],
    ["[data-gal-img]", img],
    ["[data-gal-title]", title],
    ["[data-gal-note]", note],
    ["[data-gal-meta]", meta],
    ["[data-gal-count]", count],
    ["[data-gal-bar]", bar],
    ["[data-gal-play]", play],
    ["[data-gal-prev]", prev],
    ["[data-gal-next]", next],
    ["[data-gal-close]", close],
    [".gal__plate", plate],
  ]);
  const tileImages = [];
  const tiles = ["/venue-1.jpg", "/venue-2.jpg", "/venue-3.jpg"].map((href, index) => {
    const tile = make(`tile ${index + 1}`, {
      href,
      "data-gal-open": String(index),
      "data-kind": "place",
      "data-title": `Venue ${index + 1}`,
      "data-size": "300 × 225",
    });
    const thumb = make(`thumb ${index + 1}`, { alt: `Venue ${index + 1}` });
    tileImages.push(thumb);
    tile.querySelector = (selector) => (selector === "img" ? thumb : null);
    return tile;
  });
  const root = make("gallery");
  root.querySelector = (selector) => selectors.get(selector) ?? null;
  root.querySelectorAll = (selector) => (selector === "[data-gal-open]" ? tiles : []);

  let nextTimer = 1;
  const timers = new Map();
  const setTimer = (fn, delay) => {
    const id = nextTimer++;
    timers.set(id, { fn, delay });
    return id;
  };
  const clearTimer = (id) => timers.delete(id);

  let definition;
  new Function("component", "document", "matchMedia", "setTimeout", "clearTimeout", `"use strict";\n${executable}`)(
    (_selector, value) => {
      definition = value;
    },
    document,
    () => media,
    setTimer,
    clearTimer,
  );
  assert.ok(definition?.mount, "the real gallery script must register a mount function");
  const stop = definition.mount(root);
  t.after(() => stop?.());

  const openTile = (index = 0) => tiles[index].click();
  const timeout = (delay) => {
    const entry = [...timers].find(([, timer]) => timer.delay === delay);
    assert.ok(entry, `expected a scheduled ${delay}ms timeout`);
    return { id: entry[0], fn: entry[1].fn };
  };
  const fireTimeout = (entry) => {
    // A callback already queued by the browser may still run after clearTimeout. Keep that race testable.
    timers.delete(entry.id);
    entry.fn();
  };
  const runTimeout = (delay) => fireTimeout(timeout(delay));
  const tab = (from, shiftKey = false) => {
    from.focus();
    const event = box.dispatch("keydown", { key: "Tab", shiftKey });
    if (!event.defaultPrevented) {
      // Model the browser's sequential focus navigation. The production trap only handles boundaries.
      const order = [play, prev, next, close].filter((control) => !control.hidden);
      const index = order.indexOf(from);
      const target = order[(index + (shiftKey ? -1 : 1) + order.length) % order.length];
      target?.focus();
    }
    return event;
  };
  const focused = () => document.activeElement?.name ?? "none";

  return {
    document, media, box, img, play, prev, next, close, tiles, tileImages, classes, timers,
    openTile, runTimeout, timeout, fireTimeout, tab, focused,
    stop() {
      stop?.();
    },
    setReducedMotion(matches) {
      media.matches = matches;
      media.dispatch("change");
    },
  };
}

test("reduced-motion Shift+Tab from the dialog reaches the last visible control", (t) => {
  const h = mountGallery(t, { reducedMotion: true });
  h.openTile();
  assert.equal(h.play.hidden, true, "reduced motion must hide Play");
  h.tab(h.box, true);
  assert.equal(h.focused(), "Close");
});

test("reduced-motion Tab from Close wraps to Previous instead of hidden Play", (t) => {
  const h = mountGallery(t, { reducedMotion: true });
  h.openTile();
  h.close.focus();
  h.tab(h.close);
  assert.equal(h.focused(), "Previous", "Close must wrap to the first visible control");
});

test("reduced-motion Tab preserves Previous, Next, Close DOM order", (t) => {
  const h = mountGallery(t, { reducedMotion: true });
  h.openTile();
  h.tab(h.prev);
  assert.equal(h.focused(), "Next");
  h.tab(h.next);
  assert.equal(h.focused(), "Close");
  h.tab(h.close, true);
  assert.equal(h.focused(), "Next");
});

test("normal-motion Tab ring follows Play, Previous, Next, Close DOM order", (t) => {
  const h = mountGallery(t);
  h.openTile();
  assert.equal(h.play.hidden, false);
  h.tab(h.box, true);
  assert.equal(h.focused(), "Close");
  h.tab(h.close);
  assert.equal(h.focused(), "Play");
  h.tab(h.play);
  assert.equal(h.focused(), "Previous");
  h.tab(h.prev);
  assert.equal(h.focused(), "Next");
  h.tab(h.next);
  assert.equal(h.focused(), "Close");
  h.tab(h.play, true);
  assert.equal(h.focused(), "Close");
});

test("changing the motion preference rebuilds the visible Tab ring", (t) => {
  const h = mountGallery(t);
  h.openTile();
  h.setReducedMotion(true);
  assert.equal(h.play.hidden, true);
  h.tab(h.close);
  assert.equal(h.focused(), "Previous");
  h.setReducedMotion(false);
  assert.equal(h.play.hidden, false);
  h.tab(h.close);
  assert.equal(h.focused(), "Play");
});

test("autoplay clears the broken image and CSS-driven note before the next frame settles", (t) => {
  const h = mountGallery(t);
  h.openTile();
  h.img.dispatch("error");
  assert.equal(h.box.hasAttribute("data-gal-broken"), true, "a broken current image must be marked");

  h.play.click();
  h.runTimeout(3600);
  assert.equal(h.img.src, "/venue-2.jpg", "the autoplay tick must paint the next frame");
  assert.equal(
    h.box.hasAttribute("data-gal-broken"),
    false,
    "the previous frame's broken state and ::after note must clear before load/error",
  );
  h.img.dispatch("load");
  assert.equal(h.box.hasAttribute("data-gal-broken"), false, "a good current frame must stay unbroken");
  h.img.dispatch("error");
  assert.equal(h.box.hasAttribute("data-gal-broken"), true, "a broken current frame must still be marked");
});

test("Next and Previous keep manual navigation and clear each previous frame's broken state", (t) => {
  const h = mountGallery(t, { reducedMotion: true });
  h.openTile();
  h.img.dispatch("error");
  assert.equal(h.box.hasAttribute("data-gal-broken"), true);

  h.next.click();
  assert.equal(h.img.src, "/venue-2.jpg");
  assert.equal(h.box.hasAttribute("data-gal-broken"), false);
  h.img.dispatch("error");
  assert.equal(h.box.hasAttribute("data-gal-broken"), true);

  h.prev.click();
  assert.equal(h.img.src, "/venue-1.jpg");
  assert.equal(h.box.hasAttribute("data-gal-broken"), false);
});

test("gallery frames use each photograph's measured ratio instead of forcing 4:3", () => {
  assert.match(
    source,
    /<span\s+class="frame"\s+style=\{`aspect-ratio: \$\{s\.w\} \/ \$\{s\.h\}`\}/,
    "every tile frame must bind its own measured width and height",
  );
});

test("press photography gap states the verified eighteen-photograph size split", async () => {
  const press = JSON.parse(await readFile(join(ROOT, "site/src/data/press.json"), "utf8"));
  const statement = press.gaps[1];
  const match = statement.match(/\((\w+) (?:venue\/food|brand) photographs:\s*(\w+)\s+300×225,\s*(\w+)\s+408×272,\s*(\w+)\s+1200×1200,\s+(\w+)\s+346×506\s+and\s+(\w+)\s+329×512\)/i);
  assert.ok(match, `venue/food photograph breakdown is missing or contradictory: ${statement}`);
  const numbers = { one: 1, two: 2, four: 4, ten: 10, eighteen: 18 };
  const counts = match.slice(1).map((word) => numbers[word.toLowerCase()] ?? Number(word));
  assert.deepEqual(counts, [18, 10, 1, 1, 2, 4], "venue/food photographs must total eighteen with every verified size represented");
  assert.equal(counts[0], counts.slice(1).reduce((sum, count) => sum + count, 0), "photograph counts must add up");
});

test("official venue footage is credited as external links and never re-hosted", async () => {
  const press = JSON.parse(await readFile(join(ROOT, "site/src/data/press.json"), "utf8"));
  const wanted = {
    "https://www.facebook.com/61575101935569/videos/the-week-is-finally-over-now-its-time-to-eatlaugh-and-enjoy-good-companyhabibi-f/2280376199396414/": "The week is finally over",
    "https://www.facebook.com/61575101935569/videos/good-mornings-start-with-great-breakfasthabibi-fyp-foryoupage-habibihaven-goodfo/1386843973177228/": "Good mornings start with great breakfast!",
    "https://www.tiktok.com/@habibi.haven/video/7703445462203862279": "Beauty captured in every angle",
  };
  const urls = Object.keys(wanted);
  const official = press.coverage.filter((entry) => urls.includes(entry.url));
  assert.equal(official.length, urls.length, "all three verified clips from the restaurant's own accounts must be linked");
  for (const entry of official) {
    assert.equal(entry.kind, "video");
    assert.match(entry.by, /Habibi Haven/);
    // Keep only the wording verified in the public title/caption. The longer first Facebook sentence was
    // reconstructed from its URL slug, not observed verbatim, and must not be presented as a quotation.
    assert.equal(entry.quote, wanted[entry.url], `${entry.url} must quote only the verified caption excerpt`);
    assert.match(entry.how, /never re-hosted/i, `${entry.url} must state that footage is not re-hosted`);
    assert.doesNotMatch(entry.url, /(?:fbcdn\.net|tiktokcdn\.com|\.mp4)(?:[?#]|$)/i, "signed media URLs expire and must not enter the committed data");
  }
});

const fixturePhoto = (id, local, sha256) => ({
  id,
  name: id,
  description: "",
  price: 700,
  photo: { local, thumb: `${local}.400.jpg`, width: 800, height: 800, alt: id, ...(sha256 ? { sha256 } : {}) },
});

test("dish selection skips different paths with the same photograph digest", () => {
  const source = {
    families: [
      { id: "alpha", sections: [{ id: "one", items: [
        fixturePhoto("alpha-a", "/menu/a.jpg", "a".repeat(64)),
        fixturePhoto("alpha-b", "/menu/b.jpg", "a".repeat(64)),
        fixturePhoto("alpha-c", "/menu/c.jpg", "c".repeat(64)),
      ] }] },
      { id: "beta", sections: [{ id: "two", items: [
        fixturePhoto("beta-a", "/menu/d.jpg", "d".repeat(64)),
      ] }] },
    ],
  };
  assert.deepEqual(
    dishPhotographs(source, { limit: 3 }).map((dish) => dish.id),
    ["alpha-a", "beta-a", "alpha-c"],
    "the repeated digest must be skipped while selection continues to a unique photograph",
  );
});

test("gallery tally counts digest-unique files rather than unique paths", () => {
  const source = {
    families: [{ id: "alpha", sections: [{ id: "one", items: [
      fixturePhoto("alpha-a", "/menu/a.jpg", "a".repeat(64)),
      fixturePhoto("alpha-b", "/menu/b.jpg", "a".repeat(64)),
      fixturePhoto("alpha-c", "/menu/c.jpg", "c".repeat(64)),
    ] }] }],
  };
  const tally = galleryTally(source, dishPhotographs(source, { limit: 10 }));
  assert.equal(tally.withPhoto, 3, "all three photographed rows still count as dishes");
  assert.equal(tally.files, 2, "two byte streams must not be reported as three photographs");
});

test("missing or invalid digests safely fall back to local-path identity", () => {
  const source = {
    families: [{ id: "alpha", sections: [{ id: "one", items: [
      fixturePhoto("alpha-a", "/menu/shared.jpg"),
      fixturePhoto("alpha-b", "/menu/shared.jpg"),
      fixturePhoto("alpha-c", "/menu/other.jpg", "not-a-digest"),
      fixturePhoto("alpha-d", "/menu/third.jpg", "d".repeat(64)),
    ] }] }],
  };
  assert.deepEqual(
    dishPhotographs(source, { limit: 10 }).map((dish) => dish.id),
    ["alpha-a", "alpha-c", "alpha-d"],
    "path fallback must deduplicate a repeated path without guessing that different paths share bytes",
  );
});

test("the real eighteen-dish selection contains eighteen independent SHA-256 byte streams", async () => {
  const picks = dishPhotographs(menu, { limit: 18 });
  assert.equal(picks.length, 18);
  const hashes = await Promise.all(picks.map((pick) => sha256(join(ROOT, "site/public", pick.src))));
  assert.equal(new Set(hashes).size, 18, `selected ${new Set(hashes).size} unique byte streams for 18 tiles`);
});

test("the real gallery tally matches an independent hash of every photographed row", async () => {
  const rows = photographedRows(menu);
  const hashes = await Promise.all(rows.map(({ item }) => sha256(join(ROOT, "site/public", item.photo.local))));
  const uniqueBytes = new Set(hashes).size;
  const tally = galleryTally(menu, dishPhotographs(menu, { limit: 18 }));
  assert.equal(tally.withPhoto, 141, "the row count remains the number of photographed dishes");
  assert.equal(tally.files, uniqueBytes, `tally reports ${tally.files}, independent hashing found ${uniqueBytes}`);
});

test("a decode that settles after Close cannot reopen the viewer", async (t) => {
  const decoding = deferred();
  const h = mountGallery(t, { reducedMotion: true, decode: () => decoding.promise });
  h.openTile();
  h.close.click();
  assert.equal(h.box.hidden, true);
  decoding.resolve();
  await Promise.resolve();
  assert.equal(h.box.hidden, true, "the stale decode completion must not show the closed dialog");
  assert.equal(h.classes.has("gal-open"), false, "the stale completion must not restore the open-page class");
});

test("an already-queued open belt cannot reopen the viewer after Close", (t) => {
  const h = mountGallery(t, { reducedMotion: true, decode: () => new Promise(() => {}) });
  h.openTile();
  const belt = h.timeout(450);
  h.close.click();
  h.fireTimeout(belt);
  assert.equal(h.box.hidden, true, "the stale belt callback must not show the closed dialog");
});

test("unmount clears every tracked timeout and invalidates a pending decode", async (t) => {
  const decoding = deferred();
  const h = mountGallery(t, { decode: () => decoding.promise, transitions: transitionQueue() });
  h.openTile();
  const belt = h.timeout(450);
  h.close.click();
  const morphBelt = h.timeout(1500);
  h.play.click();
  const reel = h.timeout(3600);
  h.stop();
  assert.equal(h.timers.size, 0, "teardown must cancel open, morph and reel timeouts, not only the current reel timer");
  decoding.resolve();
  await Promise.resolve();
  h.fireTimeout(belt);
  h.fireTimeout(morphBelt);
  h.fireTimeout(reel);
  assert.equal(h.box.hidden, true, "queued callbacks must not mutate the unmounted viewer");
  assert.equal(h.classes.has("gal-open"), false);
});

test("an older transition finishing after Close cannot strip the closing morph", async (t) => {
  const transitions = transitionQueue();
  const h = mountGallery(t, { transitions, decode: () => new Promise(() => {}) });
  h.openTile();
  h.runTimeout(450);
  h.close.click();
  assert.equal(transitions.items.length, 2, "open and close each start a real transition");
  const destination = h.tileImages[0];
  assert.equal(destination.style.viewTransitionName, "gal-active");
  transitions.items[0].resolve();
  await Promise.resolve();
  assert.equal(destination.style.viewTransitionName, "gal-active", "the old finished callback must not clear the new morph");
  assert.equal(h.classes.has("is-morph"), true, "the old finished callback must not remove the active morph class");
});

test("replacement invalidates pending decode and belt callbacks from the old mount", async (t) => {
  const classes = new Set();
  const decoding = deferred();
  const old = mountGallery(t, { reducedMotion: true, decode: () => decoding.promise, classes });
  old.openTile();
  const belt = old.timeout(450);
  old.stop();
  const replacement = mountGallery(t, { reducedMotion: true, classes });
  replacement.openTile();
  assert.equal(replacement.box.hidden, false);
  decoding.resolve();
  await Promise.resolve();
  old.fireTimeout(belt);
  assert.equal(old.box.hidden, true, "the detached viewer must stay closed after replacement");
  assert.equal(replacement.box.hidden, false, "the replacement viewer must remain open");
  assert.equal(classes.has("gal-open"), true, "old callbacks must not alter the replacement's page state");
});
