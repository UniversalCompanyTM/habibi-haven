// site/src/lib/hours.mjs — the one hours model, and the curve the light rig reads from it.
//
// Decision 11 of the plan: the hours of record are 06:30–23:00 daily, from Google Maps, because that
// is what the listing a customer actually checks says. Two other numbers exist upstream and stay
// visible rather than smoothed over: menu.or.ke computes open/closed against 06:00, and the Uber Eats
// store shows 09:00–17:00 while flagged "Currently unavailable" (a delivery window, not opening
// hours). Both are printed on /visit and in docs/OPEN-QUESTIONS.md.
//
// No Intl, no Date locale behaviour, no host timezone: the offset is applied as arithmetic so a test
// at 03:00 in Nairobi and a test at 03:00 in Lima evaluate the same instant identically. Africa/Nairobi
// is UTC+3 year-round — there is no DST to get wrong.

export const UTC_OFFSET_MINUTES = 180;
export const OPEN_MINUTES = 6 * 60 + 30; // 06:30
export const CLOSE_MINUTES = 23 * 60; // 23:00
export const OPEN_LABEL = "06:30";
export const CLOSE_LABEL = "23:00";

/** Minutes since local midnight in Nairobi, for any Date/epoch/timezone. */
export function nairobiMinutes(input = new Date()) {
  const date = input instanceof Date ? input : new Date(input);
  const utc = date.getTime() + date.getTimezoneOffset() * 60_000;
  const local = new Date(utc + UTC_OFFSET_MINUTES * 60_000);
  return local.getHours() * 60 + local.getMinutes();
}

/** Decimal hours, 0–24, e.g. 18.75 for a quarter to seven. Minute resolution — the booking rules use it. */
export function nairobiHour(input = new Date()) {
  return nairobiMinutes(input) / 60;
}

/** Seconds since local midnight in Nairobi. The light rig wants the second hand, not just the minute. */
export function nairobiSeconds(input = new Date()) {
  const date = input instanceof Date ? input : new Date(input);
  const utc = date.getTime() + date.getTimezoneOffset() * 60_000;
  const local = new Date(utc + UTC_OFFSET_MINUTES * 60_000);
  return local.getHours() * 3600 + local.getMinutes() * 60 + local.getSeconds();
}

/**
 * Decimal hours to the second, 0–24.
 *
 * A19: the dial used to detent every half hour, so the room jumped from one lighting stop to the next
 * and a guest could see the step. The sun does not step. This is the hour the ambient writer uses, and
 * it is why the palette can move continuously while `nairobiHour` stays the minute-resolution number
 * the opening-hours arithmetic and its tests were written against.
 */
export function nairobiHourFloat(input = new Date()) {
  return nairobiSeconds(input) / 3600;
}

/** Open/closed against minutes-since-midnight-in-Nairobi, so a decimal hour can be asked directly. */
export function isOpenMinutes(minutes) {
  const m = Number(minutes);
  if (!Number.isFinite(m)) return false;
  return m >= OPEN_MINUTES && m < CLOSE_MINUTES;
}

export function isOpen(input = new Date()) {
  return isOpenMinutes(nairobiMinutes(input));
}

export const pad = (n) => String(n).padStart(2, "0");

/**
 * The latest sitting the room will take, and the step between the ones it offers.
 *
 * `isOpenAt` is half-open — `minutes < closeMinutes` — so 23:00 is *closed*, not "the last minute". An input
 * whose `max` is the closing label therefore offers exactly one value the book refuses, and it refuses it as
 * `visitTime`, which is not the name of the control (A15), so the guest gets a sentence and no pointer. These
 * two constants exist so the picker and the Worker cannot drift: the step is what the browser enforces, and the
 * last sitting is what comes out of it.
 */
export const SITTING_STEP_MINUTES = 15;
export const LAST_SITTING_LABEL = minutesToLabel(CLOSE_MINUTES - SITTING_STEP_MINUTES);

/**
 * How many days ahead the book will hold a request.
 *
 * This is `LIMITS.horizonDays` in `backend/src/validate.mjs`, and the same argument as `PARTY_MAX` in
 * `lib/table.mjs` applies: it is a rule the Worker enforces, restated here so the pickers can stop a guest
 * before the refusal rather than after it. `tests/api.mjs` compares the two and executes the boundary on both
 * kinds, which is what keeps a fifth copy from quietly disagreeing with the one that actually refuses.
 */
export const HORIZON_DAYS = 90;

/**
 * The last date a When picker should offer, written as YYYY-MM-DD in Nairobi.
 *
 * The Worker's rule is about an instant: it refuses a visit more than `HORIZON_DAYS` after now. A date input
 * carries no clock, so the honest bound is the last day whose *latest* sitting — the closing minute — is still
 * inside the horizon. Subtracting the closing minutes rather than a whole day is what makes that precise: the
 * day is lost only for guests who would have picked the very edge, and no guest ever gets a date the browser
 * accepted and the book rejected with a field name the form has no control for (A15's `visitDate`).
 */
export function lastBookableDay(input = new Date(), { horizonDays = HORIZON_DAYS, closeMinutes = CLOSE_MINUTES } = {}) {
  const dayMs = 86_400_000;
  const limitMs = input.getTime() + horizonDays * dayMs - closeMinutes * 60_000;
  const nairobi = new Date(limitMs + UTC_OFFSET_MINUTES * 60_000);
  return `${nairobi.getUTCFullYear()}-${pad(nairobi.getUTCMonth() + 1)}-${pad(nairobi.getUTCDate())}`;
}

