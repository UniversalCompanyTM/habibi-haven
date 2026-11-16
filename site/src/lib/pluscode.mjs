// site/src/lib/pluscode.mjs — the arithmetic behind a plus code, with no network and no dependencies.
//
// Why this file exists. `meta.facts` carries two location claims that have to be the same place: the
// plus code the venue publishes on its own listing ("PR99+82") and the latitude/longitude we publish as
// `geo` in the structured data. Those two numbers are written by hand in scripts/build-content.mjs, so
// nothing in the build would notice if one of them drifted — a wrong digit in the coordinates is 111 m,
// and a restaurant site that sends someone to the wrong door cannot take it back. So the build asserts
// they agree, and it does it with this function rather than with a comment.
//
// What a plus code is, precisely enough to check it by hand:
//
//   The grid is base 20 with the alphabet 23456789CFGHJMPQRVWX (no 0, 1, L, and nothing that can be
//   misread as a 0 or 1). Pairs of characters refine both axes: pair 1 is 20° per digit, then 1°, then
//   0.05°, then 0.0025°, then 0.000125°. Five pairs is the full code, and the last pair makes a cell
//   about 14 m on a side — which is why a full code is a location and a short code is a question.
//
//   A Google "city short code" like `PR99+82` is the last three pairs of a ten-character code: the two
//   coarsest pairs are dropped and have to be recovered against a reference point. `6GCRPR99+82` is what
//   `PR99+82` becomes when the reference is Nairobi. research/tools/pluscode.mjs does that recovery and
//   then tries to falsify the answer against OpenStreetMap; this file only does the part that can be
//   checked offline, which is: does this coordinate name this cell.
//
// Everything here is integer arithmetic on purpose. `Math.floor(offset / 0.000125)` in floating point
// lands on the wrong side of a digit boundary often enough to matter, and the failure it would produce —
// a code that decodes 14 m away and still reads as "Koinage Street" — is the kind no one sees.

/** The plus-code alphabet: twenty characters chosen so none of them can be misread as another. */
export const ALPHABET = "23456789CFGHJMPQRVWX";
const BASE = 20;
const PAIRS = 5;
/** Degrees per cell edge at the finest pair — the ~14 m of a full code. */
export const UNIT_DEG = 0.000125;

/**
 * The full ten-character code (no separator) of the cell CONTAINING `lat`/`lon`.
 *
 * Floor, not round — and the difference is not academic. The first version of this function rounded the
 * offset to the nearest cell, on the theory that a centre is the tidiest thing to hand back. It is wrong
 * at the only point that matters: a cell centre is exactly half a cell from its corner, so rounding moves
 * it into the NEXT cell. Feeding `6GCRPR99+82`'s own centre through that version produced `6GCRPR99+93`,
 * a code 14 m north and 14 m east of the code it came from, and an assertion built on it would have said
 * the published coordinates disagreed with the published plus code. Flooring is the definition — the cell
 * that contains the point — and it is stable for a centre, which sits at index + 0.5 and cannot be nudged
 * across an integer boundary by floating-point noise. (A coordinate that IS exactly a cell corner is the
 * one input where `* 8000` can land a hair under an integer; no cell centre or door-step coordinate is
 * such a value, and the invariant this file exists to protect uses a centre.)
 */
export function encodeFull(lat, lon) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) throw new Error(`not a coordinate: ${lat}, ${lon}`);
  if (lat < -90 || lat > 90) throw new Error(`latitude out of range: ${lat}`);
  if (lon < -180 || lon > 180) throw new Error(`longitude out of range: ${lon}`);
  // Cell indices from the corner of the grid. 180°/0.000125° = 1,440,000 cells and 360° = 2,880,000, both
  // under 20^5 = 3,200,000, so five base-20 digits hold each axis.
  let la = Math.floor((lat + 90) / UNIT_DEG);
  let lo = Math.floor((lon + 180) / UNIT_DEG);
  let out = "";
  for (let p = 0; p < PAIRS; p += 1) {
    const weight = BASE ** (PAIRS - p - 1);
    const dLat = Math.floor(la / weight);
    const dLon = Math.floor(lo / weight);
    la -= dLat * weight;
    lo -= dLon * weight;
    out += ALPHABET[dLat] + ALPHABET[dLon];
  }
  return out;
}

/**
 * The inverse: the cell's south-west corner and its centre. Accepts a full code with or without the '+'.
 * Kept here rather than only in the research tool so the grid arithmetic exists in one place; a second copy
 * is the thing that let a 7 m mistake look like a confirmed pin.
 */
export function decode(bare) {
  const code = String(bare).replace("+", "");
  if (code.length !== 10) throw new Error(`expected a full ten-character code, got ${bare}`);
  let lat = -90;
  let lon = -180;
  let res = 20;
  for (let i = 0; i < 10; i += 2) {
    const dLat = ALPHABET.indexOf(code[i]);
    const dLon = ALPHABET.indexOf(code[i + 1]);
    if (dLat < 0 || dLon < 0) throw new Error(`"${code[i]}${code[i + 1]}" is not a plus-code pair`);
    lat += dLat * res;
    lon += dLon * res;
    res /= BASE;
  }
  const cellDeg = res * BASE; // the finest pair's weight, which is the cell edge
  return { lat, lon, cellDeg, centre: { lat: lat + cellDeg / 2, lon: lon + cellDeg / 2 } };
}

/** `6GCRPR9982` -> `6GCRPR99+82`. */
export function format(code) {
  const bare = code.replace("+", "");
  if (bare.length !== 10) throw new Error(`expected a full ten-character code, got ${code}`);
  return `${bare.slice(0, 8)}+${bare.slice(8)}`;
}

/**
 * The Google city short form of a full code: the three finest pairs, `PR99+82` — which is the shape the
 * venue publishes. The two dropped pairs are what a reader has to recover, and research/tools/pluscode.mjs
 * does that against a reference point; this function only strips, which is the part with one answer.
 */
export function toShort(code) {
  const bare = String(code).replace("+", "");
  if (bare.length !== 10) throw new Error(`expected a full ten-character code, got ${code}`);
  const stripped = bare.slice(4);
  return `${stripped.slice(0, 4)}+${stripped.slice(4)}`;
}

/**
 * Does the coordinate and the published code name the same cell? Used by scripts/build-content.mjs as a
 * build assertion: both values are hand-authored, and this is the only thing that reads them together.
 */
export function agrees(lat, lon, publishedShort) {
  const full = encodeFull(lat, lon);
  const short = toShort(full);
  return { full, formatted: format(full), short, matches: short === publishedShort };
}
