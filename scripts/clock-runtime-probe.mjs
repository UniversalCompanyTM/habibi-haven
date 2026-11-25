// clock-runtime-probe.mjs — a runtime audit for the one-second ambient clock.
// Import and call from verify-runtime.mjs with its existing helpers; this module opens no browser,
// owns no timers in Node, and has no external dependencies. Page-side Date emulation makes dawn/dusk/
// midnight deterministic. CSS transitions are paused at their midpoint so the audit checks computed
// interpolation direction, not merely the values eventually written by the clock.
import { nightAmount, rigFor } from "../site/src/lib/hours.mjs";
import { rigValues } from "../site/src/scenes/rig.js";

const near = (actual, wanted, tolerance = 0.00006) =>
  Number.isFinite(actual) && Math.abs(actual - wanted) <= tolerance;

function list(value) {
  return String(value ?? "").split(",").map((part) => part.trim()).filter(Boolean);
}

function transitionAt(contract, property) {
  const properties = list(contract?.property);
  const index = properties.indexOf(property);
  if (index < 0 && !properties.includes("all")) return null;
  const durations = list(contract?.duration);
  const timings = list(contract?.timing);
  const position = index < 0 ? 0 : index;
  return {
    duration: Number.parseFloat(durations[position % durations.length]),
    timing: timings[position % timings.length] ?? "ease",
  };
}

