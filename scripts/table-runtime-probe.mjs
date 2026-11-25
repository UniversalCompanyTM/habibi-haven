// table-runtime-probe.mjs — exercise the table controls in a real browser, then compare the complete
// decoded WhatsApp messages with the canonical menu/table functions. The page-side battery presses the
// same controls a guest presses; the Node-side audit compares exact text, never a truncated href.
import menu from "../site/src/data/menu.json" with { type: "json" };
import { decodeTable, encodeTable, money, sanitizeTable, totals, whatsappText, whatsappUrl } from "../site/src/lib/table.mjs";
import { requestMessage, tablePayload, whatsAppHref } from "../site/src/lib/request-client.mjs";

const routeTable = (table) => `/table?t=${encodeURIComponent(encodeTable(table))}`;
const fixture = {
  party: 2,
  lines: [
    { id: "grilled-chicken-breast", option: "Chips", qty: 1 },
    { id: "grilled-chicken-breast", option: "Mandy Rice", qty: 2 },
    { id: "full-mandy", qty: 1 },
  ],
};

const battery = `
  const q = (s) => document.querySelector(s);
  const all = (s) => [...document.querySelectorAll(s)];
  const wait = (ms = 100) => new Promise((resolve) => setTimeout(resolve, ms));
  const stored = () => JSON.parse(localStorage.getItem("habibi-haven:table:v1") || "null");
  const decoded = (selector) => {
    const a = q(selector);
    return a ? new URL(a.href, location.href).searchParams.get("text") : null;
  };
  const snapshot = () => {
    const wa = q("[data-whatsapp]");
    const handoff = q("[data-handoff]");
    const day = q("[data-when-day]");
    const time = q("[data-when-time]");
    const date = day.value ? new Date(day.value + "T12:00:00Z") : null;
    const label = date ? date.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }) : "Today";
    return {
      table: stored(),
      rows: all("[data-lines] .line").map((row) => ({
        key: row.dataset.key,
        name: row.querySelector(".line__name b")?.textContent.trim() ?? null,
        note: row.querySelector(".line__name span")?.textContent.trim() ?? null,
        qty: Number(row.querySelector(".num")?.textContent),
        option: row.querySelector("[data-option]")?.value ?? null,
      })),
      total: q("[data-total]")?.textContent.trim() ?? null,
      emptyHidden: q("[data-empty]")?.hidden ?? null,
      when: label + ", " + time.value,
      day: day.value,
      time: time.value,
      origin: location.origin,
      contact: {
        name: q('[name="name"]').value,
        phone: q('[name="phone"]').value,
        notes: q('[name="notes"]').value,
      },
      handoffs: [wa, handoff].map((a) => ({
        href: a?.getAttribute("href") ?? null,
        disabled: a?.getAttribute("aria-disabled") === "true",
        text: a?.textContent.trim() ?? null,
        decodedWhatsAppText: decoded(a === wa ? "[data-whatsapp]" : "[data-handoff]"),
      })),
      url: location.href,
    };
  };
  const out = { initial: snapshot(), steps: {} };
  const guard = (selector) => {
    const event = new MouseEvent("click", { bubbles: true, cancelable: true });
    q(selector).dispatchEvent(event);
    out.steps[selector + "Guard"] = {
      prevented: event.defaultPrevented,
      message: q("[data-copy-state]")?.textContent.trim() ?? null,
    };
  };
  if (out.initial.table?.lines?.length) {
    q("[data-clear]").click(); await wait(); out.initial = snapshot();
  }
  guard("[data-whatsapp]");
  guard("[data-handoff]");

  q("[data-add]").click(); await wait(); out.steps.add = snapshot();
  q("[data-inc]").click(); await wait(); out.steps.increment = snapshot();
  q("[data-dec]").click(); await wait(); q("[data-dec]").click(); await wait(); out.steps.decrementToZero = snapshot();
  guard("[data-whatsapp]"); guard("[data-handoff]");

  q('[name="name"]').value = "Amina & Co #2";
  q('[name="phone"]').value = "+254 712 345 678";
  q('[name="notes"]').value = "Quiet 50% window · karibu 🌿 & #2";
  for (const input of q("[data-record-form]").querySelectorAll("input, textarea")) {
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }
  q("[data-add-all]").click(); await wait(); out.steps.houseSet = snapshot();

  const optionRows = () => all("[data-option]");
  const change = (index, value) => {
    const select = optionRows()[index];
    select.value = value;
    select.dispatchEvent(new Event("change", { bubbles: true }));
  };
  if (optionRows().length) {
    change(0, optionRows()[0].options[optionRows()[0].options.length - 1].value);
    await wait(); out.steps.sideChange = snapshot();
  }
  out.errors = [];
  return out;
`;

