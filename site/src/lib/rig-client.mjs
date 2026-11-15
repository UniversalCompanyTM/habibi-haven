// site/src/lib/rig-client.mjs — the browser half of the light rig.
//
// The server writes `--hour` and `--night` into the HTML at build time (layouts/Base.astro), so the
// room arrives already lit and a page with no JavaScript is a page at the right time of day. This
// module is the only code allowed to change those two numbers afterwards, and it exists as its own
// file for one reason: the dial, the door and anything else that answers to the clock must not each
// keep their own copy of the curve. The curve stays in lib/hours.mjs; this is a writer, nothing more.
import { DIAL_MAX, DIAL_MIN, nightAmount, rigFor, snapHour } from "./hours.mjs";

export const HOUR_EVENT = "hh:hour";

/**
 * Dial the room to an hour and tell everyone.
 *
 * Returns the rig it applied, so callers can render from the same object the CSS was written from
 * rather than recomputing it a second way.
 */
export function applyHour(hour) {
  // Clamp first, snap second: `snapHour(23.75)` is 24, which is the same instant as 00:00 but is not
  // a value the dial has a handle for.
  const h = snapHour(Math.max(DIAL_MIN, Math.min(DIAL_MAX, Number(hour) || 19)));
  const night = nightAmount(h);
  const root = document.documentElement;
  root.style.setProperty("--hour", String(h));
  root.style.setProperty("--night", night.toFixed(3));
  const rig = rigFor(h);
  document.dispatchEvent(new CustomEvent(HOUR_EVENT, { detail: rig }));
  return rig;
}

/** Whatever the HTML arrived with — the build-time hour, unless a script already moved it. */
export function currentHour() {
  // The arrival hour can be any time of day (a 00:29 build lights the room for midnight), so the
  // whole clock face is accepted here. The old test demanded 06:30–23:00 and answered 19:00 for a
  // mid-night build, which put the handle at dusk in a room lit for midnight.
  const raw = Number(getComputedStyle(document.documentElement).getPropertyValue("--hour"));
  if (!Number.isFinite(raw)) return 19;
  return Math.min(DIAL_MAX, Math.max(DIAL_MIN, raw));
}
