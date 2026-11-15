// scripts/lib/photo-name.mjs — the single rule that maps a hosted photo to a mirrored file name.
// ingest/`menu.source.json` carries their Supabase public URL; the site ships its own copy of the
// byte under the same identity. Both scripts must agree exactly or the build cannot find the file,
// so the rule lives here instead of being duplicated.
//
// Shape of a hosted name:  1793885486654-Biryani-Beef-Chicken.jpg
//   ->  1793885486654-biryani-beef-chicken.jpg
// The epoch-millisecond prefix is kept: it is what makes two uploads of the same dish name
// distinct files, and it is traceable back to their storage listing.

const SLUG = /[^a-z0-9]+/g;
// Combining marks left behind by NFKD, written as escapes so no invisible character sits in this file.
const DIACRITICS = new RegExp("[\\u0300-\\u036f]", "g");

export function slugify(text) {
  return String(text)
    .toLowerCase()
    .normalize("NFKD")
    .replace(DIACRITICS, "")
    .replace(SLUG, "-")
    .replace(/^-+|-+$/g, "");
}

/** Extension normalised to .jpg: the bucket has one `…-Habibi-Mutton-Biryani-Feast.png.jpg` whose
 *  bytes M0 confirmed are JPEG, and a couple of `.jpeg`. Everything is served as `.jpg`. */
function normaliseExt(ext) {
  const e = String(ext || "").toLowerCase().replace(/^\./, "");
  if (e === "jpeg" || e === "jpg" || e === "") return "jpg";
  if (e === "png") return "png";
  return e;
}

export function localPhotoName(remoteUrl) {
  const url = String(remoteUrl || "");
  if (!url) return null;
  let base;
  try {
    base = decodeURIComponent(new URL(url).pathname.split("/").pop() || "");
  } catch {
    base = url.split("/").pop() || "";
  }
  const dot = base.lastIndexOf(".");
  const stem = dot > 0 ? base.slice(0, dot) : base;
  const ext = dot > 0 ? normaliseExt(base.slice(dot + 1)) : "jpg";
  const dash = stem.indexOf("-");
  const prefix = /^\d{10,}$/.test(stem.slice(0, dash)) ? stem.slice(0, dash) : "";
  const rest = prefix ? stem.slice(dash + 1) : stem;
  const slug = slugify(rest) || "photo";
  return prefix ? `${prefix}-${slug}.${ext}` : `${slug}.${ext}`;
}
