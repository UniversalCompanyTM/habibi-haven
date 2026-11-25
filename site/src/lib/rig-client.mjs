// site/src/lib/rig-client.mjs — the browser half of the light rig.
//
// The server writes `--hour`, `--night` and `--sun` into the HTML at build time (layouts/Base.astro), so
// the room arrives already lit and a page with no JavaScript is a page at the right time of day. This
// module is the only code allowed to change those numbers afterwards, and it exists as its own file for
// one reason: the dial, the door, the atmosphere and anything else that answers to the clock must not
// each keep their own copy of the curve. The curve stays in lib/hours.mjs; this is a writer, nothing more.
//
// A19 removed the half-hour detent. `applyHour` clamps and writes; it does not snap. The dial is
// continuous and the ambient writer moves to the second. `--hour` is an immediate circular state
// readout; CSS transitions only the appearance-driving `--night`/`--sun` values, without a frame loop.
import { DIAL_MAX, DIAL_MIN, nairobiHourFloat, nightAmount, rigFor, sunAmount } from "./hours.mjs";

export const HOUR_EVENT = "hh:hour";

// The hour a person moved the dial to during this visit, or `null` while nobody has. This is the only
// reason the value outlives a page: a router swap installs the incoming document's `<html>` wholesale,
// and that one only knows the hour the build ran at. Without this, dialling 03:00 to see the room at
// night and then opening /menu would put the lights back to whoever-built-it-o'clock, which reads as the
// dial having been forgotten rather than the page having changed.
/** @type {number | null} */
let dialled = null;

/** Clamp to the dial's domain without rounding it. 24 is legal: it is 00:00, and the rig answers for it. */
function clampHour(hour) {
  const n = Number(hour);
  if (!Number.isFinite(n)) return 19;
  return Math.max(DIAL_MIN, Math.min(DIAL_MAX, n));
}

/**
 * Dial the room to an hour and tell everyone.
 *
 * Returns the rig it applied, so callers can render from the same object the CSS was written from
 * rather than recomputing it a second way.
 */
export function applyHour(hour, { fromAmbient = false } = {}) {
  const h = clampHour(hour);
  const night = nightAmount(h);
  const root = document.documentElement;
  root.style.setProperty("--hour", h.toFixed(4));
  root.style.setProperty("--night", night.toFixed(4));
  root.style.setProperty("--sun", sunAmount(h).toFixed(4));
  // An ambient write is the wall clock moving, not a guest asking for a different hour. Recording it as
  // `dialled` would freeze the room at the first tick and stop the drift for the rest of the visit.
  if (!fromAmbient) {
    dialled = h;
    // A drag must track the handle. The one-second ambient glide is what makes the *wall clock*
    // invisible, and it is exactly wrong under a finger: pulling to noon would leave the atmosphere
    // behind the readout. `data-manual` shortens the sun to a blink and leaves hour/night immediate;
    // the timer below hands the ambient glide back once the writing stops.
    root.setAttribute("data-manual", "");
    clearTimeout(manualTimer);
    manualTimer = setTimeout(() => root.removeAttribute("data-manual"), 600);
  }
  const rig = rigFor(h);
  document.dispatchEvent(new CustomEvent(HOUR_EVENT, { detail: rig }));
  return rig;
}

/** How recently a person, rather than the clock, moved the room. */
let manualTimer = 0;

/** The hour this visitor asked for, or `null` if the room is still on the build's clock. */
export function liveHour() {
  return dialled;
}

/** Whatever the HTML arrived with — the build-time hour, unless a script already moved it. */
export function currentHour() {
  const raw = Number(getComputedStyle(document.documentElement).getPropertyValue("--hour"));
  if (!Number.isFinite(raw)) return 19;
  return clampHour(raw);
}

/**
 * The room, on the wall clock, drifting.
 *
 * Once a visitor has touched the dial the room is theirs and this does nothing until they press "Back to
 * now" — which clears `dialled` and hands the room back. Otherwise it writes the real Nairobi hour once
 * per second. `--hour` updates immediately; `html[data-ambient]` transitions the appearance values
 * `--night`/`--sun` across that second, so CSS supplies the intervening frames while JavaScript keeps
 * one bounded timer rather than a render loop.
 *
 * Returns a stop function. Everything with a teardown cost is returned rather than left running: a
 * router swap must not leave two ambient loops writing to the same rig values.
 */
export function startAmbient({ everyMs = 1_000 } = {}) {
  const root = document.documentElement;
  const motion = matchMedia("(prefers-reduced-motion: reduce)");
  // Reduced motion gets the drift without the interpolation: the colour still follows the sun, it just
  // arrives in one-second steps instead of gliding. Read the live query on every change, including after
  // an Astro swap clears the attribute, rather than freezing the visitor's preference at startup.
  const glide = () => {
    if (motion.matches) root.removeAttribute("data-ambient");
    else root.setAttribute("data-ambient", "");
  };
  glide();
  motion.addEventListener("change", glide);

  const write = () => {
    if (dialled !== null) return;
    applyHour(nairobiHourFloat(), { fromAmbient: true });
  };

  write();
  const timer = setInterval(write, everyMs);
  const onVisible = () => {
    if (!document.hidden) write();
  };
  document.addEventListener("visibilitychange", onVisible);
  addEventListener("pageshow", write);
  // swapRootAttributes (astro/dist/transitions/swap-functions.js) clears every attribute off the live
  // <html> and copies the incoming document's, including its build-time inline hour. Restore the glide and
  // write the current Nairobi second in the same callback; otherwise the room shows the build hour until the
  // next interval tick, which is a visible backward jump (and can cross midnight).
  const afterSwap = () => {
    glide();
    write();
  };
  document.addEventListener("astro:after-swap", afterSwap);

  return () => {
    clearInterval(timer);
    document.removeEventListener("visibilitychange", onVisible);
    removeEventListener("pageshow", write);
    document.removeEventListener("astro:after-swap", afterSwap);
    motion.removeEventListener("change", glide);
  };
}

/** Hand the room back to the wall clock after a guest has dialled it. */
export function releaseToNow() {
  dialled = null;
  return applyHour(nairobiHourFloat(), { fromAmbient: true });
}