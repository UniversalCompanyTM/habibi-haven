// backend/src/validate.mjs — what the server accepts as a guest request, and what it is worth.
//
// The browser already prices the table. This module exists because a price the browser computed is a
// price the browser chose: `POST /v1/requests` receives item ids and quantities, looks the money up in
// its own database and writes *that*. The total the page claimed is stored alongside as evidence of
// drift and is never used as an amount.
//
// Two rules keep the module testable:
//   1. no I/O, no ambient clock — the price list, the hours window and `now` arrive as arguments;
//   2. no re-typed hours. The window is data read from D1, seeded from the same build that wrote
//      site/src/data/menu.json, so this file cannot drift from site/src/lib/hours.mjs by an edit here.
//      tests/api.mjs still sweeps the two implementations against each other, because "the numbers came
//      from the same place" is a claim about the pipeline, not a proof about the arithmetic.
//
// Nothing here invents restaurant policy. A reservation is accepted when it falls inside the hours of
// record and is not in the past; last seating, deposits, minimum spends and cancellation windows are
// Habibi's to decide, not ours (docs/OPEN-QUESTIONS.md).

export const KINDS = ["table", "reservation"];

export const LIMITS = {
  nameMin: 2,
  nameMax: 80,
  notesMax: 500,
  whenMax: 60,
  optionMax: 60,
  itemIdMax: 64,
  partyMin: 1,
  partyMax: 30,
  qtyMin: 1,
  qtyMax: 99,
  linesMax: 40,
  subtotalMax: 10_000_000,
  sourceMax: 300,
  horizonDays: 90,
  phoneDigitsMin: 9,
  phoneDigitsMax: 15,
};

// Africa/Nairobi is UTC+3 all year — no DST to get wrong, and no host timezone to read.
export const NAIROBI_OFFSET_MINUTES = 180;

const CONTROL = /[\u0000-\u001f\u007f]/g;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_RE = /^(\d{2}):(\d{2})$/;

/* ------------------------------------------------------------------- text */

/**
 * Trim, drop control characters, collapse runs of space, refuse anything over `max`.
 *
 * Control characters go because these strings come back out again — on the guest's confirmation, and
 * in whatever view the floor manager is given one day. A name containing ESC or a NUL is not a name.
 */
export function cleanText(raw, { field, max, min = 1, required = true, errors }) {
  if (raw === undefined || raw === null || raw === "") {
    if (required) errors.push({ field, code: "required", message: "This is needed." });
    return null;
  }
  if (typeof raw !== "string") {
    errors.push({ field, code: "not_text", message: "This has to be text." });
    return null;
  }
  const value = raw.replace(CONTROL, "").replace(/\s+/g, " ").trim();
  if (!value) {
    if (required) errors.push({ field, code: "required", message: "This is needed." });
    return null;
  }
  if (value.length > max) {
    errors.push({ field, code: "too_long", message: `Keep this under ${max} characters.`, limit: max, got: value.length });
    return null;
  }
  if (value.length < min) {
    errors.push({ field, code: "too_short", message: `At least ${min} characters.`, limit: min, got: value.length });
    return null;
  }
  return value;
}

/**
 * Kenyan numbers only, normalised to the 254 form the WhatsApp handoff and Daraja both want.
 *
 * `0712 345 678` and `+254 712 345 678` are the same phone; `555-0100` is not a number this restaurant
 * can call back, and guessing which country it belongs to is not something to do to a reservation.
 * The rejection message names the shape instead of saying "invalid", because that is the difference
 * between a guest fixing it and a guest giving up.
 */
export function normalizePhone(raw, { field = "contact.phone", errors } = {}) {
  const report = (code, message) => {
    if (errors) errors.push({ field, code, message });
    return null;
  };
  if (typeof raw !== "string" && typeof raw !== "number") return report("required", "A phone number we can call you back on.");
  const text = String(raw);
  if (text.length > 24) return report("too_long", "That is not a phone number.");
  const digits = text.replace(/[^\d]/g, "");
  if (digits.length < LIMITS.phoneDigitsMin || digits.length > LIMITS.phoneDigitsMax)
    return report("bad_number", "Use a Kenyan mobile number, like 0712 345 678 or +254 712 345 678.");
  if (digits.startsWith("0")) return `254${digits.slice(1)}`;
  if (digits.startsWith("254")) return digits;
  return report("bad_number", "Use a Kenyan mobile number, like 0712 345 678 or +254 712 345 678.");
}

