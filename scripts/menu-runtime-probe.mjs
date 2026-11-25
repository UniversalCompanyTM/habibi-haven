// menu-runtime-probe.mjs — browser-only geometry and hit-testing for /menu.
//
// Import and call from verify-runtime.mjs; this module opens no browser and has no dependencies. The
// viewport and keyboard adapters are the extra helpers the page evaluator cannot provide: pass
//   setViewport: (metrics) => inPage("Emulation.setDeviceMetricsOverride", metrics)
//   pressKey: (keyName) => press(keyName) // a real CDP key, not a synthetic KeyboardEvent
// alongside the harness's existing evaluate/goto/results/failures/drain helpers.
import { decodeTable, encodeTable } from "../site/src/lib/table.mjs";

const VIEWPORTS = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "tablet", width: 820, height: 1180 },
  { name: "phone", width: 390, height: 844 },
];
const STATES = [
  { name: "initial" },
  { name: "searched", query: "chai" },
  { name: "filtered", tag: "goat" },
  { name: "sorted", sort: "cheap" },
];

// A hit belongs to the control or one of its painted descendants. The old hit.contains(el) arm let an
// ancestor win whenever the control itself had pointer-events:none, which is precisely the blocked case.
export function ownsControlHit(control, hit, isVisible = () => true) {
  if (!control || !hit) return false;
  return hit === control || (control.contains(hit) && isVisible(hit));
}

export function clearsStickyBands(rect, bands) {
  return bands.every((band) => rect.top >= band.bottom);
}

// These pure helpers are serialized into the page so the Node tests and the browser audit exercise the
// same ownership/clearance rules rather than two copies that can drift.
const CONTROL_HELPERS = `
  const ownsControlHit = ${ownsControlHit.toString()};
  const clearsStickyBands = ${clearsStickyBands.toString()};
`;