export function minutesToLabel(minutes) {
  const total = Math.round(((minutes % 1440) + 1440) % 1440);
  return `${pad(Math.floor(total / 60))}:${pad(total % 60)}`;
}

export function hourToLabel(hour) {
  return minutesToLabel(Math.round(hour * 60));
}

/** "Closes in 42 min" / "Opens in 11 h 20 min" — the only countdown the site is allowed to make. */
export function nextChange(input = new Date()) {
  const m = nairobiMinutes(input);
  if (m < OPEN_MINUTES) return { kind: "opens", minutes: OPEN_MINUTES - m, label: `Opens in ${humanSpan(OPEN_MINUTES - m)}` };
  if (m >= OPEN_MINUTES && m < CLOSE_MINUTES)
    return { kind: "closes", minutes: CLOSE_MINUTES - m, label: `Closes in ${humanSpan(CLOSE_MINUTES - m)}` };
  return { kind: "opens", minutes: 1440 - m + OPEN_MINUTES, label: `Opens in ${humanSpan(1440 - m + OPEN_MINUTES)}` };
}

export function humanSpan(minutes) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (!h) return `${m} min`;
  return m ? `${h} h ${m} min` : `${h} h`;
}

/* ------------------------------------------------------------------ the rig */

// Lighting stops, in decimal Nairobi hours. The door reads the same numbers the CSS does: morning is
// cool and clear, golden hour goes amber, after ten the room is teal neon and shadow. Interpolated
// linearly between stops, so the dial never jumps.
const NIGHT_STOPS = [
  [0, 1],
  [5, 1],
  [6.5, 0.62],
  [8, 0.2],
  [11, 0.05],
  [15.5, 0.12],
  [17.5, 0.42],
  [19, 0.74],
  [21, 0.93],
  [23, 1],
  [24, 1],
];

/** A decimal hour in [0, 24]; anything unparseable reads as noon rather than as NaN. */
function toHour(value) {
  const h = Number(value);
  return Number.isFinite(h) ? Math.max(0, Math.min(24, h)) : 12;
}

export function nightAmount(hour) {
  const h = toHour(hour);
  for (let i = 1; i < NIGHT_STOPS.length; i += 1) {
    const [h0, v0] = NIGHT_STOPS[i - 1];
    const [h1, v1] = NIGHT_STOPS[i];
    if (h <= h1) return v0 + (v1 - v0) * ((h - h0) / (h1 - h0));
  }
  return 1;
}

const PHRASES = [
  { from: 0, to: 6.5, name: "Closed", line: "The lights are off and the arches are still warm." },
  { from: 6.5, to: 9, name: "Morning service", line: "Chai, coffee and pastries before the CBD fills the room." },
  { from: 9, to: 11.5, name: "Mid-morning", line: "The terrace tables go first." },
  { from: 11.5, to: 15, name: "Lunch", line: "Biryani, shawarma and a table that is hard to leave." },
  { from: 15, to: 17.5, name: "Afternoon", line: "Cake slices, dawa and the slowest hour of the day." },
  { from: 17.5, to: 19.5, name: "Golden hour", line: "The lanterns come on over the canopy." },
  { from: 19.5, to: 22, name: "Dinner", line: "Goat mandy on the table, third cup of chai after it." },
  { from: 22, to: 23, name: "Last orders", line: "An hour of staying too long." },
  { from: 23, to: 24, name: "Closed", line: "The lights are off and the arches are still warm." },
];

/**
 * Everything the door and the palette need for one hour on the dial.
 *
 * `open` here is about the *dialled* hour, not the wall clock: dragging to 04:00 must show a closed
 * room even at 13:00, and dragging to 13:00 at 02:00 in the morning must show a lit one. Feeding a
 * decimal hour to `isOpen()` would instead build `new Date(13)` and answer for 1970 — which is how
 * this function first shipped, permanently closed.
 */
export function rigFor(hour) {
  const h = toHour(hour);
  const phrase = PHRASES.find((p) => h >= p.from && h < p.to) ?? PHRASES[PHRASES.length - 1];
  return {
    hour: h,
    label: hourToLabel(h),
    night: nightAmount(h),
    name: phrase.name,
    line: phrase.line,
    open: isOpenMinutes(Math.round(h * 60)),
  };
}

/**
 * The dial's domain, as data rather than as a literal in two files.
 *
 * A full day, not the operating day: `PHRASES` and `nightAmount` already answer for 00:00 and for
 * 23:30, and a page built at 00:29 legitimately arrives lit for midnight. Narrowing the control to
 * 06:30–23:00 while the rig kept the whole curve meant the handle and the room disagreed the moment
 * the build ran outside service hours — the writer, the input and the arrival now all read these two
 * numbers, so they cannot.
 */
export const DIAL_MIN = 0;
export const DIAL_MAX = 24;

/**
 * The dial has no detent.
 *
 * `step="any"` on the range input, and this constant is the data form of that decision so a test can
 * assert the control is continuous rather than reading the attribute and hoping. 24 is the same instant
 * as 00:00 — `hourToLabel(24)` wraps to "00:00" — so the handle can travel the whole day and arrive back
 * where it started without a value the rig cannot answer for.
 */
export const DIAL_STEP = 0;

/** Snap an hour to the half-hour. Kept for the booking pickers; the light rig no longer uses it. */
export function snapHour(hour) {
  return Math.round(toHour(hour) * 2) / 2;
}

/** Daylight reaching the room, 0→1 — the complement of `nightAmount`, and what the atmosphere reads. */
export function sunAmount(hour) {
  return 1 - nightAmount(hour);
}
