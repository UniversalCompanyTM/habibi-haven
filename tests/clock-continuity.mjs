#!/usr/bin/env node
// clock-continuity.mjs — the ambient clock must advance every second, not every twenty.
// Dependency-free: the real hours curve and rig writer run against a tiny deterministic browser edge.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  nairobiHourFloat,
  nightAmount,
  rigFor,
  sunAmount,
} from "../site/src/lib/hours.mjs";
import { auditClockContinuity } from "../scripts/clock-runtime-probe.mjs";
import { rigValues } from "../site/src/scenes/rig.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SECOND = 1 / 3600;
const near = (actual, expected, tolerance = 1e-9) =>
  Math.abs(actual - expected) <= tolerance;
const forward = (from, to) => (to - from + 24) % 24;

const rigSource = await readFile(join(ROOT, "site/src/lib/rig-client.mjs"), "utf8");
const css = await readFile(join(ROOT, "site/src/styles/tokens.css"), "utf8");

/** Run the real writer with only its DOM/timer edge replaced; the Nairobi curve remains real. */
function rigHarness({ iso = "2026-11-14T20:59:59Z", calm = false } = {}) {
  let now = Date.parse(iso);
  let nextTimer = 1;
  const intervals = new Map();
  const timeouts = new Map();
  const properties = new Map();
  const attributes = new Map();
  const writes = [];
  const events = [];
  const motionListeners = new Set();
  const motion = {
    matches: calm,
    addEventListener(type, fn) { if (type === "change") motionListeners.add(fn); },
    removeEventListener(type, fn) { if (type === "change") motionListeners.delete(fn); },
  };
  let rafCount = 0;

  const root = {
    style: {
      setProperty(name, value) {
        properties.set(name, value);
        writes.push([name, value]);
      },
      getPropertyValue(name) {
        return properties.get(name) ?? "";
      },
    },
    setAttribute(name, value) { attributes.set(name, value); },
    removeAttribute(name) { attributes.delete(name); },
    hasAttribute(name) { return attributes.has(name); },
  };

  function listeners() {
    const bound = new Map();
    return {
      addEventListener(type, fn) {
        if (!bound.has(type)) bound.set(type, new Set());
        bound.get(type).add(fn);
      },
      removeEventListener(type, fn) { bound.get(type)?.delete(fn); },
      dispatchEvent(event) {
        for (const fn of [...(bound.get(event.type) ?? [])]) fn(event);
        return true;
      },
      count(type) { return bound.get(type)?.size ?? 0; },
    };
  }

  const document = {
    ...listeners(),
    documentElement: root,
    hidden: false,
  };
  const window = listeners();
  document.addEventListener("hh:hour", (event) => events.push(event.detail));

  const scope = {
    document,
    CustomEvent,
    matchMedia: () => motion,
    getComputedStyle: () => ({ getPropertyValue: (name) => properties.get(name) ?? "" }),
    setInterval(fn, everyMs) {
      const id = nextTimer++;
      intervals.set(id, { fn, everyMs });
      return id;
    },
    clearInterval(id) { intervals.delete(id); },
    setTimeout(fn, delay) {
      const id = nextTimer++;
      timeouts.set(id, { fn, delay });
      return id;
    },
    clearTimeout(id) { timeouts.delete(id); },
    addEventListener: window.addEventListener,
    removeEventListener: window.removeEventListener,
    requestAnimationFrame() { rafCount += 1; return rafCount; },
    cancelAnimationFrame() {},
    DIAL_MAX: 24,
    DIAL_MIN: 0,
    nairobiHourFloat: (input) => nairobiHourFloat(input ?? new Date(now)),
    nightAmount,
    rigFor,
    sunAmount,
  };

  // Node has no browser module loader. Remove only ESM syntax and inject the real imported functions.
  const executable = rigSource
    .replace(/^import .*;$/gm, "")
    .replace(/^export /gm, "");
  const api = new Function(...Object.keys(scope), `${executable}\nreturn { applyHour, startAmbient, releaseToNow, liveHour };`)(
    ...Object.values(scope),
  );

  const value = (name) => Number(properties.get(name));
  return {
    api,
    root,
    document,
    window,
    intervals,
    timeouts,
    events,
    writes,
    value,
    rafCount: () => rafCount,
    motionListenerCount: () => motionListeners.size,
    setReducedMotion(matches) {
      motion.matches = matches;
      for (const fn of [...motionListeners]) fn({ matches });
    },
    setTime(instant) { now = Date.parse(instant); },
    tick() {
      for (const timer of intervals.values()) timer.fn();
    },
    advance(instant) {
      now = Date.parse(instant);
      this.tick();
    },
    finishManual() {
      for (const [id, timer] of [...timeouts]) {
        timeouts.delete(id);
        timer.fn();
      }
    },
  };
}