function bodyFor(state) {
  return `
    const state = ${JSON.stringify(state)};
    const root = document.documentElement;
    ${CONTROL_HELPERS}
    const q = (selector) => document.querySelector(selector);
    const all = (selector) => [...document.querySelectorAll(selector)];
    const frame = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const settleScroll = async (target) => {
      let previous = scrollY;
      let stable = 0;
      for (let i = 0; i < 72 && stable < 3; i += 1) {
        await frame();
        const current = scrollY;
        stable = Math.abs(current - previous) < 1 ? stable + 1 : 0;
        previous = current;
      }
      if (!target) return { stable: stable >= 3, onScreen: null };
      const r = box(target);
      return { stable: stable >= 3, onScreen: r.top >= -1 && r.bottom <= innerHeight + 1 };
    };
    const box = (el) => {
      const r = el.getBoundingClientRect();
      return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height };
    };
    const shown = (el) => !!el && !el.hidden && getComputedStyle(el).display !== "none" && box(el).width > 0 && box(el).height > 0;
    const crosses = (a, b) => a.left < b.right - 1 && a.right > b.left + 1 && a.top < b.bottom - 1 && a.bottom > b.top + 1;
    const contains = (outer, inner) => inner.left >= outer.left - 1 && inner.right <= outer.right + 1 && inner.top >= outer.top - 1 && inner.bottom <= outer.bottom + 1;
    const nameOf = (el) => (el.getAttribute("aria-label") || el.textContent || el.tagName).trim().replace(/\\s+/g, " ").slice(0, 50);
    const search = q("[data-q]");
    const sort = q("[data-sort]");
    const panel = q("#explorer-filters");
    const toggle = q("[data-filters]");
    const openPanel = () => {
      if (panel?.hidden && toggle && !toggle.hidden) toggle.click();
    };
    const reset = () => {
      openPanel();
      const resetButton = all("[data-reset]").find(shown);
      if (resetButton) resetButton.click();
      search.value = "";
      search.dispatchEvent(new Event("input", { bubbles: true }));
      sort.value = "menu";
      sort.dispatchEvent(new Event("change", { bubbles: true }));
      if (toggle && toggle.getAttribute("aria-expanded") === "true") toggle.click();
    };

    if (state.name !== "initial") reset();
    if (state.name === "searched") {
      search.value = state.query;
      search.dispatchEvent(new Event("input", { bubbles: true }));
    }
    if (state.name === "filtered") {
      openPanel();
      const tag = q('[data-tag="' + state.tag + '"]');
      if (!tag) throw new Error("missing filter tag " + state.tag);
      tag.click();
    }
    if (state.name === "sorted") {
      sort.value = state.sort;
      sort.dispatchEvent(new Event("change", { bubbles: true }));
      if (toggle && !toggle.hidden && toggle.getAttribute("aria-expanded") === "true") toggle.click();
    }
    await frame();

    const total = all("[data-card]").length;
    const cards = all("[data-card]").filter(shown);
    const bar = q("[data-bar]");
    const nav = q(".nav");
    if (!bar || !nav) return { missing: true, total, visible: cards.length };
    const barBox = box(bar);
    const navBox = box(nav);
    const rootStyle = getComputedStyle(root);
    const localBar = Number.parseFloat(getComputedStyle(bar.parentElement).getPropertyValue("--bar-h"));
    const fallbackBar = Number.parseFloat(rootStyle.getPropertyValue("--bar-h"));
    const savedBar = Number.isFinite(localBar) ? localBar : fallbackBar;
    const expectedTop = navBox.bottom + 0.4 * Number.parseFloat(getComputedStyle(root).fontSize);

    // Measure after a real scroll: position:sticky at load says nothing about whether the bar follows the
    // guest through 243 cards, and a sticky grid item can be constrained by a shorter grid area. Align to
    // the start rather than centering: a single short search result cannot reach the sticky threshold when
    // centered in a tall viewport, even though the production bar is behaving correctly.
    const deepestCard = cards.at(-1);
    if (deepestCard) deepestCard.scrollIntoView({ block: "start", behavior: "instant" });
    await settleScroll(deepestCard);
    const stuckBox = box(bar);

    const overlaps = [];
    let overlapCount = 0;
    for (let i = 0; i < cards.length; i += 1) {
      const a = cards[i];
      const ar = box(a);
      for (let j = i + 1; j < cards.length; j += 1) {
        const b = cards[j];
        const br = box(b);
        if (!crosses(ar, br)) continue;
        overlapCount += 1;
        if (overlaps.length < 5) overlaps.push({
          a: a.dataset.name || a.dataset.id,
          b: b.dataset.name || b.dataset.id,
          area: Math.round((Math.min(ar.right, br.right) - Math.max(ar.left, br.left)) * (Math.min(ar.bottom, br.bottom) - Math.max(ar.top, br.top))),
        });
      }
    }

    const textOutside = [];
    const clippedText = [];
    const imageOutside = [];
    const badFrameRatio = [];
    const textSelector = ".card__name, .card__price, .card__desc, .acc legend, .acc__option span, .card__foot .chip, .card__foot [data-add]";
    for (const card of cards) {
      const cr = box(card);
      for (const el of card.querySelectorAll(textSelector)) {
        if (!shown(el)) continue;
        const r = box(el);
        if (!contains(cr, r)) textOutside.push(nameOf(el));
        if (!el.classList.contains("card__desc") && (el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1)) {
          clippedText.push(nameOf(el));
        }
      }
      for (const frameEl of card.querySelectorAll(".frame")) {
        const fr = box(frameEl);
        if (!contains(cr, fr)) imageOutside.push("frame:" + (card.dataset.name || card.dataset.id));
        const inlineRatio = frameEl.style.aspectRatio;
        const parts = inlineRatio.split("/").map(Number);
        const expectedRatio = parts.length === 2 && parts.every(Number.isFinite) ? parts[0] / parts[1] : null;
        if (!expectedRatio || Math.abs(fr.width / fr.height - expectedRatio) > 0.02) {
          badFrameRatio.push(card.dataset.name || card.dataset.id);
        }
        const img = frameEl.querySelector("img");
        if (!img) continue;
        const ir = box(img);
        const style = getComputedStyle(frameEl);
        const clippedByFrame = style.overflow === "hidden" || style.overflow === "clip";
        if ((!clippedByFrame && !contains(fr, ir)) || !["cover", "contain"].includes(getComputedStyle(img).objectFit)) {
          imageOutside.push(card.dataset.name || card.dataset.id);
        }
        const width = Number(img.getAttribute("width"));
        const height = Number(img.getAttribute("height"));
        if (width > 0 && height > 0 && Math.abs(fr.width / fr.height - width / height) > 0.02) {
          badFrameRatio.push(card.dataset.name || card.dataset.id);
        }
      }
    }

    const sortViolations = [];
    if (state.name === "sorted") {
      for (const subgroup of all("[data-subgroup]").filter(shown)) {
        const prices = [...subgroup.querySelectorAll("[data-card]")].filter(shown).map((card) => Number(card.dataset.price));
        for (let i = 1; i < prices.length; i += 1) {
          if (prices[i - 1] > prices[i]) {
            sortViolations.push(subgroup.dataset.subgroup);
            break;
          }
        }
      }
    }
    const stateOk = state.name === "initial"
      ? cards.length === total
      : state.name === "searched"
        ? cards.length > 0 && cards.length < total && cards.every((card) => ((card.dataset.name || "") + " " + (card.dataset.desc || "")).includes(state.query))
        : state.name === "filtered"
          ? cards.length > 0 && cards.length < total && cards.every((card) => (card.dataset.tags || "").split(/\\s+/).includes(state.tag))
          : cards.length === total && sortViolations.length === 0;

    const firstGroup = all("[data-group]").find(shown);
    let anchor = null;
    if (firstGroup) {
      firstGroup.scrollIntoView({ block: "start", behavior: "instant" });
      await settleScroll(firstGroup);
      const r = box(firstGroup);
      anchor = { top: Math.round(r.top), barBottom: Math.round(box(bar).bottom), clear: r.top >= box(bar).bottom - 1 };
    }

    const painted = (el) => !!el && !el.closest("[hidden]") && getComputedStyle(el).display !== "none"
      && getComputedStyle(el).visibility === "visible" && Number.parseFloat(getComputedStyle(el).opacity) > 0;
    // Radios are visually represented by their own label/pill, not by their 1px transparent input.
    const hitTarget = (el) => el?.matches(".acc__option") ? el.querySelector("span") ?? el : el;
    const measureControl = (el, focusEl = el, method = "focus") => {
      const target = hitTarget(el);
      const r = box(target);
      const x = r.left + r.width / 2;
      const y = r.top + r.height / 2;
      const hit = x >= 0 && x <= innerWidth && y >= 0 && y <= innerHeight ? document.elementFromPoint(x, y) : null;
      const clear = bar.contains(el) || clearsStickyBands(r, [navBox, box(bar)]);
      return {
        name: nameOf(el), tag: el.tagName.toLowerCase(), method,
        focused: document.activeElement === focusEl,
        ownsHit: ownsControlHit(el, hit, painted),
        clear,
        onScreen: r.top >= -1 && r.bottom <= innerHeight + 1,
        obstructed: !bar.contains(el) && !clear,
        top: Math.round(r.top), barBottom: Math.round(box(bar).bottom),
        hit: hit ? hit.tagName.toLowerCase() + "." + String(hit.className).slice(0, 30) : null,
      };
    };
    // Focus from the top of the document, never from a pre-centred target. Deep Add/accompaniment controls
    // therefore have to survive the browser's own focus scrolling and scroll-margin calculation.
    const deepCard = cards.at(-1);
    const add = deepCard?.querySelector("[data-add]");
    const deepAccompanimentCard = cards.slice().reverse().find((card) => {
      const option = card.querySelector(".acc__option");
      return option && shown(option) && shown(option.querySelector("input"));
    });
    const accompaniment = deepAccompanimentCard?.querySelector(".acc__option");
    const accompanimentInput = accompaniment?.querySelector("input");
    const activeTag = state.tag ? q('[data-tag="' + state.tag + '"]') : null;
    const tag = panel && !panel.hidden ? (shown(activeTag) ? activeTag : all("[data-tag]").find(shown)) : null;
    const representatives = [
      { el: search, focus: search },
      { el: sort, focus: sort },
      { el: toggle, focus: toggle },
      { el: tag, focus: tag },
      { el: add, focus: add },
      { el: accompaniment, focus: accompanimentInput },
    ].filter(({ el, focus }) => shown(el) && shown(focus));
    const controls = [];
    for (const { el, focus } of representatives) {
      document.activeElement?.blur?.();
      window.scrollTo({ top: 0, behavior: "instant" });
      await frame();
      focus.focus();
      await settleScroll(focus);
      controls.push(measureControl(el, focus));
    }

    const tabTargets = [];
    if (shown(add)) tabTargets.push({ cardId: add.closest("[data-card]").dataset.id, kind: "add", name: nameOf(add) });
    if (shown(accompaniment) && shown(accompanimentInput)) {
      tabTargets.push({ cardId: accompaniment.closest("[data-card]").dataset.id, kind: "accompaniment", name: nameOf(accompaniment) });
    }

    return {
      viewport: [innerWidth, innerHeight],
      total,
      visible: cards.length,
      stateOk,
      count: q("[data-count]")?.textContent.trim() ?? "",
      overflowX: root.scrollWidth - root.clientWidth,
      bar: {
        position: getComputedStyle(bar).position,
        top: Math.round(stuckBox.top),
        expectedTop: Math.round(expectedTop),
        bottom: Math.round(stuckBox.bottom),
        height: Math.round(stuckBox.height),
        savedHeight: savedBar,
        heightDrift: Math.round(Math.abs(stuckBox.height - savedBar)),
        followsHeader: stuckBox.top >= navBox.bottom - 1,
        stickyAtDepth: Math.abs(stuckBox.top - expectedTop) <= 2,
      },
      overlaps,
      overlapCount,
      textOutside: textOutside.slice(0, 5),
      clippedText: clippedText.slice(0, 5),
      imageOutside: imageOutside.slice(0, 5),
      badFrameRatio: badFrameRatio.slice(0, 5),
      sortViolations,
      anchor,
      controls,
      tabTargets,
    };
  `;
}

