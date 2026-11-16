// site/src/lib/request-client.mjs — what the browser sends to the Worker, and what it does with the answer.
//
// Shape rules, all of them inherited from backend/src/validate.mjs rather than invented here:
//   · `contact` is nested ({ name, phone }); flattening it to `contactName` produces two `required` errors
//     and a guest who cannot tell what they did wrong.
//   · `party` is a number, not the string a FormData hands back.
//   · `visitDate` / `visitTime` are the machine-checked pair (`YYYY-MM-DD`, `HH:MM` in Africa/Nairobi).
//     `when` is a free-text label the server stores without policing, so a time goes in the pair.
//   · `source` is an https URL or absent — the schema forbids anything else.
//
// What this file deliberately does NOT do: re-state the restaurant's policy. The opening window is enforced
// in the markup by `min`/`max` on the time input and on the server by the hours row read out of D1, so there
// is no third copy of 06:30–23:00 here to drift. The same goes for the booking horizon, the name length and
// the phone format: the browser's own `required`/`type` checks give the guest an instant answer, and the
// server's 422 gives the real one. Anything the server might refuse is the server's to define.
//
// Every function here is pure except `submitRequest`, which touches only `fetch` — so tests/run.mjs can pin
// the payload and the outcome mapping with no DOM and no network, and check-ssr-safety can import the module
// in Node.

/** The one field order the Worker expects. `values` is whatever FormData gave you. */
export function reservationPayload(values, { origin, kind = "reservation" } = {}) {
  const text = (v) => (typeof v === "string" ? v.trim() : "");
  const payload = {
    kind,
    party: Number(text(values.party)) || null,
    visitDate: text(values.date) || null,
    visitTime: text(values.time) || null,
    contact: { name: text(values.name), phone: text(values.phone) },
  };
  const notes = text(values.notes);
  if (notes) payload.notes = notes;
  const when = text(values.when);
  if (when) payload.when = when;
  if (origin) payload.source = `${origin.replace(/\/$/, "")}/visit`;
  return payload;
}

/**
 * The built table from /table, in the shape `kind:"table"` wants.
 *
 * `values` is the two-or-three fields the record form adds (name, phone, an optional note); everything else is
 * already on the sheet, so it arrives as context rather than as form fields: `table` is the guest's
 * `{ party, lines }` from lib/table-client.mjs, `claimed` is what lib/table.mjs priced it at, and
 * `day` / `time` / `whenLabel` are the sheet's own When controls.
 *
 * Four rules in here that the reservation payload does not have to care about:
 *  · the lines carry item ids and quantities, never names or prices. The Worker looks the money up in its own
 *    database, so a price written by the page would be ignored at best — and if it were the only number sent,
 *    it would be a bill the kitchen never agreed to (backend/src/index.mjs `createRequest`);
 *  · `claimedSubtotal` goes as the guest's figure and nothing else: it is stored beside the server's total and
 *    the gap is reported back rather than buried. A non-integer is dropped rather than sent, because the
 *    Worker 422s on `claimedSubtotal` and losing the drift is cheaper than failing the whole request;
 *  · the day/time pair travels whole or not at all. For a table the Worker validates the pair whenever either
 *    half is present, so a lone `19:00` would be a 422 about a date the guest never saw;
 *  · `when` is a label the server stores unpolicied up to 60 characters. A longer string is dropped instead of
 *    truncated, because silently cutting a person's words in half is an edit, not a fallback.
 */
export function tablePayload(values, { table, claimed, day, time, when: whenLabel, origin } = {}) {
  const text = (v) => (typeof v === "string" ? v.trim() : "");
  const party = Number(text(values?.party) || table?.party);

  const payload = {
    kind: "table",
    party: Number.isFinite(party) && party > 0 ? Math.round(party) : null,
    contact: { name: text(values?.name), phone: text(values?.phone) },
    lines: (table?.lines ?? []).flatMap((line) => {
      const qty = Number(line?.qty);
      if (!line?.id || !Number.isInteger(qty) || qty < 1) return [];
      return [{ id: line.id, ...(line.option ? { option: line.option } : {}), qty }];
    }),
  };

  const date = text(day);
  const hour = text(time);
  if (date && hour) {
    payload.visitDate = date;
    payload.visitTime = hour;
  }

  const claim = Number(claimed);
  if (Number.isInteger(claim) && claim >= 0) payload.claimedSubtotal = claim;

  const when = text(whenLabel);
  if (when && when.length <= 60) payload.when = when;

  const notes = text(values?.notes);
  if (notes) payload.notes = notes;

  if (origin) payload.source = `${String(origin).replace(/\/$/, "")}/table`;
  return payload;
}