function rule(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return css.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`))?.[1] ?? "";
}

function transition(block, property) {
  const declaration = block.match(/(?:^|;)\s*transition:\s*([^;]+)/)?.[1]?.trim();
  if (!declaration || declaration === "none") return declaration === "none" ? "none" : null;
  const part = declaration.split(",").map((value) => value.trim().split(/\s+/))
    .find((tokens) => tokens[0] === property);
  return part ? { duration: part[1], timing: part[2] } : null;
}

// The computed-value half of a registered <number> transition: at 50% of a linear one-second
// transition the browser exposes the numeric midpoint. An unregistered/untransitioned hour exposes
// its new specified value immediately. This keeps the browser semantics in the test, not in production.
function computedMidpoint(property, from, to) {
  return transition(rule("html[data-ambient]"), property) ? (from + to) / 2 : to;
}

let passed = 0;
const failures = [];
async function check(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`  ok   ${name}`);
  } catch (error) {
    failures.push({ name, message: error.message });
    console.log(`  FAIL ${name}\n       ${error.message}`);
  }
}

console.log("clock continuity — one second, midnight through noon and back");

await check("the browser harness exercises both normal and reduced-motion clock contracts", async () => {
  const runtime = await readFile(join(ROOT, "scripts/verify-runtime.mjs"), "utf8");
  const calls = runtime.match(/auditClockContinuity\(\{ evaluate, goto, results, failures, drain \}\)/g) ?? [];
  assert.equal(calls.length, 2, "the deterministic clock probe must run once normally and once under reduced motion");
  assert.match(runtime, /prefers-reduced-motion", value: "reduce" \}\] \}\);\s*(?:\/\/[^\n]*\n\s*)*await auditClockContinuity/,
    "the second run must occur after reduced-motion emulation, not inherit the first run's preference");
});

await check("Nairobi decimal hours keep one-second resolution across midnight, noon and midnight", () => {
  const cases = [
    ["2026-11-13T20:59:58Z", 23 + 59 / 60 + 58 / 3600],
    ["2026-11-13T20:59:59Z", 23 + 59 / 60 + 59 / 3600],
    ["2026-11-13T21:00:00Z", 0],
    ["2026-11-14T08:59:59Z", 11 + 59 / 60 + 59 / 3600],
    ["2026-11-14T09:00:00Z", 12],
    ["2026-11-14T09:00:01Z", 12 + 1 / 3600],
    ["2026-11-14T20:59:59Z", 23 + 59 / 60 + 59 / 3600],
    ["2026-11-14T21:00:00Z", 0],
  ];
  for (const [iso, expected] of cases) {
    const actual = nairobiHourFloat(new Date(iso));
    assert.ok(near(actual, expected), `${iso}: expected ${expected}, got ${actual}`);
    const next = nairobiHourFloat(new Date(Date.parse(iso) + 1000));
    assert.ok(near(forward(actual, next), SECOND, 1e-10), `${iso}: next second did not advance 1/3600 h`);
  }
});

await check("night and sun remain bounded complements with no one-second discontinuity", () => {
  assert.equal(nightAmount(0), 1);
  assert.ok(near(nightAmount(12), 0.06555555555555556), "noon must sit on the hand-checked 11:00–15:30 segment");
  assert.equal(nightAmount(24), 1);
  for (const iso of [
    "2026-11-13T20:59:58Z",
    "2026-11-14T03:00:00Z",
    "2026-11-14T06:00:00Z",
    "2026-11-14T09:00:00Z",
    "2026-11-14T14:30:00Z",
    "2026-11-14T20:59:59Z",
  ]) {
    const hour = nairobiHourFloat(new Date(iso));
    const next = nairobiHourFloat(new Date(Date.parse(iso) + 1000));
    const night = nightAmount(hour);
    const nextNight = nightAmount(next);
    assert.ok(night >= 0 && night <= 1 && nextNight >= 0 && nextNight <= 1, `${iso}: night left [0,1]`);
    assert.ok(near(night + sunAmount(hour), 1), `${iso}: night + sun is not one`);
    assert.ok(Math.abs(nextNight - night) < 0.0001, `${iso}: night jumped ${Math.abs(nextNight - night)} in one second`);
  }
});

await check("the ambient writer defaults to one interval per second and emits every second across the day", () => {
  const h = rigHarness();
  const stop = h.api.startAmbient();
  try {
    assert.equal(h.intervals.size, 1, "ambient must own one bounded timer");
    assert.equal([...h.intervals.values()][0].everyMs, 1000, "default ambient cadence must be 1000ms");
    assert.equal(h.root.hasAttribute("data-ambient"), true, "normal motion must enable interpolation");
    assert.equal(h.events.length, 1, "startup must publish the current hour");
    assert.ok(near(h.value("--hour"), 23 + 59 / 60 + 59 / 3600, 0.00006));

    const seconds = [
      ["2026-11-13T21:00:00Z", 0], // 00:00:00
      ["2026-11-13T21:00:01Z", SECOND], // 00:00:01
      ["2026-11-14T08:59:59Z", 11 + 59 / 60 + 59 / 3600], // 11:59:59
      ["2026-11-14T09:00:00Z", 12], // 12:00:00
      ["2026-11-14T09:00:01Z", 12 + SECOND], // 12:00:01
      ["2026-11-14T20:59:59Z", 23 + 59 / 60 + 59 / 3600], // 23:59:59
      ["2026-11-14T21:00:00Z", 0], // 00:00:00
    ];
    for (const [iso, wanted] of seconds) {
      h.advance(iso);
      const after = h.value("--hour");
      assert.ok(near(after, wanted, 0.00006), `${iso}: --hour target was ${after}, expected ${wanted}`);
      assert.ok(near(h.events.at(-1).hour, wanted, 0.00006), `${iso}: hh:hour disagrees with the target`);
      assert.ok(h.value("--night") >= 0 && h.value("--night") <= 1, `${iso}: invalid --night`);
      assert.ok(h.value("--sun") >= 0 && h.value("--sun") <= 1, `${iso}: invalid --sun`);
      assert.ok(near(h.value("--night") + h.value("--sun"), 1, 0.00011), `${iso}: rig complements drifted`);
    }
    assert.equal(h.events.length, seconds.length + 1, "hh:hour must arrive once per second");
    assert.equal(h.intervals.size, 1, "ticks must not create an unbounded render loop");
    assert.equal(h.rafCount(), 0, "ambient writes must not arm requestAnimationFrame");
  } finally {
    stop();
  }
});

await check("midnight computed --hour is immediate instead of interpolating backward through the day", () => {
  const h = rigHarness();
  const stop = h.api.startAmbient();
  try {
    const before = { hour: h.value("--hour"), night: h.value("--night"), sun: h.value("--sun") };
    h.advance("2026-11-14T21:00:00Z");
    const after = { hour: h.value("--hour"), night: h.value("--night"), sun: h.value("--sun") };
    const midpoint = computedMidpoint("--hour", before.hour, after.hour);
    assert.equal(midpoint, after.hour, `computed --hour swept ${before.hour} → ${midpoint} → ${after.hour}; it must expose 0 immediately`);
    assert.ok(midpoint < 1, "midnight computed --hour must stay at the start of the new day");
    for (const property of ["night", "sun"]) {
      const value = computedMidpoint(`--${property}`, before[property], after[property]);
      assert.ok(value >= Math.min(before[property], after[property]) - 1e-9 && value <= Math.max(before[property], after[property]) + 1e-9,
        `--${property} left its continuous endpoint range at midnight`);
    }
  } finally {
    stop();
  }
});

await check("appearance computed values interpolate in the curve's direction at dawn and dusk", () => {
  for (const [name, iso, next] of [
    ["dawn", "2026-11-14T03:59:59Z", "2026-11-14T04:00:00Z"],
    ["dusk", "2026-11-14T14:59:59Z", "2026-11-14T15:00:00Z"],
  ]) {
    const h = rigHarness({ iso });
    const stop = h.api.startAmbient();
    try {
      const before = { night: h.value("--night"), sun: h.value("--sun") };
      h.advance(next);
      const after = { night: h.value("--night"), sun: h.value("--sun") };
      assert.notEqual(before.night, after.night, `${name}: fixture must change the appearance curve`);
      for (const property of ["night", "sun"]) {
        const midpoint = computedMidpoint(`--${property}`, before[property], after[property]);
        assert.ok(midpoint > Math.min(before[property], after[property]) && midpoint < Math.max(before[property], after[property]),
          `${name}: computed --${property} did not interpolate ${before[property]} → ${after[property]}`);
      }
    } finally {
      stop();
    }
  }
});

await check("only appearance-driving rig values glide for one second in normal ambient motion", () => {
  for (const property of ["--night", "--sun"]) {
    const declaration = css.match(new RegExp(`@property\\s+${property}\\s*\\{([^}]*)\\}`))?.[1] ?? "";
    assert.match(declaration, /syntax:\s*"<number>"/, `${property} is not registered as a number`);
    assert.match(declaration, /inherits:\s*true/, `${property} does not inherit`);
  }
  const ambient = rule("html[data-ambient]");
  for (const property of ["--night", "--sun"]) {
    assert.deepEqual(transition(ambient, property), { duration: "1s", timing: "linear" }, `${property} must glide for one second`);
  }
  assert.equal(transition(ambient, "--hour"), null, "--hour is circular state, not an interpolated appearance value");
});

await check("manual dialing keeps its short response and reduced motion has no ambient interpolation", () => {
  const manual = rule("html[data-manual]");
  assert.deepEqual(transition(manual, "--sun"), { duration: "120ms", timing: "linear" }, "manual sun response must stay short");
  for (const property of ["--hour", "--night"]) {
    const glide = transition(manual, property);
    assert.ok(glide === null || (glide.timing === "linear" && Number.parseFloat(glide.duration) <= 0.12),
      `manual ${property} inherited a slow ambient glide`);
  }
  const reduced = css.match(/@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{[\s\S]*?html\[data-ambient\]\s*\{([^}]*)\}/)?.[1] ?? "";
  for (const property of ["--hour", "--night", "--sun"]) {
    assert.equal(transition(reduced, property), "none", "reduced motion must disable ambient interpolation");
  }
});

await check("reduced motion still writes each second and router swaps never re-enable interpolation", () => {
  const h = rigHarness({ calm: true });
  const stop = h.api.startAmbient();
  try {
    assert.equal(h.root.hasAttribute("data-ambient"), false);
    const before = h.value("--hour");
    h.advance("2026-11-14T21:00:00Z");
    assert.ok(h.value("--hour") !== before, "reduced motion must still follow the clock");
    h.root.removeAttribute("data-ambient");
    h.document.dispatchEvent(new CustomEvent("astro:after-swap"));
    assert.equal(h.root.hasAttribute("data-ambient"), false, "swap re-enabled reduced-motion interpolation");
  } finally {
    stop();
  }
});

await check("ambient motion responds live to reduced-motion changes in both directions", () => {
  const h = rigHarness();
  const stop = h.api.startAmbient();
  try {
    assert.equal(h.root.hasAttribute("data-ambient"), true);
    assert.equal(h.motionListenerCount(), 1, "ambient must observe the live media query");
    h.setReducedMotion(true);
    assert.equal(h.root.hasAttribute("data-ambient"), false, "enabling reduced motion left interpolation active");
    const before = h.value("--hour");
    h.advance("2026-11-14T21:00:00Z");
    assert.notEqual(h.value("--hour"), before, "reduced motion must not stop the clock");
    h.document.dispatchEvent(new CustomEvent("astro:after-swap"));
    assert.equal(h.root.hasAttribute("data-ambient"), false, "swap ignored the changed media query");
    h.setReducedMotion(false);
    assert.equal(h.root.hasAttribute("data-ambient"), true, "disabling reduced motion did not restore interpolation");
  } finally {
    stop();
  }
  assert.equal(h.motionListenerCount(), 0, "teardown left the media-query listener bound");

  const initiallyCalm = rigHarness({ calm: true });
  const stopCalm = initiallyCalm.api.startAmbient();
  try {
    initiallyCalm.setReducedMotion(false);
    assert.equal(initiallyCalm.root.hasAttribute("data-ambient"), true, "a session that started reduced could not opt back into motion");
  } finally {
    stopCalm();
  }
});

await check("manual dialing pauses ambient writes, then Back to now resumes them", () => {
  const h = rigHarness();
  const stop = h.api.startAmbient();
  try {
    h.api.applyHour(12);
    assert.equal(h.root.hasAttribute("data-manual"), true, "manual mode was not announced");
    assert.equal([...h.timeouts.values()][0].delay, 600, "manual mode must clear promptly");
    const eventCount = h.events.length;
    h.advance("2026-11-14T09:00:00Z");
    assert.equal(h.value("--hour"), 12, "ambient overwrote the guest's hour");
    assert.equal(h.events.length, eventCount, "paused ambient still broadcast hh:hour");
    h.finishManual();
    assert.equal(h.root.hasAttribute("data-manual"), false);
    h.api.releaseToNow();
    assert.equal(h.api.liveHour(), null);
    assert.equal(h.value("--hour"), 12);
    h.advance("2026-11-14T09:00:01Z");
    assert.ok(near(h.value("--hour"), 12 + SECOND, 0.00006), "ambient did not resume after release");
  } finally {
    stop();
  }
});

await check("an ambient router swap replaces the incoming build hour with the live Nairobi second", () => {
  const h = rigHarness({ iso: "2026-11-14T20:59:59Z" });
  const stop = h.api.startAmbient();
  try {
    h.setTime("2026-11-14T21:00:00Z");
    // Astro copies the incoming server HTML's root inline values before after-swap listeners run.
    h.root.style.setProperty("--hour", "3.0000");
    h.root.style.setProperty("--night", nightAmount(3).toFixed(4));
    h.root.style.setProperty("--sun", sunAmount(3).toFixed(4));
    const eventCount = h.events.length;
    h.document.dispatchEvent(new CustomEvent("astro:after-swap"));
    assert.equal(h.value("--hour"), 0, "the swapped page exposed the build hour until the next interval");
    assert.equal(h.events.length, eventCount + 1, "after-swap did not publish the corrected live hour");
    assert.equal(h.events.at(-1).hour, 0, "the door and dials received the stale build hour");
  } finally {
    stop();
  }
});

await check("a reduced-motion router swap also corrects the hour without enabling interpolation", () => {
  const h = rigHarness({ iso: "2026-11-14T21:00:00Z", calm: true });
  const stop = h.api.startAmbient();
  try {
    h.root.style.setProperty("--hour", "12.0000");
    h.document.dispatchEvent(new CustomEvent("astro:after-swap"));
    assert.equal(h.value("--hour"), 0, "reduced motion left the incoming build hour on screen");
    assert.equal(h.root.hasAttribute("data-ambient"), false, "the swap re-enabled reduced-motion interpolation");
  } finally {
    stop();
  }
});

await check("manual router reassertion compares the writer's fixed precision without redundant broadcasts", async () => {
  const base = await readFile(join(ROOT, "site/src/layouts/Base.astro"), "utf8");
  assert.match(base, /getPropertyValue\("--hour"\)\.trim\(\) !== askedFor\.toFixed\(4\)/,
    "manual reassertion must compare 3.0000 with 3.0000, not raw 3.0000 with String(3)");
  const h = rigHarness();
  h.api.applyHour(12);
  h.root.style.setProperty("--hour", "12.0000");
  const before = h.events.length;
  const askedFor = h.api.liveHour();
  const agrees = h.root.style.getPropertyValue("--hour").trim() === askedFor.toFixed(4);
  assert.equal(agrees, true);
  assert.equal(h.events.length, before, "the fixture itself changed the rig");
});

await check("teardown removes the timer/listeners and after-swap re-asserts normal motion", () => {
  const h = rigHarness();
  const stop = h.api.startAmbient();
  h.root.removeAttribute("data-ambient");
  h.document.dispatchEvent(new CustomEvent("astro:after-swap"));
  assert.equal(h.root.hasAttribute("data-ambient"), true, "after-swap did not restore interpolation");
  stop();
  assert.equal(h.intervals.size, 0, "teardown left the ambient interval running");
  assert.equal(h.document.count("visibilitychange"), 0, "teardown left visibilitychange bound");
  assert.equal(h.document.count("astro:after-swap"), 0, "teardown left after-swap bound");
  assert.equal(h.window.count("pageshow"), 0, "teardown left pageshow bound");
  const eventCount = h.events.length;
  h.advance("2026-11-14T21:00:00Z");
  h.document.dispatchEvent(new CustomEvent("visibilitychange"));
  h.document.dispatchEvent(new CustomEvent("astro:after-swap"));
  assert.equal(h.events.length, eventCount, "stopped writer still published an hour");
});

async function runClockProbe(report) {
  const results = [];
  const probeFailures = [];
  const returned = await auditClockContinuity({
    goto: async () => {},
    evaluate: async () => report,
    results,
    failures: probeFailures,
    drain: () => ({ errors: [], warnings: [] }),
  });
  return { returned, results, failures: probeFailures };
}

function probePoint(hour, night, eventHour = hour, eventNight = night) {
  const sun = 1 - night;
  // Visible UI follows the event immediately, even while CSS appearance values glide underneath it.
  const rig = rigFor(eventHour);
  const door = rigValues(eventNight, rig.open);
  return {
    hour,
    night,
    sun,
    inlineHour: hour,
    inlineNight: night,
    inlineSun: sun,
    raw: { "--hour": String(hour), "--night": String(night), "--sun": String(sun) },
    doorNight: door.night.toFixed(3),
    doorExposure: door.exposure.toFixed(3),
    dials: [{
      value: String(rig.hour),
      clock: rig.label,
      datetime: rig.label,
      phase: rig.name,
      line: rig.line,
      state: rig.open ? "Open" : "Closed",
    }],
  };
}

function probeSample(name, beforeHour, afterHour, beforeNight, afterNight, hourTransition = false) {
  const before = probePoint(beforeHour, beforeNight);
  const target = probePoint(afterHour, afterNight);
  const during = probePoint(
    hourTransition ? (beforeHour + afterHour) / 2 : afterHour,
    (beforeNight + afterNight) / 2,
    afterHour,
    afterNight,
  );
  const animations = [];
  if (beforeNight !== afterNight) {
    for (const property of ["--night", "--sun"]) animations.push({ property, duration: 1000, easing: "linear" });
  }
  if (hourTransition) animations.push({ property: "--hour", duration: 1000, easing: "linear" });
  return {
    name,
    before,
    target,
    during,
    animations,
    eventDelta: 1,
    lastEvent: { hour: afterHour, night: afterNight, open: rigFor(afterHour).open },
    renderedChanged: true,
    doorChanged: before.doorNight !== target.doorNight || before.doorExposure !== target.doorExposure,
    dialsChanged: JSON.stringify(before.dials) !== JSON.stringify(target.dials),
  };
}

function probeReport() {
  return {
    supported: true,
    contract: {
      reduced: false,
      ambient: true,
      manual: false,
      property: "--night, --sun",
      duration: "1s, 1s",
      timing: "linear, linear",
    },
    samples: [
      probeSample("dawn", 6.9997, 7, 0.4801, 0.48),
      probeSample("dusk", 17.9997, 18, 0.5266, 0.5267),
      probeSample("midnight", 23.9997, 0, 1, 1),
    ],
  };
}

await check("runtime probe fails loudly when its browser harness is unsupported", async () => {
  for (const report of [{ supported: false, reason: "window.Date is not replaceable" }, undefined]) {
    const { failures } = await runClockProbe(report);
    assert.ok(failures.some((line) => line.includes("unsupported harness")),
      `unsupported report was silently accepted: ${JSON.stringify(failures)}`);
  }
});

await check("runtime probe rejects a transitioned circular --hour contract", async () => {
  const report = probeReport();
  report.contract.property = "--hour, --night, --sun";
  report.contract.duration = "1s, 1s, 1s";
  report.contract.timing = "linear, linear, linear";
  report.samples = [];
  const { failures } = await runClockProbe(report);
  assert.ok(failures.some((line) => line.includes("--hour") && line.includes("immediate")),
    `all-three transition contract was accepted: ${JSON.stringify(failures)}`);
});

await check("runtime probe accepts immediate hour and directional palette midpoints", async () => {
  const { failures } = await runClockProbe(probeReport());
  assert.deepEqual(failures, [], "the immediate-hour/interpolated-palette report must pass");
});

await check("runtime probe rejects a backward computed hour midpoint", async () => {
  const report = probeReport();
  report.samples[2] = probeSample("midnight", 23.9997, 0, 1, 1, true);
  const { failures } = await runClockProbe(report);
  assert.ok(failures.some((line) => line.includes("midnight") && line.includes("--hour") && /immediate|backward/.test(line)),
    `backward computed midpoint was accepted: ${JSON.stringify(failures)}`);
});

await check("runtime probe rejects a stale DoorScene rig even when CSS and the hour are exact", async () => {
  const report = probeReport();
  report.samples[1].target.doorExposure = "0.100";
  const { failures } = await runClockProbe(report);
  assert.ok(failures.some((line) => line.includes("dusk") && line.includes("DoorScene")),
    `stale renderer exposure was accepted: ${JSON.stringify(failures)}`);
});

await check("runtime probe rejects stale visible dial labels or a lost open/closed state", async () => {
  for (const [field, value] of [["phase", "Closed"], ["state", "Closed"], ["clock", "06:59"], ["line", "stale"]]) {
    const report = probeReport();
    report.samples[0].target.dials[0][field] = value;
    const { failures } = await runClockProbe(report);
    assert.ok(failures.some((line) => line.includes("dawn") && line.includes("visible dial") && line.includes(field)),
      `stale ${field} was accepted: ${JSON.stringify(failures)}`);
  }
});

await check("runtime probe requires visible dials and a DoorScene response rather than hour-only change", async () => {
  for (const mutate of [
    (report) => { report.samples[0].target.dials = []; },
    (report) => { report.samples[0].target.doorNight = null; },
    (report) => { report.samples[0].dialsChanged = false; },
    (report) => { report.samples[0].lastEvent.open = false; },
  ]) {
    const report = probeReport();
    mutate(report);
    const { failures } = await runClockProbe(report);
    assert.ok(failures.length, `incomplete rendered clock response was accepted: ${JSON.stringify(report.samples[0])}`);
  }
});

console.log(`\n${"─".repeat(64)}`);
if (failures.length) {
  console.log(`${failures.length} FAILED · ${passed} passed`);
  for (const failure of failures) console.log(`  ${failure.name}: ${failure.message}`);
  process.exit(1);
}
console.log(`tests: ${passed} passed — second resolution, continuous day, writer, motion and lifecycle contracts`);