export async function auditClockContinuity({ evaluate, goto, results, failures, drain, path = "/" } = {}) {
  const label = `${path} clock continuity`;
  let report;
  try {
    await goto(path);
    report = await evaluate(`
      const NativeDate = window.Date;
      const root = document.documentElement;
      const descriptor = Object.getOwnPropertyDescriptor(window, "Date");
      if (!root || typeof getComputedStyle !== "function" || typeof matchMedia !== "function") {
        return { supported: false, reason: "required DOM/style APIs are unavailable" };
      }
      if (!descriptor || descriptor.writable === false) {
        return { supported: false, reason: "window.Date is not replaceable in this harness" };
      }
      if (typeof root.getAnimations !== "function") {
        return { supported: false, reason: "Element.getAnimations() is required to inspect computed transition midpoints" };
      }

      const originalTransition = root.style.transition;
      const hourEvents = [];
      const onHour = (event) => {
        const detail = event.detail || {};
        hourEvents.push({ hour: detail.hour, night: detail.night, open: detail.open });
      };
      document.addEventListener("hh:hour", onHour);
      let nowMs = 0;
      let ProbeDate = null;
      let changedDate = false;
      let changedTransition = false;
      const snapshot = () => {
        const style = getComputedStyle(root);
        const raw = {};
        for (const name of ["--hour", "--night", "--sun"]) {
          raw[name] = style.getPropertyValue(name).trim();
        }
        const door = document.querySelector("[data-door]");
        return {
          hour: Number(raw["--hour"]),
          night: Number(raw["--night"]),
          sun: Number(raw["--sun"]),
          raw,
          inlineHour: Number(root.style.getPropertyValue("--hour")),
          inlineNight: Number(root.style.getPropertyValue("--night")),
          inlineSun: Number(root.style.getPropertyValue("--sun")),
          doorNight: door?.dataset.rigNight ?? null,
          doorExposure: door?.dataset.rigExposure ?? null,
          dials: [...document.querySelectorAll("[data-dial]")].map((dial) => ({
            value: dial.querySelector("[data-dial-input]")?.value ?? null,
            clock: dial.querySelector("[data-clock]")?.textContent.trim() ?? null,
            datetime: dial.querySelector("[data-clock]")?.getAttribute("datetime") ?? null,
            phase: dial.querySelector("[data-phase]")?.textContent.trim() ?? null,
            line: dial.querySelector("[data-line]")?.textContent.trim() ?? null,
            state: dial.querySelector("[data-state]")?.textContent.trim() ?? null,
          })),
        };
      };
      const commitTransition = (value) => {
        root.style.transition = value;
        changedTransition = true;
        getComputedStyle(root).transitionProperty; // flush the cascade before the next clock write
      };
      const prime = (iso) => {
        nowMs = NativeDate.parse(iso);
        // Establish an exact baseline and cancel the previous sample's paused/finished transitions.
        commitTransition("none");
        window.dispatchEvent(new Event("pageshow"));
        const point = snapshot();
        commitTransition(originalTransition);
        return point;
      };
      try {
        const initial = getComputedStyle(root);
        const contract = {
          reduced: matchMedia("(prefers-reduced-motion: reduce)").matches,
          ambient: root.hasAttribute("data-ambient"),
          manual: root.hasAttribute("data-manual"),
          property: initial.transitionProperty,
          duration: initial.transitionDuration,
          timing: initial.transitionTimingFunction,
        };
        ProbeDate = class extends NativeDate {
          constructor(...args) { super(...(args.length ? args : [nowMs])); }
          static now() { return nowMs; }
        };
        window.Date = ProbeDate;
        changedDate = true;

        const pairs = [
          ["dawn", "2026-11-14T03:59:59Z"],     // 06:59:59 → 07:00:00 Nairobi
          ["dusk", "2026-11-14T14:59:59Z"],     // 17:59:59 → 18:00:00 Nairobi
          ["midnight", "2026-11-14T20:59:59Z"], // 23:59:59 → 00:00:00 Nairobi
        ];
        const samples = [];
        for (const [name, iso] of pairs) {
          const eventStart = hourEvents.length;
          const before = prime(iso);
          nowMs = NativeDate.parse(iso) + 1000;
          window.dispatchEvent(new Event("pageshow"));
          getComputedStyle(root).getPropertyValue("--night"); // commit the write and create transitions

          const animations = root.getAnimations()
            .filter((animation) => animation.effect?.target === root)
            .map((animation) => ({
              property: animation.transitionProperty,
              duration: animation.effect?.getComputedTiming?.().duration ?? null,
              easing: animation.effect?.getTiming?.().easing ?? null,
              animation,
            }))
            .filter((entry) => ["--hour", "--night", "--sun"].includes(entry.property));

          // A linear one-second transition at 500 ms exposes the numeric midpoint. Pausing removes
          // scheduler/throttling luck: a harness that cannot animate registered numbers cannot fake it.
          for (const entry of animations) {
            entry.animation.pause();
            entry.animation.currentTime = 500;
          }
          getComputedStyle(root).getPropertyValue("--night");
          const during = snapshot();
          for (const entry of animations) entry.animation.finish();
          getComputedStyle(root).getPropertyValue("--night");
          const target = snapshot();

          const doorChanged = before.doorNight !== target.doorNight || before.doorExposure !== target.doorExposure;
          const dialsChanged = JSON.stringify(before.dials) !== JSON.stringify(target.dials);
          const renderedChanged = ["hour", "night", "sun"].some((key) =>
            Number.isFinite(before[key]) && Number.isFinite(target[key]) && Math.abs(target[key] - before[key]) > 1e-9
          ) || doorChanged || dialsChanged;
          samples.push({
            name,
            before,
            during,
            target,
            animations: animations.map(({ property, duration, easing }) => ({ property, duration, easing })),
            eventDelta: hourEvents.length - eventStart,
            lastEvent: hourEvents.at(-1) ?? null,
            renderedChanged,
            doorChanged,
            dialsChanged,
          });
        }
        return { supported: true, contract, samples };
      } finally {
        document.removeEventListener("hh:hour", onHour);
        if (changedDate && window.Date === ProbeDate) window.Date = NativeDate;
        if (changedTransition) {
          commitTransition("none");
          getComputedStyle(root).transitionProperty;
          commitTransition(originalTransition);
        }
        // Leave the live page on its real clock, not the last emulated instant.
        window.dispatchEvent(new Event("pageshow"));
      }
    `);
  } catch (error) {
    report = { supported: false, reason: error?.message ?? String(error) };
  }

  let logs = { errors: [], warnings: [] };
  try {
    logs = drain();
  } catch (error) {
    failures.push(`${label}: drain failed: ${error?.message ?? String(error)}`);
  }
  const errors = logs?.errors ?? [];
  const warnings = logs?.warnings ?? [];
  results.push({ path: label, value: report, errors, warnings });
  if (errors.length) failures.push(`${label}: ${errors.length} browser error(s): ${errors.slice(0, 3).join(" | ")}`);
  if (!report || report.supported !== true) {
    const reason = report?.reason || "evaluate returned no supported clock report";
    failures.push(`${label}: unsupported harness: ${reason}`);
    return report ?? { supported: false, reason };
  }
  if (!report.contract || !Array.isArray(report.samples)) {
    failures.push(`${label}: malformed clock report (missing contract or samples)`);
    return report;
  }

  const { contract, samples } = report;
  if (contract.manual) failures.push(`${label}: manual mode was still active, so ambient continuity was not exercised`);
  if (contract.reduced) {
    if (contract.ambient) failures.push(`${label}: reduced motion re-enabled data-ambient interpolation`);
    for (const property of ["--hour", "--night", "--sun"]) {
      const glide = transitionAt(contract, property);
      if (glide && glide.duration > 0) failures.push(`${label}: reduced motion still transitions ${property}`);
    }
  } else {
    if (!contract.ambient) failures.push(`${label}: normal motion did not enable data-ambient`);
    const hour = transitionAt(contract, "--hour");
    if (hour && hour.duration > 0) failures.push(`${label}: --hour must be immediate circular state, not transitioned`);
    for (const property of ["--night", "--sun"]) {
      const glide = transitionAt(contract, property);
      if (!glide || glide.duration !== 1 || glide.timing !== "linear") {
        failures.push(`${label}: ${property} must transition linearly for one second`);
      }
    }
  }

  const expected = [
    ["dawn", 6 + 59 / 60 + 59 / 3600, 7],
    ["dusk", 17 + 59 / 60 + 59 / 3600, 18],
    ["midnight", 23 + 59 / 60 + 59 / 3600, 0],
  ];
  if (samples.length !== expected.length) failures.push(`${label}: expected ${expected.length} clock samples, got ${samples.length}`);
  for (let i = 0; i < Math.min(samples.length, expected.length); i += 1) {
    const sample = samples[i];
    const [name, wantedBefore, wantedAfter] = expected[i];
    if (sample.name !== name) failures.push(`${label}: expected ${name}, got ${sample.name}`);
    if (!sample.before || !sample.during || !sample.target || !Array.isArray(sample.animations)) {
      failures.push(`${label}: ${name} is missing computed before/during/target samples`);
      continue;
    }

    const nightBefore = Number(nightAmount(wantedBefore).toFixed(4));
    const nightAfter = Number(nightAmount(wantedAfter).toFixed(4));
    for (const [pointName, point, wantedHour, wantedNight] of [
      ["before", sample.before, wantedBefore, nightBefore],
      ["during", sample.during, wantedAfter, null],
      ["target", sample.target, wantedAfter, nightAfter],
    ]) {
      if (!near(point.inlineHour, wantedHour) || !near(point.hour, wantedHour)) {
        failures.push(`${label}: ${name} ${pointName} --hour was ${point.hour} (inline ${point.inlineHour}), expected immediate ${wantedHour}`);
      }
      if (wantedNight !== null && (!near(point.inlineNight, wantedNight) || !near(point.night, wantedNight))) {
        failures.push(`${label}: ${name} ${pointName} --night was ${point.night}, expected ${wantedNight}`);
      }
      if (!near(point.inlineNight + point.inlineSun, 1, 0.00011)) {
        failures.push(`${label}: ${name} ${pointName} wrote non-complementary night/sun targets`);
      }
      for (const property of ["--hour", "--night", "--sun"]) {
        const raw = point.raw?.[property];
        if (!raw || !Number.isFinite(Number(raw))) failures.push(`${label}: ${name} ${pointName} rendered invalid ${property}: ${JSON.stringify(raw)}`);
      }
    }

    if (sample.animations.some((animation) => animation.property === "--hour")) {
      failures.push(`${label}: ${name} --hour must stay immediate; a backward CSS transition was observed`);
    }
    if (sample.eventDelta < 1 || !near(Number(sample.lastEvent?.hour), wantedAfter)) {
      failures.push(`${label}: ${name} did not deliver the new hh:hour event`);
    }
    if (!sample.dialsChanged) failures.push(`${label}: ${name} visible dial labels did not respond to the new hour`);
    const targetRig = rigFor(wantedAfter);
    const targetDoor = rigValues(targetRig.night, targetRig.open);
    if (sample.lastEvent?.open !== targetRig.open || !near(Number(sample.lastEvent?.night), targetRig.night, 0.00011)) {
      failures.push(`${label}: ${name} hh:hour event had stale open/night state`);
    }
    for (const [pointName, point, expectedHour] of [
      ["before", sample.before, wantedBefore],
      ["during", sample.during, wantedAfter],
      ["target", sample.target, wantedAfter],
    ]) {
      const expectedRig = rigFor(expectedHour);
      const expectedDoor = rigValues(expectedRig.night, expectedRig.open);
      if (point.doorNight !== expectedDoor.night.toFixed(3) || point.doorExposure !== expectedDoor.exposure.toFixed(3)) {
        failures.push(`${label}: ${name} ${pointName} DoorScene snapshots were ${point.doorNight}/${point.doorExposure}, expected ${expectedDoor.night.toFixed(3)}/${expectedDoor.exposure.toFixed(3)}`);
      }
      if (!Array.isArray(point.dials) || point.dials.length === 0) {
        failures.push(`${label}: ${name} ${pointName} reported no visible dials`);
        continue;
      }
      for (const [index, dial] of point.dials.entries()) {
        if (!near(Number(dial.value), expectedRig.hour, 0.0001) || dial.clock !== expectedRig.label ||
            dial.datetime !== expectedRig.label || dial.phase !== expectedRig.name || dial.line !== expectedRig.line ||
            dial.state !== (expectedRig.open ? "Open" : "Closed")) {
          const stale = ["value", "clock", "datetime", "phase", "line", "state"]
            .filter((field) => field === "value" ? !near(Number(dial.value), expectedRig.hour, 0.0001) :
              dial[field] !== (field === "clock" || field === "datetime" ? expectedRig.label :
                field === "phase" ? expectedRig.name : field === "line" ? expectedRig.line : expectedRig.open ? "Open" : "Closed"))
            .join(", ");
          failures.push(`${label}: ${name} ${pointName} visible dial ${index} was stale (${stale}; ${dial.clock}/${dial.phase}/${dial.state})`);
        }
      }
    }
    // The rounded DoorScene evidence may legitimately stay equal over a one-second dawn/dusk sample.
    // Visible labels still have to change; the exact target snapshots above prove the renderer received it.
    if (!sample.renderedChanged) failures.push(`${label}: ${name} rendered no clock or door-state change`);

    for (const [property, before, after] of [
      ["--night", nightBefore, nightAfter],
      ["--sun", 1 - nightBefore, 1 - nightAfter],
    ]) {
      const key = property.slice(2);
      if (!near(sample.target[key], after)) failures.push(`${label}: ${name} target ${property} was ${sample.target[key]}, expected ${after}`);
      if (Math.abs(after - before) < 1e-9) {
        if (!near(sample.during[key], before)) failures.push(`${label}: ${name} ${property} moved on its continuous midnight/plateau endpoint`);
        continue;
      }
      if (contract.reduced) continue;
      const animation = sample.animations.find((entry) => entry.property === property);
      if (!animation) {
        failures.push(`${label}: ${name} required ${property} interpolation is unsupported or missing`);
        continue;
      }
      if (animation.duration !== 1000 || animation.easing !== "linear") {
        failures.push(`${label}: ${name} ${property} animation was ${animation.duration}ms/${animation.easing}, expected 1000ms/linear`);
      }
      const midpoint = (before + after) / 2;
      if (!near(sample.during[key], midpoint, 0.00001)) {
        failures.push(`${label}: ${name} computed ${property} midpoint was ${sample.during[key]}, expected ${midpoint} (${before} → ${after})`);
      }
    }
  }
  return report;
}
