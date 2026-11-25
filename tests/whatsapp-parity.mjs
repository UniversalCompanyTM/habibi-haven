import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { tablePayload, requestMessage, whatsAppHref } from "../site/src/lib/request-client.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const source = (path) => readFile(new URL(path, `file://${ROOT.replaceAll("\\", "/")}/`), "utf8");

test("the contact handoff preserves special characters exactly through WhatsApp encoding", () => {
  const payload = tablePayload({
    party: "2",
    name: "Amina & Co",
    phone: "+254 712 345 678",
    notes: "Quiet #2 · 50% window · karibu 🌿",
  }, {
    table: { party: 2, lines: [
      { id: "grilled-chicken-breast", option: "Mandy Rice", qty: 1 },
      { id: "grilled-chicken-breast", option: "Chips", qty: 2 },
    ] },
    claimed: 4050,
    day: "2026-11-25",
    time: "19:00",
    when: "Wed, 25 Nov, 19:00",
  });
  const message = `${"2 × Grilled Chicken Breast (Mandy Rice) — KSh 1,350"}\n\n${requestMessage(payload)}`;
  const href = whatsAppHref("254116880000", message);
  assert.equal(new URL(href).searchParams.get("text"), message);
  assert.equal(payload.contact.name, "Amina & Co");
  assert.equal(payload.notes, "Quiet #2 · 50% window · karibu 🌿");
  assert.deepEqual(payload.lines, [
    { id: "grilled-chicken-breast", option: "Mandy Rice", qty: 1 },
    { id: "grilled-chicken-breast", option: "Chips", qty: 2 },
  ]);
});

test("both table handoffs share one empty-sheet policy and a click guard", async () => {
  const [builder, runtime, probe] = await Promise.all([
    source("site/src/components/TableBuilder.astro"),
    source("scripts/verify-runtime.mjs"),
    source("scripts/table-runtime-probe.mjs"),
  ]);
  assert.match(builder, /handoffEl\.href = "#";/, "the secondary handoff must not open a restaurant chat from an empty sheet");
  assert.match(builder, /handoffEl\.setAttribute\("aria-disabled", "true"\);/, "the secondary handoff must announce that it is disabled");
  assert.match(builder, /target\?\.closest\?\.\("\[data-whatsapp\],\[data-handoff\]"\)/, "an empty secondary handoff must be guarded against keyboard and pointer activation");
  assert.match(runtime, /auditTableParity\(/, "the browser harness must run the table parity audit");
  assert.match(probe, /decodedWhatsAppText/, "runtime verification must decode the complete WhatsApp messages");
});

test("side-change actions re-query rows that the renderer replaces", async () => {
  const probe = await source("scripts/table-runtime-probe.mjs");
  assert.doesNotMatch(probe, /const sides = all\("\[data-option\]"\);[\s\S]*?sides\[0\]\.dispatchEvent/,
    "a cached select is detached after the first render and cannot exercise the next change");
  assert.match(probe, /const side = \(index\) => all\("\[data-option\]"\)\[index\];/,
    "every side action must resolve the current rendered select");
});

test("every standalone URL snapshot returns through the async evaluate adapter", async () => {
  const probe = await source("scripts/table-runtime-probe.mjs");
  assert.doesNotMatch(probe, /evaluate\(snapshotSource\(\)\)/, "an expression body evaluates to undefined inside the harness's async wrapper");
  const standalone = probe.match(/= await evaluate\(`return \(\$\{snapshotSource\(\)\}\)\(\);`\)/g) ?? [];
  assert.equal(standalone.length, 3,
    "both URL fixtures and the fresh storage load must explicitly return their snapshots");
});
