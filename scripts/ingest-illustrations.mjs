// scripts/ingest-illustrations.mjs — the generated plates, mirrored and attributed.
//
// The kitchen's own feed carries 102 rows whose photograph is a grey "Image to be updated soon" card.
// Showing that card as if it were the dish is a lie; showing nothing leaves a menu that looks unfinished.
// The third option is the one this script implements: a generated photograph of the dish as the menu
// *describes* it, mirrored into the same bucket the real photographs live in, and flagged on the row so
// every surface that renders it can say what it is. `photo.illustration === true` is the flag, and the
// alt text carries the same sentence, because a screen reader gets the provenance too.
//
// Two rules this file keeps:
//   * An illustration is only ever attached to rows whose name and description match what was depicted.
//     The mapping is written by hand in content/illustrations.json — there is no fuzzy matching here,
//     because a fuzzy match is how a picture of a cheesecake ends up on a beef steak.
//   * Nothing is overwritten. Real photographs are never touched: a row that already has one is skipped
//     and reported, so re-running this script cannot replace the kitchen's own picture with ours.
//
// Run: node scripts/ingest-illustrations.mjs [--dry]
//
// It is the last step of `prebuild`, `data` and `content`, and it has to be. `build-content.mjs` derives
// menu.json from the upstream feed on every build and knows nothing about these files, so a run order that
// leaves this script out does not fail — it publishes a menu that quietly lost 28 plates while the JPEGs
// stayed in the bucket, orphaned. tests/run.mjs compares this manifest against the shipped rows so that
// mistake costs a build instead of a lie.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(join(ROOT, "site/package.json"));
const sharp = require("sharp");

const DRY = process.argv.includes("--dry");
const manifest = JSON.parse(await readFile(join(ROOT, "content/illustrations.json"), "utf8"));
const menuPath = join(ROOT, "site/src/data/menu.json");
const menu = JSON.parse(await readFile(menuPath, "utf8"));

/** Every row, flattened once, with a pointer back to the object we will mutate. */
const rows = [];
for (const family of menu.families)
  for (const section of family.sections) for (const item of section.items) rows.push(item);
const byId = new Map(rows.map((r) => [r.id, r]));

const notes = [];
const problems = [];
let written = 0;
let attached = 0;

await mkdir(join(ROOT, "site/public/menu"), { recursive: true });
await mkdir(join(ROOT, "site/public/scenes"), { recursive: true });