function compareState(report, failures, label, expected, { allowStaleStorage = false } = {}) {
  if (!report) {
    failures.push(`${label}: no table snapshot`);
    return;
  }
  const stored = sanitizeTable(menu, report?.table);
  let encoded = null;
  let fromUrl = null;
  try {
    encoded = new URL(report.url, "https://table.invalid").searchParams.get("t");
    if (encoded !== null) fromUrl = sanitizeTable(menu, decodeTable(encoded));
  } catch (error) {
    failures.push(`${label}: URL table could not be decoded: ${error?.message ?? String(error)}`);
  }
  // The address is the live authority after a same-document router swap. localStorage.setItem() in that
  // document emits no cross-tab storage event, so stale bytes there are evidence to report, not UI state.
  const table = fromUrl ?? stored;
  if (fromUrl && JSON.stringify(stored) !== JSON.stringify(fromUrl)) {
    report.storageDiverged = true;
    if (!allowStaleStorage) failures.push(`${label}: URL table differs from the canonical sheet`);
  }
  const clean = expected ? sanitizeTable(menu, expected) : table;
  if (JSON.stringify(table) !== JSON.stringify(clean)) failures.push(`${label}: canonical table differs: ${JSON.stringify(table)}`);
  const priced = totals(menu, table);
  const visibleRows = priced.rows.map((row) => ({
    key: row.key,
    name: row.name,
    note: `${money(row.unit)} × ${row.qty}${row.unavailable ? " · showing unavailable" : ""}`,
    qty: row.qty,
    option: row.option ?? null,
  }));
  if (JSON.stringify(report.rows) !== JSON.stringify(visibleRows)) {
    failures.push(`${label}: visible rows ${JSON.stringify(report.rows)} differ from canonical names, quantities and sides`);
  }
  if (table.lines.length && encoded === null) failures.push(`${label}: a populated sheet has no shareable URL table`);
  else if (!table.lines.length && encoded !== null) failures.push(`${label}: an empty sheet left table state in the URL`);
  if (report.total !== money(priced.subtotal)) failures.push(`${label}: total ${report.total} != ${money(priced.subtotal)}`);
  if (report.emptyHidden !== (clean.lines.length > 0)) failures.push(`${label}: empty note visibility does not match the sheet`);

  const [primary, secondary] = report.handoffs ?? [];
  if (!primary || !secondary) {
    failures.push(`${label}: one or both WhatsApp handoffs are missing`);
    return;
  }
  for (const [name, handoff] of [["primary", primary], ["secondary", secondary]]) {
    if (handoff.disabled !== !priced.count) failures.push(`${label}: ${name} disabled=${handoff.disabled} for ${priced.count} plates`);
    if (!priced.count && handoff.href !== "#") failures.push(`${label}: empty ${name} handoff still points to ${handoff.href}`);
  }
  if (!priced.count) return;

  const payload = tablePayload(report.contact, {
    table,
    claimed: priced.subtotal,
    day: report.day,
    time: report.time,
    when: report.when,
    origin: report.origin,
  });
  const primaryText = whatsappText(menu, table, report.when, report.origin);
  const secondaryText = primaryText + "\n\n" + requestMessage(payload);
  const expectedHrefs = [
    whatsappUrl(menu, table, report.when, report.origin),
    whatsAppHref(menu.meta.facts.whatsapp, secondaryText),
  ];
  if (primary.href !== expectedHrefs[0]) failures.push(`${label}: primary handoff href differs from the canonical recipient and message`);
  if (secondary.href !== expectedHrefs[1]) failures.push(`${label}: secondary handoff href differs from the canonical recipient and contact message`);
  if (primary.decodedWhatsAppText !== primaryText) failures.push(`${label}: primary decoded WhatsApp text differs from the canonical table message`);
  if (secondary.decodedWhatsAppText !== secondaryText) failures.push(`${label}: secondary decoded WhatsApp text differs from the table plus contact block`);
  if (report.contact?.name === "Amina & Co #2") {
    for (const token of ["Amina & Co #2", "+254 712 345 678", "Quiet 50% window · karibu 🌿 & #2"]) {
      if (!secondary.decodedWhatsAppText?.includes(token)) failures.push(`${label}: secondary message lost ${JSON.stringify(token)}`);
    }
  }
}

