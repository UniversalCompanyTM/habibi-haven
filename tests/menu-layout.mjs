import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import * as menuProbe from "../scripts/menu-runtime-probe.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const read = (path) => readFileSync(new URL(path, `file://${ROOT.replaceAll("\\", "/")}/`), "utf8");
const css = read("site/src/styles/global.css").replace(/\/\*[\s\S]*?\*\//g, "");
const explorer = read("site/src/components/MenuExplorer.astro");
const dish = read("site/src/components/DishCard.astro");
const menuPage = read("site/src/pages/menu.astro");
const menuProbeSource = read("scripts/menu-runtime-probe.mjs");

// These are source/DOM contracts, not screenshots: each assertion names the layout invariant a browser
// depends on. The runtime probe in scripts/menu-runtime-probe.mjs measures the resulting boxes later.
function rules() {
  return [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((match) => ({
    selectors: match[1].split(",").map((s) => s.trim().replace(/\s+/g, " ")),
    body: match[2],
  }));
}

function rule(selector) {
  const wanted = selector.split(",").map((s) => s.trim().replace(/\s+/g, " "));
  const found = rules().find((candidate) => wanted.every((part) => candidate.selectors.includes(part)));
  assert.ok(found, `missing CSS rule for ${selector}`);
  return found.body;
}

function declaration(body, property) {
  const match = new RegExp(`(?:^|;)\\s*${property}\\s*:\\s*([^;]+)`, "i").exec(body);
  assert.ok(match, `missing ${property} declaration`);
  return match[1].trim();
}

function explorerFunction(name) {
  const match = new RegExp(`const ${name} = [\\s\\S]*?\\n    };`).exec(explorer);
  assert.ok(match, `missing explorer function ${name}`);
  return match[0];
}

test("sticky bar and anchor offsets both reserve the measured header and bar", () => {
  const top = declaration(rule(".explorer__bar"), "top");
  const anchor = declaration(rule(".explorer .group"), "scroll-margin-top");
  assert.match(top, /var\(--nav-h\)/, "the sticky bar must follow the live header height");
  assert.doesNotMatch(top, /^\d+(?:\.\d+)?rem$/, "a fixed top overlaps a wrapping header");
  assert.match(anchor, /var\(--nav-h\)[\s\S]*var\(--bar-h\)/, "deep links must clear both sticky bands");
});

test("filter badge is painted before the bar height is measured", () => {
  const paintFold = explorerFunction("paintFold");
  const badge = paintFold.indexOf("paintBadge()");
  const measure = paintFold.indexOf("measureBar()");
  assert.ok(badge >= 0 && measure >= 0, "fold measurement needs both the badge and the bar");
  assert.ok(badge < measure, "a newly visible badge can change wrapping after the old height was saved");
  assert.match(explorerFunction("measureBar"), /getBoundingClientRect\(\)\.height/);
});

test("filter/search state changes resample the sticky offset", () => {
  const apply = explorerFunction("apply");
  const badge = apply.indexOf("paintBadge()");
  const measure = apply.indexOf("measureBar()");
  assert.ok(badge >= 0, "apply must update the active-filter badge");
  assert.ok(measure > badge, "live count/badge changes can resize the bar; --bar-h must be refreshed afterwards");
});

test("cards and their controls clear the sticky bands when scrolled into view", () => {
  const candidates = rules().filter((candidate) =>
    candidate.selectors.some(
      (selector) => selector.includes("[data-groups]") && selector.includes("[data-card]"),
    ) && /scroll-margin-top\s*:/.test(candidate.body),
  );
  assert.ok(candidates.length, "card/focus scrolling has no sticky clearance contract");
  for (const candidate of candidates) {
    const offset = declaration(candidate.body, "scroll-margin-top");
    assert.match(offset, /var\(--nav-h\)[\s\S]*var\(--bar-h\)/);
  }
  const selector = candidates[0].selectors.join(" ");
  for (const control of ["button", "input", "select"]) {
    assert.ok(selector.includes(control), `${control} controls must share the card clearance rule`);
  }
});

test("every dish frame keeps the dimensions supplied by the kitchen data", () => {
  const frame = /<div\s+class=\{`frame[\s\S]*?>\s*\{/.exec(dish)?.[0];
  assert.ok(frame, "DishCard must render a frame");
  assert.doesNotMatch(frame, /isPlaceholder\s*\?\s*null/, "placeholder frames must not discard photo.width/height");
  assert.match(
    frame,
    /aspect-ratio:\s*\$\{photo.width\}\s*\/\s*\$\{photo.height\}/,
    "the frame ratio must come from the mirrored file metadata",
  );
  assert.match(menuPage, /<MenuExplorer\s+featuredFirst\s*\/>/, "the menu route must keep using the shared explorer");
});

test("the card grid can shrink below its preferred column without horizontal overflow", () => {
  const columns = declaration(rule(".deck"), "grid-template-columns");
  assert.match(columns, /minmax\(min\(100%,\s*280px\),\s*1fr\)/);
  assert.match(rule(".frame"), /overflow:\s*hidden/);
  assert.match(rule(".frame img"), /object-fit:\s*(?:cover|contain)/);
});

test("filtered cards, rooms, sections, and disclosures leave layout when hidden", () => {
  for (const selector of [
    ".card[hidden]",
    ".explorer .subgroup[hidden],\n.explorer .group[hidden],\n.empty-note[hidden]",
    ".explorer__filters[hidden]",
    ".filters-toggle[hidden]",
    ".filters-toggle__n[hidden]",
  ]) {
    assert.match(rule(selector), /display:\s*none/);
  }
});

test("control hit ownership accepts a painted child but never an ancestor", () => {
  const visibleChild = { name: "visible child" };
  const invisibleChild = { name: "invisible child" };
  const control = { contains: (el) => el === visibleChild || el === invisibleChild };
  const ancestor = { contains: (el) => el === control || el === visibleChild };
  const painted = (el) => el === visibleChild;

  assert.equal(menuProbe.ownsControlHit(control, control, painted), true, "the control itself owns its hit");
  assert.equal(menuProbe.ownsControlHit(control, visibleChild, painted), true, "a control's visible child owns its hit");
  assert.equal(menuProbe.ownsControlHit(control, invisibleChild, painted), false, "an unpainted child is not a visible target");
  assert.equal(menuProbe.ownsControlHit(control, ancestor, painted), false, "an ancestor must not pass through a pointer-events:none control");
  assert.equal(menuProbe.ownsControlHit(control, null, painted), false, "a missed hit is not ownership");
});

test("focused control clearance rejects a target beneath either sticky band", () => {
  const bands = [{ bottom: 76 }, { bottom: 184 }];
  assert.equal(menuProbe.clearsStickyBands({ top: 184 }, bands), true, "touching the lower band is clear");
  assert.equal(menuProbe.clearsStickyBands({ top: 220 }, bands), true, "a target below both bands is clear");
  assert.equal(menuProbe.clearsStickyBands({ top: 183 }, bands), false, "one pixel beneath the bar is not clear");
  assert.equal(menuProbe.clearsStickyBands({ top: 120 }, bands), false, "clearing the nav but not the bar is not clear");
  assert.equal(menuProbe.clearsStickyBands({ top: 75 }, bands), false, "clearing the bar but not the nav is not clear");
});

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const assertGeneratedBody = (body) => assert.doesNotThrow(() => new AsyncFunction(body));

function runtimeReport(controls = [], tabTargets = []) {
  return {
    viewport: [1440, 900],
    total: 3,
    visible: 3,
    stateOk: true,
    count: "3 of 3 items",
    overflowX: 0,
    bar: {
      position: "sticky", top: 76, expectedTop: 76, bottom: 184, height: 108,
      savedHeight: 108, heightDrift: 0, followsHeader: true, stickyAtDepth: true,
    },
    overlaps: [], overlapCount: 0, textOutside: [], clippedText: [], imageOutside: [],
    badFrameRatio: [], sortViolations: [], anchor: null, controls, tabTargets,
  };
}

async function auditWithControl(control) {
  let viewport = { width: 0, height: 0 };
  const results = [];
  const failures = [];
  const args = {
    results,
    failures,
    setViewport: async (metrics) => { viewport = metrics; },
    goto: async () => {},
    evaluate: async () => ({ ...runtimeReport([control]), viewport: [viewport.width, viewport.height] }),
    drain: () => ({ errors: [], warnings: [] }),
    pressKey: async () => {},
  };
  await menuProbe.auditMenuLayout(args);
  return failures;
}

test("the runtime audit fails a focused control left beneath the sticky bar", async () => {
  const failures = await auditWithControl({
    name: "Add to table", tag: "button", ownsHit: true, obstructed: false,
    focused: true, clear: false, hit: "button.btn",
  });
  assert.ok(failures.some((failure) => failure.includes("under sticky bar")), failures.join("\n"));
});

test("the runtime audit fails when focus did not reach the intended control", async () => {
  const failures = await auditWithControl({
    name: "Accompaniment", tag: "label", ownsHit: true, obstructed: false,
    focused: false, clear: true, hit: "span",
  });
  assert.ok(failures.some((failure) => failure.includes("not focused")), failures.join("\n"));
});

test("the runtime audit fails when an ancestor owns a focused control's hit", async () => {
  const failures = await auditWithControl({
    name: "Add to table", tag: "button", ownsHit: false, obstructed: false,
    focused: true, clear: true, hit: "article.card",
  });
  assert.ok(failures.some((failure) => failure.includes("hit article.card")), failures.join("\n"));
});

test("the runtime audit fails a focused control that remains outside the viewport", async () => {
  const failures = await auditWithControl({
    name: "Add to table", tag: "button", ownsHit: true, obstructed: false,
    focused: true, clear: true, onScreen: false, hit: "button.btn",
  });
  assert.ok(failures.some((failure) => failure.includes("outside viewport")), failures.join("\n"));
});

test("the geometry probe reads the explorer-local bar height before the root fallback", () => {
  const local = menuProbeSource.indexOf('getComputedStyle(bar.parentElement).getPropertyValue("--bar-h")');
  const root = menuProbeSource.indexOf('rootStyle.getPropertyValue("--bar-h")');
  assert.ok(local >= 0 && root >= 0, "both the measured local value and root fallback must be available");
  assert.ok(local < root, "7.6rem on the root must not override the explorer's measured pixel height");
});

test("each Menu probe state closes the filter panel unless that state explicitly opens it", () => {
  const reset = /const reset = \(\) => \{[\s\S]*?\n    \};/.exec(menuProbeSource)?.[0];
  assert.ok(reset, "missing probe reset");
  assert.match(reset, /toggle\.getAttribute\("aria-expanded"\) === "true"[\s\S]*?toggle\.click\(\)/,
    "an open phone panel must not leak into searched/sorted geometry states");
});

test("Tab preparation distinguishes lost focus from residual smooth scrolling", async () => {
  const failures = [];
  let body = "";
  const result = await menuProbe.auditMenuTabTarget({
    target: { cardId: "karak-chai", kind: "add", name: "Add to table" },
    label: "/menu phone",
    failures,
    evaluate: async (source) => {
      body = source;
      return { ready: false, focused: false, atTop: false, scrollY: 75, previous: "Search" };
    },
    pressKey: async () => {},
  });
  assert.equal(result, null);
  assert.match(body, /focused: document\.activeElement === previous/);
  assert.match(body, /atTop: scrollY === 0/);
  assert.ok(failures.some((failure) => failure.includes("focus")), failures.join("\n"));
  assert.ok(failures.some((failure) => failure.includes("scrollY 75")), failures.join("\n"));
});

test("the Tab preparation uses the preceding visible stop without centering the target", async () => {
  const bodies = [];
  const failures = [];
  const result = await menuProbe.auditMenuTabTarget({
    target: { cardId: "karak-chai", kind: "accompaniment", name: "Rice" },
    label: "/menu phone initial",
    failures,
    evaluate: async (source) => {
      bodies.push(source);
      return bodies.length === 1 ? { ready: true } : { focused: true, ownsHit: true, clear: true };
    },
    pressKey: async () => {},
  });
  assert.equal(result?.focused, true, failures.join("\n"));
  assert.equal(bodies.length, 2);
  const [prepareBody, measureBody] = bodies;
  assertGeneratedBody(prepareBody);
  assertGeneratedBody(measureBody);
  assert.match(prepareBody, /stops\.indexOf\(focus\)/, "Tab must use the actual focusable stop");
  assert.match(prepareBody, /previous\.focus\(\{ preventScroll: true \}\)/, "preparation must not scroll the preceding stop into view");
  assert.match(prepareBody, /window\.scrollTo\(\{ top: 0, behavior: "instant" \}\)/, "the target must start without pre-centering");
  assert.match(prepareBody, /document\.activeElement === previous && scrollY === 0/, "preparation must start at the top");
  assert.doesNotMatch(prepareBody, /scrollIntoView|\.focus\(\)/, "the target must not be pre-scrolled or pre-focused");
  assert.doesNotMatch(measureBody, /scrollIntoView|\.focus\(\)/, "measurement must not alter focus or scroll position");
});

test("the Tab audit uses an injected real key and returns the resulting measurement", async () => {
  const keys = [];
  const sample = {
    name: "Add to table", tag: "button", ownsHit: true, obstructed: false,
    focused: true, clear: true, hit: "button.btn",
  };
  const replies = [{ ready: true }, sample];
  const failures = [];
  const result = await menuProbe.auditMenuTabTarget({
    target: { cardId: "karak-chai", kind: "add", name: "Add to table" },
    label: "/menu phone initial",
    failures,
    evaluate: async () => replies.shift(),
    pressKey: async (key) => keys.push(key),
  });
  assert.equal(result, sample);
  assert.deepEqual(keys, ["Tab"], "Tab must be a real browser key, not a synthetic KeyboardEvent");
  assert.deepEqual(replies, [], "the audit must prepare once and measure once");
  assert.deepEqual(failures, []);
});

test("Menu filter writes preserve the shared table parameter already in the address", () => {
  assert.match(explorer, /const p = new URLSearchParams\(location\.search\);/, "filter writes must start from the current query, not an empty one");
});

test("selecting menu order restores each deck's captured server order", () => {
  const captured = /const decks = [\s\S]*?const menuOrder = new Map<HTMLElement, HTMLElement\[\]>[\s\S]*?\]\)\);/.exec(explorer);
  assert.ok(captured, "the original card nodes must be captured before any sort mutates a deck");
  assert.match(captured[0], /querySelectorAll<HTMLElement>\("\.deck"\)/,
    "the snapshot must be keyed by the same deck elements that sortDeck restores");
  const sortDeck = explorerFunction("sortDeck");
  assert.doesNotMatch(sortDeck, /if \(state\.sort === "menu"\) return;/, "menu order cannot be a no-op after another sort has moved the cards");
  assert.match(sortDeck, /menuOrder\.get\(deck\)\?\.forEach\(\(node\) => deck\.append\(node\)\);/,
    "menu order must put the original nodes back, not clone or retain the ranked order");
});

test("Menu filter writes preserve router history state", () => {
  const writeUrl = explorerFunction("writeUrl");
  assert.match(writeUrl, /history\.replaceState\(history\.state,/, "null history state turns Back into a URL-only change");
  assert.doesNotMatch(writeUrl, /history\.replaceState\(null,/);
});

test("mobile Menu focus targets, including filter chips, reserve clearance for the fixed action dock", () => {
  assert.match(css, /@media \(max-width: 720px\) \{\s*body \{[^{}]*\}\s*\.explorer :is\([^{]+\) \{\s*scroll-margin-bottom:\s*calc\(4\.75rem \+ env\(safe-area-inset-bottom, 0px\) \+ 1rem\);/,
    "a focused filter chip or deep card control must be able to scroll above the bottom dock, not merely clear the top bar");
});

test("the sticky-depth probe reaches the sticky threshold even when search leaves one short result", () => {
  assert.match(menuProbeSource, /deepestCard\.scrollIntoView\(\{ block: "start", behavior: "instant" \}\)/,
    "centering the only search result can leave the filter bar below its sticky threshold on a tall tablet");
});

test("cleared Menu controls remove their own query parameters without dropping other state", () => {
  const writeUrl = explorerFunction("writeUrl");
  for (const parameter of ["q", "tag", "band", "sort"]) {
    assert.match(writeUrl, new RegExp(`else p\\.delete\\("${parameter}"\\)`),
      `a cleared ${parameter} must not remain in the shareable URL`);
  }
  assert.match(writeUrl, /new URLSearchParams\(location\.search\)/, "unrelated parameters must survive");
  assert.match(writeUrl, /state\.room/, "the room hash must survive filter and sort changes");
});

test("the Menu state lifecycle audit exercises real sort restoration and URL cleanup", async () => {
  const expectedTable = "2%7Ckarak-chaix1";
  const report = {
    total: 243,
    visible: 243,
    count: "243 of 243 items",
    sortChanged: true,
    menuOrderRestored: true,
    orderMismatches: [],
    filtersClear: true,
    searchValue: "",
    sortValue: "menu",
    params: { q: null, tag: null, band: null, sort: null, t: "2|karak-chaix1", keep: "1" },
    hash: "#morning",
  };
  const calls = [];
  const results = [];
  const failures = [];
  const summary = await menuProbe.auditMenuStateLifecycle({
    expectedTable,
    goto: async (path) => calls.push(["goto", path]),
    setViewport: async (metrics) => calls.push(["viewport", metrics.width]),
    evaluate: async (body) => {
      calls.push(["evaluate"]);
      assertGeneratedBody(body);
      return report;
    },
    results,
    failures,
    drain: () => ({ errors: [], warnings: [] }),
  });
  assert.deepEqual(failures, []);
  assert.equal(summary.ok, true);
  assert.equal(results.length, 1);
  assert.equal(calls[0][0], "viewport");
  assert.match(calls[1][1], /\/menu\?t=.*keep=1#morning$/);
});

test("the Menu state lifecycle audit rejects stale filters, lost table state, and unrestored order", async () => {
  const expectedTable = "encoded-table-fixture";
  const valid = {
    total: 243, visible: 243, count: "243 of 243 items", sortChanged: true,
    menuOrderRestored: true, orderMismatches: [], filtersClear: true,
    searchValue: "", sortValue: "menu",
    params: { q: null, tag: null, band: null, sort: null, t: expectedTable, keep: "1" },
    hash: "#morning",
  };
  for (const mutate of [
    (report) => { report.params.q = "chai"; },
    (report) => { report.params.sort = "cheap"; },
    (report) => { report.params.t = null; },
    (report) => { report.hash = ""; },
    (report) => { report.menuOrderRestored = false; report.orderMismatches = ["breakfast"]; },
    (report) => { report.visible = 4; },
    (report) => { report.sortChanged = false; },
  ]) {
    const report = structuredClone(valid);
    mutate(report);
    const failures = [];
    await menuProbe.auditMenuStateLifecycle({
      expectedTable,
      goto: async () => {},
      setViewport: async () => {},
      evaluate: async () => report,
      results: [],
      failures,
      drain: () => ({ errors: [], warnings: [] }),
    });
    assert.ok(failures.length, `invalid lifecycle report was accepted: ${JSON.stringify(report)}`);
  }
});

test("the browser harness invokes the Menu state lifecycle audit", async () => {
  const runtime = await readFileSync(new URL("../scripts/verify-runtime.mjs", import.meta.url), "utf8");
  assert.ok(/import \{ auditMenuLayout, auditMenuStateLifecycle \} from "\.\/menu-runtime-probe\.mjs";/.test(runtime),
    "the runtime harness must import the lifecycle audit");
  assert.ok(/await auditMenuStateLifecycle\(\{[\s\S]*?expectedTable:[\s\S]*?\}\);/.test(runtime),
    "the runtime harness must invoke the lifecycle audit with an encoded table fixture");
});

test("the runtime audit appends real Tab measurements to the blocked-control checks", async () => {
  const targets = [
    { cardId: "karak-chai", kind: "add", name: "Add to table" },
    { cardId: "karak-chai", kind: "accompaniment", name: "Rice" },
  ];
  const results = [];
  const failures = [];
  const keys = [];
  const logs = [];
  const states = [];
  let viewport = { width: 0, height: 0 };
  let state = "";
  const args = {
    results,
    failures,
    setViewport: async (metrics) => { viewport = metrics; },
    goto: async () => {},
    evaluate: async (body) => {
      if (!body.includes("const state =")) {
        if (body.includes("document.activeElement === previous")) return { ready: true };
        const target = JSON.parse(/const target = ([^\n]+);/.exec(body)[1]);
        return {
          name: target.name, tag: target.kind === "add" ? "button" : "label", method: "tab",
          ownsHit: true, obstructed: false, focused: true, clear: false,
          hit: target.kind === "add" ? "button.btn" : "span",
        };
      }
      const match = /const state = ([^\n]+);/.exec(body);
      assert.ok(match, "evaluate must receive the generated report or Tab bodies");
      assertGeneratedBody(body);
      assert.match(body, /focus\.focus\(\)/, "representatives must use real focus-driven scrolling");
      assert.doesNotMatch(body.slice(body.indexOf("const painted")), /scrollIntoView/, "controls must not be pre-centered");
      assert.match(body, /kind: "add"/, "Add must be a Tab target where available");
      assert.match(body, /kind: "accompaniment"/, "accompaniment must be a Tab target where available");
      state = JSON.parse(match[1]).name;
      states.push(state);
      return {
        ...runtimeReport([], targets),
        viewport: [viewport.width, viewport.height],
        filtersOpen: ["searched", "filtered"].includes(state),
      };
    },
    drain: () => {
      assert.equal(keys.length, targets.length * (logs.length + 1), "browser logs must be drained after the real Tab keys");
      const entry = { errors: ["Tab browser error"], warnings: [] };
      logs.push(entry);
      return entry;
    },
    pressKey: async (key) => keys.push(key),
  };
  await menuProbe.auditMenuLayout(args);
  assert.equal(keys.length, 2 * 3 * 4, "each viewport/state must Tab to Add and accompaniment where available");
  assert.ok(keys.every((key) => key === "Tab"));
  assert.ok(failures.some((failure) => failure.includes("under sticky bar")), failures.join("\n"));
  assert.equal(results.length, 3 * 4);
  assert.equal(logs.length, results.length, "each state must drain browser logs after Tab");
  assert.deepEqual([...new Set(states)], ["initial", "searched", "filtered", "sorted"]);
  for (const result of results) {
    assert.equal(result.value.controls.length, 2);
    assert.ok(result.value.controls.every((control) => control.method === "tab"));
    assert.equal(result.value.filtersOpen, ["searched", "filtered"].some((name) => result.path.endsWith(` ${name}`)));
  }
  assert.equal(failures.filter((failure) => failure.includes("Tab browser error")).length, results.length);
});
