// Recover a full Open Location Code from a short plus code, then try to falsify the result.
//
//   node research/tools/pluscode.mjs "PR99+82" "Koinange Street, Nairobi, Kenya"
//
// Why the reference is honest here: a short code like "PR99+82" has its leading degree cells
// removed, so it repeats across the Earth. The reference only chooses which repetition is meant; the
// ~14 m cell itself comes from the venue's own published code, not from the reference. The script
// then reverse-geocodes the recovered point and measures it against the street the address names —
// because a coordinate that disagrees with the address next to it is worse than no coordinate.
//
// Recorded outcome for PR99+82, re-run 2026-11-15 after the centre of the cell was corrected: recovered
// 6GCRPR99+82, corner -1.281750, 36.817500, centre -1.281687, 36.817562. Nominatim puts that point on
// "Koinage Street" at both zoom 18 and zoom 17 — OpenStreetMap's spelling of the published address — and
// the nearest Java House/Sapee Lounge/Kowloon Garden nodes are 42-61 m away, which is what a block of
// restaurants looks like. It is still one source: OSM has no node for the venue at all, so nothing
// independent confirms the door. See docs/OPEN-QUESTIONS.md §9 for the full reading.
//
// Status 2026-11-16: the owner of this preview decided to publish the cell centre as `geo` with the source
// named, so `meta.facts.coordinates` now exists and the structured data carries it. Re-running this script
// is still the check to do if Habibi Haven ever hands over a different pin.

import { pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// The grid arithmetic lives in one file in this repo. A second copy here is what produced the 7 m error
// that made this lookup answer "Monrovia Street" for a venue on Koinange Street.
const { ALPHABET, decode } = await import(
  pathToFileURL(join(dirname(fileURLToPath(import.meta.url)), "../../site/src/lib/pluscode.mjs")).href
);

const SHORT = process.argv[2] ?? "PR99+82";
const REFERENCE = process.argv[3] ?? "Koinange Street, Nairobi, Kenya";
const headers = { "User-Agent": "habibihaven-preview-verification/1.0 (pitch QA, one-off lookup)" };

const json = async (url, init) => {
  // Nominatim rate-limits and occasionally refuses the TCP connection outright; three attempts with a
  // backoff keeps a transient 429/timeout from reading as "the code does not resolve".
  let lastError = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const res = await fetch(url, init ? { ...init, headers: { ...headers, ...init.headers } } : { headers });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (error) {
      lastError = error;
      await new Promise((r) => setTimeout(r, 2500 * (attempt + 1)));
    }
  }
  throw new Error(`${lastError?.message ?? lastError} for ${url}`);
};

const [head, tail] = SHORT.split("+");
if (!head || !tail) throw new Error(`"${SHORT}" is not a plus code with a + separator`);
const present = head + tail; // the pairs the short code keeps
// Google's city-level short form: 4 characters, '+', 2 characters — the 20° and 1° pairs are the ones
// dropped. Anything else is a different recovery problem, so say so rather than guess at it.
if (head.length !== 4 || tail.length !== 2) {
  throw new Error(`this script resolves the 4+2 short form (e.g. "PR99+82"); "${SHORT}" is ${head.length}+${tail.length}`);
}

// --- 1. a reference near the venue
const refHits = await json("https://nominatim.openstreetmap.org/search?format=json&limit=1&q=" + encodeURIComponent(REFERENCE));
if (!refHits[0]) throw new Error(`no reference found for "${REFERENCE}"`);
const refLat = Number(refHits[0].lat), refLon = Number(refHits[0].lon);
console.log(`reference  ${REFERENCE}\n           ${refLat.toFixed(5)}, ${refLon.toFixed(5)}  (${refHits[0].display_name.slice(0, 70)}…)`);

// --- 2. brute-force the two dropped pairs, keep the cell nearest the reference
const pad = [];
for (const a of ALPHABET) for (const b of ALPHABET) pad.push(a + b);
const km = (la, lo) => Math.hypot((la - refLat) * 111.32, (lo - refLon) * 111.32 * Math.cos((refLat * Math.PI) / 180));
let best = null;
for (const outer of pad) {
  const coarse = decode(outer + "22222222");
  if (Math.abs(coarse.lat - refLat) > 20 || Math.abs(coarse.lon - refLon) > 20) continue;
  for (const inner of pad) {
    const full = outer + inner + present;
    const d = decode(full);
    const cLat = d.centre.lat, cLon = d.centre.lon; // centre comes from the shared lib, never from a half-cell added here
    const dist = km(cLat, cLon);
    if (!best || dist < best.km) best = { full, cLat, cLon, km: dist, cellM: d.cellDeg * 111320 };
  }
}
if (!best) throw new Error("no candidate cell matched the reference");
console.log(`recovered  ${best.full.slice(0, 8)}+${best.full.slice(8)}   cell ≈ ${(best.cellM / 1).toFixed(0)} m`);
console.log(`pin        ${best.cLat.toFixed(6)}, ${best.cLon.toFixed(6)}   (${best.km.toFixed(2)} km from the reference)`);

// --- 3. falsify: what does the map say this point is, at two granularities?
for (const zoom of [18, 17]) {
  const rev = await json(`https://nominatim.openstreetmap.org/reverse?format=json&zoom=${zoom}&lat=${best.cLat}&lon=${best.cLon}`);
  console.log(`reverse z${zoom}  road ${rev.address?.road ?? "—"}  ·  ${rev.display_name.slice(0, 90)}`);
}

// --- 4. distance to the street the published address names — under every spelling OSM uses.
// OSM maps part of this road as "Koinage Street" and a separate living_street as "Koinange Street",
// so checking one spelling alone measures the wrong way and reports a false 480 m.
const metres = (la, lo) => Math.hypot((la - best.cLat) * 111320, (lo - best.cLon) * 111320 * Math.cos((best.cLat * Math.PI) / 180));
let corroborated = false;
for (const spelling of ["Koinange Street", "Koinage Street"]) {
  const hits = await json("https://nominatim.openstreetmap.org/search?format=json&polygon_geojson=1&limit=5&countrycodes=ke&q=" + encodeURIComponent(spelling + ", Nairobi"));
  for (const hit of hits.slice(0, 3)) {
    let near = Infinity;
    const walk = (c) => (typeof c[0] === "number" ? (near = Math.min(near, metres(c[1], c[0]))) : c.forEach(walk));
    if (hit.geojson) walk(hit.geojson.coordinates);
    console.log(`street     "${spelling}" way ${hit.osm_id} (${hit.type}) → nearest vertex ${Math.round(near)} m`);
    if (near < 120) corroborated = true;
  }
  await new Promise((r) => setTimeout(r, 1200)); // stay inside Nominatim's 1 req/s courtesy
}
console.log(corroborated
  ? "VERDICT    the pin sits on a way this street is known by — geo is defensible, still confirm with the owner"
  : "VERDICT    NOT corroborated — keep geo dark");
