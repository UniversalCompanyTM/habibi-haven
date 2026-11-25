import assert from "node:assert/strict";
import test from "node:test";
import menu from "../site/src/data/menu.json" with { type: "json" };
import { encodeTable, money, sanitizeTable, totals, whatsappText, whatsappUrl } from "../site/src/lib/table.mjs";
import { requestMessage, tablePayload } from "../site/src/lib/request-client.mjs";
import { compareState } from "../scripts/table-runtime-probe.mjs";

const origin = "https://habibihavenpreview.pages.dev";
const table = { party: 2, lines: [
  { id: "grilled-chicken-breast", option: "Chips", qty: 1 },
  { id: "grilled-chicken-breast", option: "Mandy Rice", qty: 2 },
] };

function snapshot(candidate = table, contact = { name: "Amina & Co #2", phone: "+254 712 345 678", notes: "Quiet 50% window · karibu 🌿 & #2" }) {
  const clean = sanitizeTable(menu, candidate);
  const priced = totals(menu, clean);
  const fields = { day: "2026-11-25", time: "19:00", when: "Wed, 25 Nov, 19:00" };
  const primary = whatsappText(menu, clean, fields.when, origin);
  const payload = tablePayload(contact, { table: clean, claimed: priced.subtotal, ...fields, origin });
  const secondary = primary + "\n\n" + requestMessage(payload);
  return {
    table: clean,
    rows: priced.rows.map((row) => ({
      key: row.key,
      name: row.name,
      note: `${money(row.unit)} × ${row.qty}${row.unavailable ? " · showing unavailable" : ""}`,
      qty: row.qty,
      option: row.option ?? null,
    })),
    total: money(priced.subtotal),
    emptyHidden: clean.lines.length > 0,
    ...fields,
    origin,
    contact,
    handoffs: clean.lines.length ? [
      { href: whatsappUrl(menu, clean, fields.when, origin), disabled: false, text: "Send it on WhatsApp", decodedWhatsAppText: primary },
      { href: `https://wa.me/254116880000?text=${encodeURIComponent(secondary)}`, disabled: false, text: "Send it on WhatsApp with my details", decodedWhatsAppText: secondary },
    ] : [
      { href: "#", disabled: true, text: "Add something first", decodedWhatsAppText: null },
      { href: "#", disabled: true, text: "Add a dish first", decodedWhatsAppText: null },
    ],
    url: clean.lines.length ? `${origin}/table?t=${encodeURIComponent(encodeTable(clean))}` : `${origin}/table`,
  };
}

test("the runtime comparison accepts exact canonical messages with distinct sides and Unicode", () => {
  const failures = [];
  compareState(snapshot(), failures, "valid table");
  assert.deepEqual(failures, []);
});

test("the runtime comparison rejects one altered character in either decoded message", () => {
  for (const index of [0, 1]) {
    const report = snapshot();
    report.handoffs[index].decodedWhatsAppText += " altered";
    const failures = [];
    compareState(report, failures, `message ${index}`);
    assert.ok(failures.some((failure) => failure.includes("decoded WhatsApp text differs")), failures.join("\n"));
  }
});

test("the runtime comparison rejects an enabled empty handoff and a stale visible row", () => {
  const report = snapshot({ party: 2, lines: [] });
  report.handoffs = report.handoffs.map((handoff, index) => ({
    ...handoff,
    href: index ? "https://wa.me/254116880000" : "#",
    disabled: index === 0,
    decodedWhatsAppText: null,
  }));
  report.rows = [{ key: "full-mandy", name: "Full Mandy", note: "KSh 2,300 × 1", qty: 1, option: null }];
  const failures = [];
  compareState(report, failures, "empty table");
  assert.ok(failures.some((failure) => failure.includes("secondary disabled=false")));
  assert.ok(failures.some((failure) => failure.includes("empty secondary handoff still points")));
  assert.ok(failures.some((failure) => failure.includes("visible rows")));
});

test("the runtime comparison rejects a stale visible quantity even when the row key is right", () => {
  const report = snapshot();
  report.rows[0].qty = 2;
  report.rows[0].note = "KSh 1,350 × 2";
  const failures = [];
  compareState(report, failures, "stale quantity");
  assert.ok(failures.some((failure) => failure.includes("visible rows")), failures.join("\n"));
});

test("the runtime comparison rejects a wrong WhatsApp recipient even when the decoded body is exact", () => {
  const report = snapshot();
  report.handoffs[0].href = report.handoffs[0].href.replace("wa.me/254116880000", "wa.me/254700000000");
  const failures = [];
  compareState(report, failures, "wrong recipient");
  assert.ok(failures.some((failure) => failure.includes("primary handoff href")), failures.join("\n"));
});

test("the runtime comparison rejects a share URL that disagrees with the canonical sheet", () => {
  const report = snapshot();
  report.url = `${origin}/table?t=${encodeURIComponent(encodeTable({ party: 4, lines: [{ id: "karak-chai", qty: 3 }] }))}`;
  const failures = [];
  compareState(report, failures, "wrong URL");
  assert.ok(failures.some((failure) => failure.includes("URL table differs")), failures.join("\n"));
});

test("the runtime comparison rejects a side merge that collapses quantity or identity incorrectly", () => {
  const report = snapshot();
  report.table.lines = [{ id: "grilled-chicken-breast", option: "Chips", qty: 3 }];
  report.rows = [{ key: "grilled-chicken-breast::Chips", name: "Grilled Chicken Breast", note: "KSh 1,350 × 3", qty: 3, option: "Chips" }];
  report.total = "KSh 4,050";
  const failures = [];
  compareState(report, failures, "side merge", table);
  assert.ok(failures.some((failure) => failure.includes("canonical table differs")));
});