function tabPrepareBody(target) {
  return `
    const target = ${JSON.stringify(target)};
    const all = (selector) => [...document.querySelectorAll(selector)];
    const frame = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const box = (el) => {
      const r = el.getBoundingClientRect();
      return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height };
    };
    const shown = (el) => !!el && !el.closest("[hidden]") && getComputedStyle(el).display !== "none" && box(el).width > 0 && box(el).height > 0;
    const card = all("[data-card]").find((el) => el.dataset.id === target.cardId && shown(el));
    if (!card) return { ready: false, reason: "card is no longer visible" };
    const el = target.kind === "add" ? card.querySelector("[data-add]") : card.querySelector(".acc__option");
    const focus = target.kind === "add" ? el : el?.querySelector("input");
    const hitTarget = el?.matches(".acc__option") ? el.querySelector("span") ?? el : el;
    if (!shown(hitTarget) || !shown(focus)) return { ready: false, reason: "target is no longer visible" };
    const stops = all("a[href], button, input, select, textarea, [tabindex]").filter((candidate) =>
      shown(candidate) && !candidate.disabled && candidate.tabIndex >= 0
      && (candidate.type !== "radio" || candidate.checked)
      && (candidate.type !== "hidden" || candidate.tabIndex >= 0),
    );
    const index = stops.indexOf(focus);
    const previous = stops[index - 1];
    if (index < 1 || !previous) return { ready: false, reason: "target has no preceding visible Tab stop" };
    previous.focus({ preventScroll: true });
    window.scrollTo({ top: 0, behavior: "instant" });
    await frame();
    return {
      ready: document.activeElement === previous && scrollY === 0,
      focused: document.activeElement === previous,
      atTop: scrollY === 0,
      scrollY,
      previous: previous.getAttribute("aria-label") || previous.textContent.trim(),
    };
  `;
}