export async function auditTableParity({ evaluate, goto, results, failures, drain } = {}) {
  const label = "/table WhatsApp and canonical-state parity";
  // goto() clears the shared browser-event queue, so every phase must drain before the next navigation.
  // Otherwise an exception during side merging or URL reconciliation disappears from the final report.
  const record = (path, value) => {
    let logs = { errors: [], warnings: [] };
    try {
      logs = drain();
    } catch (error) {
      failures.push(`${path}: drain failed: ${error?.message ?? String(error)}`);
    }
    const errors = logs?.errors ?? [];
    const warnings = logs?.warnings ?? [];
    results.push({ path, value, errors, warnings });
    if (errors.length) failures.push(`${path}: ${errors.length} browser error(s): ${errors.slice(0, 3).join(" | ")}`);
  };
  let report;
  try {
    // The earlier basic /table battery changes the party. Start this audit from a known empty sheet so
    // its expectations do not depend on which route or control ran before it.
    await goto(routeTable({ party: 2, lines: [] }));
    report = await evaluate(battery);
  } catch (error) {
    report = { error: error?.message ?? String(error) };
  }
  record(label, report);
  if (!report || report.error || !report.steps) {
    failures.push(`${label}: battery failed: ${report?.error ?? "missing steps"}`);
    return report;
  }

  compareState(report.initial, failures, `${label} initial`, { party: 2, lines: [] });
  for (const selector of ["[data-whatsapp]", "[data-handoff]"]) {
    const guard = report.steps[selector + "Guard"];
    if (!guard?.prevented) failures.push(`${label}: empty ${selector} click was not prevented`);
    if (!guard?.message?.includes("add a dish")) failures.push(`${label}: empty ${selector} click gave no corrective guidance`);
  }
  if (report.steps.add?.table?.lines?.length !== 1) failures.push(`${label}: Add did not write exactly one line`);
  if (report.steps.increment?.table?.lines?.[0]?.qty !== 2) failures.push(`${label}: increment did not produce quantity 2`);
  compareState(report.steps.decrementToZero, failures, `${label} decrement-to-zero`, { party: 2, lines: [] });
  if (report.steps.decrementToZero?.rows?.length !== 0) failures.push(`${label}: decrement-to-zero left a visible row`);
  for (const selector of ["[data-whatsapp]", "[data-handoff]"]) {
    const index = selector === "[data-whatsapp]" ? 0 : 1;
    if (report.steps.decrementToZero?.handoffs?.[index]?.disabled !== true) failures.push(`${label}: decrement-to-zero did not disable ${selector}`);
  }
  if (report.steps.houseSet?.table?.lines?.length !== 6) failures.push(`${label}: house set did not produce six canonical lines`);
  compareState(report.steps.houseSet, failures, `${label} special characters`);
  if (report.steps.sideChange) compareState(report.steps.sideChange, failures, `${label} side change`);
  if (report.errors?.length) failures.push(`${label}: page battery errors: ${report.errors.join(" | ")}`);

  // A live option merge is reached through a URL-seeded sheet with two sides of one dish. It exercises the
  // control itself, not a localStorage edit: changing Mandy Rice to Chips must merge into the existing row.
  const mergeSeed = { party: 2, lines: [
    { id: "grilled-chicken-breast", option: "Chips", qty: 1 },
    { id: "grilled-chicken-breast", option: "Mandy Rice", qty: 2 },
  ] };
  const mergeExpected = { party: 2, lines: [{ id: "grilled-chicken-breast", option: "Chips", qty: 3 }] };
  let merge;
  try {
    await goto(routeTable(mergeSeed));
    merge = await evaluate(`
      const q = (s) => document.querySelector(s);
      const all = (s) => [...document.querySelectorAll(s)];
      const wait = (ms = 100) => new Promise((resolve) => setTimeout(resolve, ms));
      const snapshot = () => {
        const decoded = (s) => new URL(q(s).href, location.href).searchParams.get("text");
        const day = q("[data-when-day]").value;
        const time = q("[data-when-time]").value;
        const d = new Date(day + "T12:00:00Z");
        const when = d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }) + ", " + time;
        return {
          table: JSON.parse(localStorage.getItem("habibi-haven:table:v1") || "null"),
          rows: all("[data-lines] .line").map((row) => ({
        key: row.dataset.key,
        name: row.querySelector(".line__name b")?.textContent.trim() ?? null,
        note: row.querySelector(".line__name span")?.textContent.trim() ?? null,
        qty: Number(row.querySelector(".num")?.textContent),
        option: row.querySelector("[data-option]")?.value ?? null,
      })),
          total: q("[data-total]").textContent.trim(),
          emptyHidden: q("[data-empty]").hidden,
          when, day, time, origin: location.origin,
          contact: { name: q('[name="name"]').value, phone: q('[name="phone"]').value, notes: q('[name="notes"]').value },
          handoffs: ["[data-whatsapp]", "[data-handoff]"].map((s) => {
            const a = q(s);
            return { href: a.getAttribute("href"), disabled: a.getAttribute("aria-disabled") === "true", text: a.textContent.trim(), decodedWhatsAppText: decoded(s) };
          }),
          url: location.href,
        };
      };
      const before = snapshot();
      // render() replaces every row after a committed change, so a cached select is detached before the
      // next action. Resolve the current control for each dispatch rather than testing a dead DOM node.
      const side = (index) => all("[data-option]")[index];
      side(0).value = "Mashed Potatoes";
      side(0).dispatchEvent(new Event("change", { bubbles: true }));
      await wait();
      const afterSideChange = snapshot();
      side(0).value = "Chips";
      side(0).dispatchEvent(new Event("change", { bubbles: true }));
      await wait();
      side(1).value = "Chips";
      side(1).dispatchEvent(new Event("change", { bubbles: true }));
      await wait();
      const afterMerge = snapshot();
      q("[data-drop]").click(); await wait();
      const afterDrop = snapshot();
      q("[data-clear]").click(); await wait();
      const afterClear = snapshot();
      return { before, afterSideChange, afterMerge, afterDrop, afterClear };
    `);
  } catch (error) { merge = { error: error?.message ?? String(error) }; }
  record(`${label} merge/removal`, merge);
  if (!merge || merge.error) failures.push(`${label} merge/removal: ${merge?.error ?? "no report"}`);
  else {
    compareState(merge.before, failures, `${label} merge seed`, mergeSeed);
    compareState(merge.afterSideChange, failures, `${label} side rename`, { party: 2, lines: [
      { id: "grilled-chicken-breast", option: "Mashed Potatoes", qty: 1 },
      { id: "grilled-chicken-breast", option: "Mandy Rice", qty: 2 },
    ] });
    compareState(merge.afterMerge, failures, `${label} side merge`, mergeExpected);
    compareState(merge.afterDrop, failures, `${label} removal`, { party: 2, lines: [] });
    compareState(merge.afterClear, failures, `${label} clear`, { party: 2, lines: [] });
  }

  // Two distinct links prove URL precedence. A simulated router swap without ?t= must preserve the
  // current sheet and rewrite the URL; storage is read only on a fresh document load, not on every swap.
  let urls;
  let cleanup;
  const storageFixture = { party: 4, lines: [{ id: "karak-chai", qty: 3 }] };
  const urlFixtureB = { party: 3, lines: [{ id: "full-mandy", qty: 4 }] };
  try {
    await goto(routeTable(fixture));
    const first = await evaluate(`return (${snapshotSource()})();`);
    record(`${label} URL fixture A`, first);
    const swap = await evaluate(`
      localStorage.setItem("habibi-haven:table:v1", ${JSON.stringify(JSON.stringify(storageFixture))});
      history.pushState(history.state, "", "/table");
      document.dispatchEvent(new CustomEvent("astro:after-swap"));
      await new Promise((resolve) => setTimeout(resolve, 150));
      return (${snapshotSource()})();
    `);
    record(`${label} router swap preserves current sheet`, swap);
    await goto("/table");
    const storageReload = await evaluate(`return (${snapshotSource()})();`);
    record(`${label} fresh load reads storage`, storageReload);
    await goto(routeTable(urlFixtureB));
    const second = await evaluate(`return (${snapshotSource()})();`);
    record(`${label} URL fixture B`, second);
    urls = { first, swap, storageReload, second };
  } catch (error) {
    urls = { error: error?.message ?? String(error) };
  } finally {
    try {
      cleanup = await evaluate(`
        const q = (s) => document.querySelector(s);
        q("[data-clear]")?.click();
        await new Promise((resolve) => setTimeout(resolve, 150));
        return (${snapshotSource()})();
      `);
    } catch (error) {
      cleanup = { error: error?.message ?? String(error) };
    }
    record(`${label} cleanup`, cleanup);
  }
  if (!urls || urls.error) failures.push(`${label} router URLs: ${urls?.error ?? "no report"}`);
  else {
    compareState(urls.first, failures, `${label} URL fixture A`, fixture);
    compareState(urls.swap, failures, `${label} swap preserves current URL table`, fixture, { allowStaleStorage: true });
    compareState(urls.storageReload, failures, `${label} fresh load reads storage`, storageFixture);
    compareState(urls.second, failures, `${label} URL fixture B wins over storage`, urlFixtureB);
    if (!urls.swap?.url?.includes("?t=")) failures.push(`${label}: current table was not reconciled back into the URL after the swap`);
    if (JSON.stringify(urls.first.table) === JSON.stringify(urls.second.table)) failures.push(`${label}: the two encoded table fixtures were not distinct`);
  }
  if (!cleanup || cleanup.error) failures.push(`${label} cleanup: ${cleanup?.error ?? "no report"}`);
  else compareState(cleanup, failures, `${label} cleanup`, { party: 3, lines: [] });
  return report;
}