for (const asset of manifest.assets) {
  const src = join(ROOT, asset.file);
  // Dishes live in the square bucket the mirror wrote (800 full / 400 thumb), so a filtering pass over
  // 243 cards reflows nothing. Venue frames keep their own aspect and go to /scenes at two widths.
  //
  // /scenes and not /brand, and that is a load-bearing detail: scripts/sync-brand.mjs deletes
  // site/public/brand and republishes it from brand/ on the first step of every prebuild, and brand/
  // is the kitchen's own twelve salvaged photographs. A render parked there survives a run on this
  // machine, where the originals are on disk to re-render it, and disappears from a CI build, where
  // they are not — which is the worst shape a bug can take: correct locally, quietly missing in public.
  const dish = asset.kind === "dish";
  const full = dish ? 800 : 1600;
  const thumb = dish ? 400 : 800;
  const dir = dish ? "site/public/menu" : "site/public/scenes";
  const ext = ".jpg";
  const fullName = `${asset.out}${ext}`;
  const thumbName = `${asset.out}.${thumb}${ext}`;
  const outFull = join(ROOT, dir, fullName);
  const outThumb = join(ROOT, dir, thumbName);

  // The originals live in ../vibe_images, outside this repository — 45 MB of PNG that the git history
  // has no business carrying. So on a fresh checkout (CI, a second machine, next month) the source is
  // absent and the mirrors are not, and the job of this step changes: it can no longer render, only
  // prove that the files the manifest names are the ones on disk, and read their dimensions from them.
  // That is what keeps `prebuild` runnable anywhere while `build-content.mjs` wipes the row flags on
  // every build. Both missing is the only real failure.
  const haveSource = existsSync(src);
  const haveOutputs = existsSync(outFull) && existsSync(outThumb);
  if (!haveSource && !haveOutputs) {
    problems.push(`${asset.out}: neither the original (${asset.file}) nor its mirrors in ${dir} exist — nothing to attach`);
    continue;
  }

  let fullMeta;
  if (haveSource) {
    const image = sharp(src);
    const resize = (width) =>
      image
        .clone()
        .resize(dish ? { width, height: width, fit: "cover", position: "centre" } : { width, fit: "inside", withoutEnlargement: true })
        .jpeg({ quality: 82, mozjpeg: true, chromaSubsampling: "4:2:0" })
        .toBuffer();

    const fullBuf = await resize(full);
    const thumbBuf = await resize(thumb);
    fullMeta = await sharp(fullBuf).metadata();
    if (!DRY) {
      await writeFile(outFull, fullBuf);
      await writeFile(outThumb, thumbBuf);
    }
    written += 2;
    notes.push(
      `  ${asset.out}  ${fullMeta.width}×${fullMeta.height} + ${thumb}w  ${(fullBuf.length / 1024).toFixed(0)} kB  ← ${asset.file.split("/").pop()}`
    );
  } else {
    fullMeta = await sharp(outFull).metadata();
    if (fullMeta.width !== full && !(dish === false && fullMeta.width <= full)) {
      problems.push(`${asset.out}: the committed mirror is ${fullMeta.width}px wide, the manifest's bucket is ${full}px — re-render from the original`);
    }
    notes.push(`  ${asset.out}  ${fullMeta.width}×${fullMeta.height}  verified against the committed mirror (original not in this checkout)`);
  }

  if (!dish) continue;

  for (const id of asset.items ?? []) {
    const row = byId.get(id);
    if (!row) {
      problems.push(`${asset.out}: no menu row with id "${id}"`);
      continue;
    }
    if (row.photo && row.photo.illustration === true) {
      // A re-run must read as "nothing changed", not as a claim about the kitchen's photography.
      notes.push(`  keep ${id}: its illustration is already attached`);
      continue;
    }
    if (row.photo && row.photo.placeholder !== true) {
      notes.push(`  skip ${id}: the kitchen already has a photograph for it`);
      continue;
    }
    // The description is the contract. An illustration is attached to a row that has one only when the
    // manifest says so explicitly; a row with no description gets the dish name alone, and the alt text
    // never claims more than the picture shows.
    row.photo = {
      local: `/menu/${fullName}`,
      thumb: `/menu/${thumbName}`,
      remote: null,
      width: fullMeta.width,
      height: fullMeta.height,
      placeholder: false,
      illustration: true,
      alt: `${row.name} — an illustration of the dish, not a photograph from the kitchen`,
    };
    attached += 1;
  }
}

// The counts are recomputed from the rows rather than incremented, so a re-run is idempotent and a
// partially-applied manifest cannot leave meta describing a menu that no longer exists.
const illustrated = rows.filter((r) => r.photo?.illustration === true).length;
const placeholders = rows.filter((r) => r.photo?.placeholder === true).length;
const photographs = rows.filter((r) => r.photo && r.photo.placeholder !== true && r.photo.illustration !== true).length;
menu.meta.illustratedPhotos = illustrated;
menu.meta.placeholderPhotos = placeholders;
menu.meta.realPhotos = photographs;
// `meta.photos` deliberately stays untouched: build-content.mjs sets it to the number of DISTINCT
// photograph URLs in the kitchen's own feed (173 of them, some dishes sharing one image), which is a
// statement about the source, not about this site. Overwriting it with a row count turned the footer's
// "243 items and 173 photographs read from the restaurant's own menu system" into a number that
// described nothing.

// Indent 1, because that is what build-content.mjs writes. Reformatting all 243 rows on a step that
// touches 28 of them turns an auditable diff into an unauditable one — and a diff nobody can read is a
// diff nobody checks.
if (!DRY) await writeFile(menuPath, `${JSON.stringify(menu, null, 1)}\n`);

console.log(`illustrations: ${manifest.assets.length} assets, ${written} files, ${attached} rows attached`);
console.log(notes.join("\n"));
console.log(`menu now: ${photographs} photographs, ${illustrated} illustrations, ${placeholders} still pending`);
if (problems.length) {
  console.error(`\nPROBLEMS (${problems.length}):\n` + problems.map((p) => `  - ${p}`).join("\n"));
  process.exitCode = 1;
}
if (DRY) console.log("\n(dry run — nothing was written)");