function tabMeasureBody(target) {
  return `
    const target = ${JSON.stringify(target)};
    ${CONTROL_HELPERS}
    const all = (selector) => [...document.querySelectorAll(selector)];
    const frame = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const box = (el) => {
      const r = el.getBoundingClientRect();
      return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height };
    };
    const shown = (el) => !!el && !el.closest("[hidden]") && getComputedStyle(el).display !== "none" && box(el).width > 0 && box(el).height > 0;
    const painted = (el) => !!el && !el.closest("[hidden]") && getComputedStyle(el).display !== "none"
      && getComputedStyle(el).visibility === "visible" && Number.parseFloat(getComputedStyle(el).opacity) > 0;
    const nameOf = (el) => (el.getAttribute("aria-label") || el.textContent || el.tagName).trim().replace(/\\s+/g, " ").slice(0, 50);
    let previous = scrollY;
    let stable = 0;
    for (let i = 0; i < 72 && stable < 3; i += 1) {
      await frame();
      const current = scrollY;
      stable = Math.abs(current - previous) < 1 ? stable + 1 : 0;
      previous = current;
    }
    const card = all("[data-card]").find((el) => el.dataset.id === target.cardId && shown(el));
    const el = target.kind === "add" ? card?.querySelector("[data-add]") : card?.querySelector(".acc__option");
    const focus = target.kind === "add" ? el : el?.querySelector("input");
    const hitTarget = el?.matches(".acc__option") ? el.querySelector("span") ?? el : el;
    const bar = all("[data-bar]")[0];
    const nav = document.querySelector(".nav");
    if (!shown(el) || !shown(hitTarget) || !shown(focus) || !bar || !nav) return { missing: true };
    const r = box(hitTarget);
    const x = r.left + r.width / 2;
    const y = r.top + r.height / 2;
    const hit = x >= 0 && x <= innerWidth && y >= 0 && y <= innerHeight ? document.elementFromPoint(x, y) : null;
    const clear = bar.contains(el) || clearsStickyBands(r, [box(nav), box(bar)]);
    return {
      name: nameOf(el), tag: el.tagName.toLowerCase(), method: "tab",
      focused: document.activeElement === focus,
      active: document.activeElement === document.body ? "body" : nameOf(document.activeElement),
      ownsHit: ownsControlHit(el, hit, painted),
      clear,
      onScreen: r.top >= -1 && r.bottom <= innerHeight + 1,
      obstructed: !bar.contains(el) && !clear,
      top: Math.round(r.top), barBottom: Math.round(box(bar).bottom),
      hit: hit ? hit.tagName.toLowerCase() + "." + String(hit.className).slice(0, 30) : null,
    };
  `;
}