/* ------------------------------------------------------------------ clock */

export function minutesOfDay(hhmm) {
  const m = TIME_RE.exec(String(hhmm ?? ""));
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

/** Half-open, same as the site: the room is open at 06:30 and closed at 23:00. */
export function isOpenAt(minutes, hours) {
  return Number.isFinite(minutes) && minutes >= hours.openMinutes && minutes < hours.closeMinutes;
}

/**
 * Wall time the guest typed, read as Nairobi time, returned as an epoch and an ISO instant.
 *
 * The round trip is the check: `Date.UTC` happily turns 2026-02-31 into 2026-03-03, so re-deriving the
 * parts from the instant and comparing them is what makes a non-existent date a validation error
 * instead of a reservation on a day that never happened.
 */
export function toNairobiInstant(dateStr, timeStr) {
  const d = DATE_RE.exec(String(dateStr ?? ""));
  const t = TIME_RE.exec(String(timeStr ?? ""));
  if (!d || !t) return null;
  const [y, mo, day] = [Number(d[1]), Number(d[2]), Number(d[3])];
  const [h, min] = [Number(t[1]), Number(t[2])];
  if (mo < 1 || mo > 12 || day < 1 || day > 31 || h > 23 || min > 59) return null;
  const wall = Date.UTC(y, mo - 1, day, h, min);
  if (Number.isNaN(wall)) return null;
  const instant = wall - NAIROBI_OFFSET_MINUTES * 60_000;
  const back = new Date(instant + NAIROBI_OFFSET_MINUTES * 60_000);
  const same =
    back.getUTCFullYear() === y &&
    back.getUTCMonth() === mo - 1 &&
    back.getUTCDate() === day &&
    back.getUTCHours() === h &&
    back.getUTCMinutes() === min;
  if (!same) return null;
  return { instant, iso: new Date(instant).toISOString(), minutes: h * 60 + min };
}

/* ------------------------------------------------------------------ money */

/**
 * Reprice a list of `{ id, option, qty }` against the server's own price list.
 *
 * Three decisions, all of them about what a bill is allowed to do:
 *  - an id the catalog does not have fails the whole request. Silently dropping a row would hand the
 *    venue a bill that leaves something off, which is worse than an error on screen;
 *  - the amount is `catalog price × qty`, never `client line total`;
 *  - an item marked unavailable is kept and flagged, because the site shows the same thing and offers
 *    a swap — refusing the request over a sold-out side dish is not a service to anyone.
 */
export function reprice(items, lines, { errors }) {
  if (!Array.isArray(lines)) {
    errors.push({ field: "lines", code: "required", message: "Choose at least one dish." });
    return { rows: [], subtotal: 0, itemCount: 0, unavailableCount: 0 };
  }
  if (lines.length > LIMITS.linesMax) {
    errors.push({ field: "lines", code: "too_many", message: `At most ${LIMITS.linesMax} different dishes on one table.` });
    return { rows: [], subtotal: 0, itemCount: 0, unavailableCount: 0 };
  }

  // Merging duplicates by id+option first means a payload that sends the same line twice bills once,
  // with the quantities added — the same rule the browser applies in table.mjs `addLine`.
  const merged = new Map();
  const unknown = [];
  for (const [i, line] of lines.entries()) {
    if (!line || typeof line !== "object") {
      errors.push({ field: `lines[${i}]`, code: "shape", message: "Each line needs an item id and a quantity." });
      continue;
    }
    const id = typeof line.id === "string" ? line.id.trim() : "";
    if (!id || id.length > LIMITS.itemIdMax) {
      errors.push({ field: `lines[${i}].id`, code: "bad_id", message: "That dish is not on the menu we have." });
      continue;
    }
    const item = items.get(id);
    if (!item) {
      if (unknown.length < 5) unknown.push(id);
      else if (unknown.length === 5) unknown.push("…");
      continue;
    }
    const qty = Number(line.qty);
    if (!Number.isInteger(qty) || qty < LIMITS.qtyMin || qty > LIMITS.qtyMax) {
      errors.push({ field: `lines[${i}].qty`, code: "bad_qty", message: `Quantity has to be a whole number from ${LIMITS.qtyMin} to ${LIMITS.qtyMax}.` });
      continue;
    }
    const option =
      line.option === undefined || line.option === null || line.option === ""
        ? null
        : cleanText(line.option, { field: `lines[${i}].option`, max: LIMITS.optionMax, errors });
    const key = option === null ? id : `${id}::${option}`;
    const seen = merged.get(key);
    if (seen) seen.qty = Math.min(LIMITS.qtyMax, seen.qty + qty);
    else merged.set(key, { id, name: item.name, option, unit: item.price, qty, available: item.available !== false });
  }
  if (unknown.length) {
    errors.push({
      field: "lines",
      code: "unknown_items",
      message: "Some of these are not on the menu we have. Reload the page and try again.",
      ids: unknown,
    });
  }

  const rows = [];
  let subtotal = 0;
  let itemCount = 0;
  let unavailableCount = 0;
  for (const row of merged.values()) {
    const amount = row.unit * row.qty;
    subtotal += amount;
    itemCount += row.qty;
    if (!row.available) unavailableCount += 1;
    rows.push({ ...row, amount });
  }
  if (subtotal > LIMITS.subtotalMax) {
    errors.push({ field: "lines", code: "too_large", message: "That total is beyond what this form can take — call us and we will plan it." });
    return { rows: [], subtotal: 0, itemCount: 0, unavailableCount: 0 };
  }
  return { rows, subtotal, itemCount, unavailableCount };
}

/* ------------------------------------------------------------------ entry */

/**
 * @param payload  the parsed JSON body
 * @param ctx      { items: Map<id, {id,name,price,available}>, hours: {open, close, openMinutes, closeMinutes}, now: Date }
 * @returns {{ ok: boolean, errors: object[], value?: object }}
 */
export function parseRequest(payload, ctx) {
  const errors = [];
  const value = {};
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return { ok: false, errors: [{ field: "_body", code: "shape", message: "Expected a JSON object." }] };
  }

  const kind = payload.kind;
  if (!KINDS.includes(kind)) {
    errors.push({ field: "kind", code: "bad_kind", message: `kind must be one of ${KINDS.join(" or ")}.`, got: kind ?? null });
  } else {
    value.kind = kind;
  }

  // Party: required for a reservation (it is the whole request), a stated preference for a table.
  if (payload.party === undefined || payload.party === null || payload.party === "") {
    if (kind === "reservation") errors.push({ field: "party", code: "required", message: "How many of you?" });
    else value.party = null;
  } else {
    const party = Number(payload.party);
    if (!Number.isInteger(party) || party < LIMITS.partyMin || party > LIMITS.partyMax)
      errors.push({ field: "party", code: "bad_party", message: `A party is a whole number from ${LIMITS.partyMin} to ${LIMITS.partyMax}.` });
    else value.party = party;
  }

  const name = cleanText(payload.contact?.name, { field: "contact.name", max: LIMITS.nameMax, min: LIMITS.nameMin, errors });
  const phone = normalizePhone(payload.contact?.phone, { errors });
  if (name) value.name = name;
  if (phone) value.phone = phone;

  const notes = cleanText(payload.notes, { field: "notes", max: LIMITS.notesMax, required: false, errors });
  if (notes) value.notes = notes;

  const when = cleanText(payload.when, { field: "when", max: LIMITS.whenMax, required: false, errors });
  if (when) value.whenLabel = when;

  // The share link is stored so a recorded table can be re-opened exactly as it was built. It is
  // restricted to https and to a length because the column must not become a link farm.
  if (payload.source !== undefined && payload.source !== null && payload.source !== "") {
    if (typeof payload.source !== "string" || payload.source.length > LIMITS.sourceMax || !payload.source.startsWith("https://"))
      errors.push({ field: "source", code: "bad_source", message: "An https link or nothing." });
    else value.source = payload.source;
  }

  /* One visit checker, two callers.
     These branches used to be separate prose, and they drifted: the reservation asked whether the guest had
     picked a time that had already gone by or more than `horizonDays` out, and the table asked neither. So
     `kind:"table"` accepted a request for yesterday, or for 2031, wrote it into the book, and handed back a
     reference that promised the kitchen had the request. The date is the same field with the same meaning on
     both routes — when the guest intends to arrive — which makes one rule, not two.
     The remaining difference is real and kept: a reservation without a date is a broken reservation, while a
     table's `When` is optional (the sheet is the point), so the table branch only calls this when something was
     sent. */
  function checkVisit(visit, errors) {
    if (!isOpenAt(visit.minutes, ctx.hours)) {
      errors.push({
        field: "visitTime",
        code: "outside_hours",
        message: `We show the room open ${ctx.hours.open}–${ctx.hours.close}. Pick a time inside that.`,
        hours: { open: ctx.hours.open, close: ctx.hours.close },
      });
      return null;
    }
    const dayMs = 86_400_000;
    if (visit.instant < ctx.now.getTime()) {
      errors.push({ field: "visitDate", code: "in_the_past", message: "That time has already gone by." });
      return null;
    }
    if (visit.instant > ctx.now.getTime() + LIMITS.horizonDays * dayMs) {
      errors.push({
        field: "visitDate",
        code: "too_far_ahead",
        message: `We can hold a request for ${LIMITS.horizonDays} days. For later, call us.`,
      });
      return null;
    }
    return visit.iso;
  }

  if (kind === "reservation") {
    const visit = toNairobiInstant(payload.visitDate, payload.visitTime);
    if (!visit) {
      errors.push({ field: "visitDate", code: "bad_visit", message: "Pick a date and a time, like 2026-11-22 and 19:00." });
    } else {
      const at = checkVisit(visit, errors);
      if (at) value.visitAt = at;
    }
  } else if (kind === "table") {
    if (payload.visitDate || payload.visitTime) {
      const visit = toNairobiInstant(payload.visitDate, payload.visitTime);
      if (!visit) errors.push({ field: "visitDate", code: "bad_visit", message: "Pick a date and a time, like 2026-11-22 and 19:00." });
      else {
        const at = checkVisit(visit, errors);
        if (at) value.visitAt = at;
      }
    }
  }

  // Priced lines are what a "table" is. A reservation may still carry dishes — a booked table with the
  // meal agreed in advance is a normal thing to ask a restaurant for — so lines stay optional here.
  const hasLines = payload.lines !== undefined && payload.lines !== null;
  if (kind === "table" || hasLines) {
    const priced = reprice(ctx.items, payload.lines ?? [], { errors });
    if (!priced.rows.length && kind === "table" && !errors.some((e) => e.field === "lines"))
      errors.push({ field: "lines", code: "required", message: "Choose at least one dish." });
    value.rows = priced.rows;
    value.subtotal = priced.subtotal;
    value.itemCount = priced.itemCount;
    value.lineCount = priced.rows.length;
    value.unavailableCount = priced.unavailableCount;
  } else {
    value.rows = [];
    value.subtotal = 0;
    value.itemCount = 0;
    value.lineCount = 0;
    value.unavailableCount = 0;
  }

  // What the page thought the total was. Kept only to measure the gap between the two, and answered to
  // the guest in plain words when there is one — the price list moves and nobody should find out at the
  // table.
  if (payload.claimedSubtotal !== undefined && payload.claimedSubtotal !== null && payload.claimedSubtotal !== "") {
    const claimed = Number(payload.claimedSubtotal);
    if (!Number.isInteger(claimed) || claimed < 0 || claimed > LIMITS.subtotalMax)
      errors.push({ field: "claimedSubtotal", code: "bad_claim", message: "The total you sent is not a number we can check." });
    else value.claimed = claimed;
  }

  if (errors.length) return { ok: false, errors };
  value.priceDelta = value.claimed === undefined ? null : value.subtotal - value.claimed;
  return { ok: true, errors: [], value };
}
