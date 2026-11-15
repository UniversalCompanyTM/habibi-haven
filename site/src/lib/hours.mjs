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

/** Decimal hours, 0–24, e.g. 18.75 for a quarter to seven. */
export function nairobiHour(input = new Date()) {
  return nairobiMinutes(input) / 60;
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
export const DIAL_MAX = 23.5;

/** Snap an hour to the half-hour the kitchen actually works in. */
export function snapHour(hour) {
  return Math.round(toHour(hour) * 2) / 2;
}