// Kept as a string because it runs in the browser. It reads the same public state as the main battery without
// depending on that battery's local helpers.
function snapshotSource() {
  return `() => {
    const q = (s) => document.querySelector(s);
    const all = (s) => [...document.querySelectorAll(s)];
    const day = q("[data-when-day]").value;
    const time = q("[data-when-time]").value;
    const d = new Date(day + "T12:00:00Z");
    const when = d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }) + ", " + time;
    return {
      table: JSON.parse(localStorage.getItem("habibi-haven:table:v1") || "null"),
      rows: all("[data-lines] .line").map((row) => ({
        key: row.dataset.key,
        name: row.querySelector(".line__name b")?.textContent.trim() ?? null,
        note: row.querySelector(".line__name span")?.textContent.trim() ?? null,
        qty: Number(row.querySelector(".num")?.textContent),
        option: row.querySelector("[data-option]")?.value ?? null,
      })),
      total: q("[data-total]")?.textContent.trim() ?? null,
      emptyHidden: q("[data-empty]")?.hidden ?? null,
      when, day, time, origin: location.origin,
      contact: { name: q('[name="name"]').value, phone: q('[name="phone"]').value, notes: q('[name="notes"]').value },
      handoffs: ["[data-whatsapp]", "[data-handoff]"].map((s) => {
        const a = q(s);
        return { href: a?.getAttribute("href") ?? null, disabled: a?.getAttribute("aria-disabled") === "true", text: a?.textContent.trim() ?? null, decodedWhatsAppText: a ? new URL(a.href, location.href).searchParams.get("text") : null };
      }),
      url: location.href,
    };
  }`;
}

export { compareState };