export async function auditMenuTabTarget({ target, label, failures, evaluate, pressKey } = {}) {
  if (!Array.isArray(failures)) throw new TypeError("failures must be an array");
  for (const [name, helper] of Object.entries({ evaluate, pressKey })) {
    if (typeof helper !== "function") throw new TypeError(`auditMenuTabTarget requires injected ${name}()`);
  }
  try {
    const prepared = await evaluate(tabPrepareBody(target));
    if (!prepared?.ready) {
      throw new Error(prepared?.reason ?? `preceding Tab stop was not ready (focused: ${prepared?.focused}, at top: ${prepared?.atTop}, scrollY ${prepared?.scrollY})`);
    }
    await pressKey("Tab");
    const sample = await evaluate(tabMeasureBody(target));
    if (!sample || sample.missing) throw new Error("Tab target disappeared before it could be measured");
    return sample;
  } catch (error) {
    failures.push(`${label}: Tab to ${target?.name ?? target?.kind ?? "control"} failed: ${error?.message ?? String(error)}`);
    return null;
  }
}

// Geometry is only half of a filter bar's contract: selecting the kitchen's order after a price sort must
// restore the original cards, and clearing controls must remove their stale query keys without losing the
// shared table or room link. This separate battery uses real controls and compares complete deck identity.
export async function auditMenuStateLifecycle({
  expectedTable,
  evaluate,
  goto,
  results,
  failures,
  drain,
  setViewport,
} = {}) {
  for (const [name, helper] of Object.entries({ evaluate, goto, setViewport, drain })) {
    if (typeof helper !== "function") throw new TypeError(`auditMenuStateLifecycle requires injected ${name}()`);
  }
  for (const [name, value] of Object.entries({ results, failures })) {
    if (!Array.isArray(value)) throw new TypeError(`auditMenuStateLifecycle requires a ${name} array`);
  }
  if (!expectedTable) throw new TypeError("auditMenuStateLifecycle requires expectedTable");

  const label = "/menu filter/sort lifecycle";
  const startedAt = failures.length;
  let report;
  try {
    await setViewport({ width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    await goto(`/menu?t=${expectedTable}&keep=1#morning`);
    report = await evaluate(`
      const q = (selector) => document.querySelector(selector);
      const all = (selector) => [...document.querySelectorAll(selector)];
      const shown = (el) => !!el && !el.hidden && !el.closest("[hidden]")
        && getComputedStyle(el).display !== "none" && el.getBoundingClientRect().width > 0;
      const originalHref = location.pathname + location.search + location.hash;
      const order = () => all("[data-subgroup]").map((sub) => [
        sub.dataset.subgroup,
        [...sub.querySelectorAll("[data-card]")].map((card) => card.dataset.id),
      ]);
      const setSort = (value) => {
        const select = q("[data-sort]");
        select.value = value;
        select.dispatchEvent(new Event("change", { bubbles: true }));
      };
      try {
        const baseline = order();
        setSort("cheap");
        const ranked = order();
        setSort("menu");
        const restored = order();

        const search = q("[data-q]");
        search.value = "chai";
        search.dispatchEvent(new Event("input", { bubbles: true }));
        all("[data-tag]").find((button) => button.dataset.tag === "goat")?.click();
        all("[data-band]").find((button) => button.dataset.band === "under-500")?.click();
        setSort("cheap");
        const reset = all("[data-reset]").find(shown);
        if (!reset) throw new Error("Clear filters is not available");
        reset.click();
        setSort("menu");

        const url = new URL(location.href);
        const mismatches = [];
        for (let i = 0; i < baseline.length; i += 1) {
          if (JSON.stringify(baseline[i]) !== JSON.stringify(restored[i])) mismatches.push(baseline[i][0]);
        }
        return {
          total: all("[data-card]").length,
          visible: all("[data-card]").filter(shown).length,
          count: q("[data-count]")?.textContent.trim() ?? "",
          sortChanged: JSON.stringify(ranked) !== JSON.stringify(baseline),
          menuOrderRestored: mismatches.length === 0,
          orderMismatches: mismatches,
          filtersClear: all("[data-tag], [data-band]").every((button) => button.getAttribute("aria-pressed") === "false"),
          searchValue: search.value,
          sortValue: q("[data-sort]").value,
          params: Object.fromEntries(url.searchParams.entries()),
          hash: url.hash,
        };
      } finally {
        history.replaceState(history.state, "", originalHref);
      }
    `);
  } catch (error) {
    report = { missing: true, reason: error?.message ?? String(error) };
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
  if (!report || report.missing) {
    failures.push(`${label}: ${report?.reason ?? "no lifecycle report"}`);
    return { ok: false };
  }

  const fail = (message) => failures.push(`${label}: ${message}`);
  if (!(report.total > 0) || report.visible !== report.total) fail(`reset left ${report.visible}/${report.total} cards visible`);
  if (report.count !== `${report.total} of ${report.total} items`) fail(`reset count is ${JSON.stringify(report.count)}`);
  if (!report.sortChanged) fail("the cheap sort did not change any deck, so restoration was not exercised");
  if (!report.menuOrderRestored || report.orderMismatches?.length) fail(`menu order was not restored in ${(report.orderMismatches ?? []).join(", ") || "unknown sections"}`);
  if (!report.filtersClear || report.searchValue !== "" || report.sortValue !== "menu") fail("filter/search/sort controls did not return to their cleared state");
  for (const parameter of ["q", "tag", "band", "sort"]) {
    if (report.params?.[parameter] != null) fail(`cleared ${parameter} remains in the URL as ${JSON.stringify(report.params[parameter])}`);
  }
  const expectedDecoded = decodeURIComponent(expectedTable);
  if (report.params?.t !== expectedDecoded) fail(`the shared table parameter was lost or changed (expected ${JSON.stringify(expectedDecoded)})`);
  if (report.params?.keep !== "1") fail("an unrelated query parameter was dropped");
  if (report.hash !== "#morning") fail("the room hash was lost");
  return { ok: failures.length === startedAt };
}

export async function auditMenuLayout({ evaluate, goto, results, failures, drain, setViewport, pressKey } = {}) {
  for (const [name, helper] of Object.entries({ evaluate, goto, setViewport, drain, pressKey })) {
    if (typeof helper !== "function") throw new TypeError(`auditMenuLayout requires injected ${name}()`);
  }
  if (!Array.isArray(results) || !Array.isArray(failures)) throw new TypeError("results and failures must be arrays");
  const summary = { viewports: [], states: [] };

  for (const viewport of VIEWPORTS) {
    const label = `/menu ${viewport.name} ${viewport.width}x${viewport.height}`;
    try {
      await setViewport({ width: viewport.width, height: viewport.height, deviceScaleFactor: 1, mobile: viewport.name === "phone" });
      await goto("/menu");
    } catch (error) {
      failures.push(`${label}: ${error?.message ?? String(error)}`);
      continue;
    }
    summary.viewports.push(viewport.name);

    for (const state of STATES) {
      const stateLabel = `${label} ${state.name}`;
      let report;
      try {
        report = await evaluate(bodyFor(state));
      } catch (error) {
        report = { missing: true, reason: error?.message ?? String(error) };
      }
      if (report && !report.missing) {
        report.controls ??= [];
        for (const target of report.tabTargets ?? []) {
          const sample = await auditMenuTabTarget({ target, label: stateLabel, failures, evaluate, pressKey });
          if (sample) report.controls.push(sample);
        }
      }
      let logs = { errors: [], warnings: [] };
      try {
        logs = drain();
      } catch (error) {
        failures.push(`${stateLabel}: drain failed: ${error?.message ?? String(error)}`);
      }
      const errors = logs.errors ?? [];
      const warnings = logs.warnings ?? [];
      results.push({ path: stateLabel, value: report, errors, warnings });
      summary.states.push(`${viewport.name}:${state.name}`);
      if (errors.length) failures.push(`${stateLabel}: ${errors.length} browser error(s): ${errors.slice(0, 3).join(" | ")}`);
      if (!report || report.missing) {
        failures.push(`${stateLabel}: ${report?.reason ?? "menu explorer or sticky bar is missing"}`);
        continue;
      }
      const fail = (message) => failures.push(`${stateLabel}: ${message}`);
      if (report.viewport?.[0] !== viewport.width) fail(`viewport width is ${report.viewport?.[0]}, expected ${viewport.width}`);
      if (!report.stateOk) fail(`the ${state.name} state did not produce the expected visible/sorted cards (${report.visible}/${report.total})`);
      if (report.overflowX > 1) fail(`horizontal overflow is ${report.overflowX}px`);
      if (report.overlapCount) fail(`${report.overlapCount} card pair(s) overlap; first: ${JSON.stringify(report.overlaps[0])}`);
      if (report.textOutside?.length) fail(`text leaves its card: ${report.textOutside.join(" | ")}`);
      if (report.clippedText?.length) fail(`text is clipped by its own box: ${report.clippedText.join(" | ")}`);
      if (report.imageOutside?.length) fail(`image/frame containment failed: ${report.imageOutside.join(" | ")}`);
      if (report.badFrameRatio?.length) fail(`frame ratio disagrees with image metadata: ${report.badFrameRatio.join(" | ")}`);
      if (report.sortViolations?.length) fail(`cheapest-first is out of order in ${report.sortViolations.join(", ")}`);
      if (report.bar.position !== "sticky") fail(`filter bar is position:${report.bar.position}`);
      if (!report.bar.followsHeader) fail(`filter bar covers the fixed header at top ${report.bar.top}`);
      if (!report.bar.stickyAtDepth) fail(`filter bar did not remain sticky at depth (top ${report.bar.top}, expected ${report.bar.expectedTop})`);
      if (report.bar.heightDrift > 1) fail(`saved --bar-h is ${report.bar.savedHeight}px but the bar is ${report.bar.height}px`);
      if (report.anchor && !report.anchor.clear) fail(`room anchor lands at ${report.anchor.top}px under the bar bottom ${report.anchor.barBottom}px`);
      const blocked = report.controls.filter(
        (control) => !control.ownsHit || control.obstructed || !control.focused || !control.clear || control.onScreen === false,
      );
      if (blocked.length) {
        const reasons = blocked.map((control) => {
          const problems = [];
          if (!control.focused) problems.push("not focused");
          if (control.onScreen === false) problems.push("outside viewport");
          if (control.obstructed || !control.clear) problems.push("under sticky bar");
          if (!control.ownsHit) problems.push(`hit ${control.hit ?? "nothing"}`);
          return `${control.name}${control.method ? ` (${control.method})` : ""}: ${problems.join(", ")}`;
        });
        fail(`blocked control(s): ${reasons.join(" | ")}`);
      }
    }
  }
  return summary;
}