/**
 * Turn a Worker response into one of five things the page knows how to say. Kept separate from the fetch so
 * the mapping is testable: `status` is the HTTP code, `body` the parsed JSON or null, `network` true when the
 * request never completed.
 */
export function outcome({ status, body, network = false }) {
  if (network) return { kind: "unreachable" };
  // `priceDrift` is the server's own arithmetic on the gap between what the page thought the table cost and
  // what their price list says. It arrives null when no claim was sent, and null when the two agree — the page
  // has to be able to tell "nothing to report" from "they matched", which is why it is passed through as the
  // object the Worker sent rather than flattened into a number here.
  if (status === 201 && body?.reference)
    return { kind: "recorded", reference: body.reference, totalKes: body.totalKes ?? null, priceDrift: body.priceDrift ?? null };
  if (status === 422) return { kind: "invalid", messages: errorMessages(body), fields: errorFields(body) };
  if (status === 429)
    return { kind: "busy", retryAfterSeconds: Number.isFinite(body?.retry_after_seconds) ? body.retry_after_seconds : null };
  return { kind: "failed", status, messages: errorMessages(body) };
}

const errorMessages = (body) =>
  Array.isArray(body?.errors) && body.errors.length
    ? body.errors.map((e) => e.message || `${e.field}: ${e.code}`)
    : [body?.message || "The kitchen's server did not explain itself."];

const errorFields = (body) =>
  Array.isArray(body?.errors) ? body.errors.map((e) => e.field).filter((f) => typeof f === "string") : [];

export function requestMessage(payload) {
  // A table payload's dishes, party, when and estimate already live in the sheet message the page builds with
  // `whatsappText` (lib/table.mjs), because that is the one place the names and prices are known. Repeating
  // them here would put the same number twice in one text a floor manager reads, so the fallback for /table is
  // the contact block only — and the two halves are documented as a pair in TableBuilder's submit handler.
  if (payload.kind === "table") {
    const lines = [
      "Table request — Habibi Haven",
      `Name: ${payload.contact?.name || "—"}`,
      `Phone: ${payload.contact?.phone || "—"}`,
    ];
    if (payload.visitDate || payload.visitTime) lines.push(`For: ${payload.visitDate || "?"} at ${payload.visitTime || "?"}`);
    lines.push(`Party: ${payload.party ?? "?"}`);
    if (payload.notes) lines.push(`Note: ${payload.notes}`);
    return lines.join("\n");
  }
  const lines = [
    `Table request — Habibi Haven`,
    `Name: ${payload.contact?.name || "—"}`,
    `Phone: ${payload.contact?.phone || "—"}`,
    `For: ${payload.visitDate || "?"} at ${payload.visitTime || "?"}`,
    `Party: ${payload.party ?? "?"}`,
  ];
  if (payload.notes) lines.push(`Note: ${payload.notes}`);
  return lines.join("\n");
}

/** Handoff link. Used twice: the no-JavaScript anchor, and the retry when the server could not be reached. */
export function whatsAppHref(number, message) {
  return `https://wa.me/${String(number).replace(/\D/g, "")}?text=${encodeURIComponent(message)}`;
}

/**
 * POST and never throw. A guest on courtyard Wi-Fi gets a fallback, not a dead button, so the difference
 * between "the server said no" and "the server was not reached" is preserved rather than flattened into an
 * exception. `post` is injectable for the tests.
 */
export async function submitRequest(base, payload, { post = globalThis.fetch, signal } = {}) {
  if (!base || typeof post !== "function") return outcome({ network: true });
  try {
    const res = await post(`${base.replace(/\/$/, "")}/v1/requests`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      ...(signal ? { signal } : {}),
    });
    let body = null;
    try {
      body = await res.json();
    } catch {
      body = null;
    }
    return outcome({ status: res.status, body });
  } catch {
    return outcome({ network: true });
  }
}
