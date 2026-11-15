// site/src/content-schema.mjs — the shape the site is allowed to read.
//
// `scripts/build-content.mjs` imports this and refuses to write site/src/data/menu.json unless the
// output passes. The rules exist because the menu is the one part of the site that is data, not
// markup: a null price, an item with no photo reference or an orphan section would otherwise reach
// the page and show up as a blank card or "KSh undefined".

export const KNOWN_TAGS = [
  "goat",
  "sharing",
  "spicy",
  "veg",
  "kids",
  "keto",
  "chai",
  "coffee",
  "cold",
  "bakery",
  "signature",
];

const isStr = (v) => typeof v === "string";
const isInt = (v) => Number.isInteger(v);

export function validateMenu(menu) {
  const errors = [];
  const err = (path, msg) => errors.push(`${path}: ${msg}`);

  const meta = menu?.meta;
  if (!meta) err("meta", "missing");
  else {
    if (!isStr(meta.sourceEndpoint)) err("meta.sourceEndpoint", "must be a string");
    if (!isInt(meta.items) || meta.items < 1) err("meta.items", "must be a positive integer");
    if (!isInt(meta.photos) || meta.photos < 1) err("meta.photos", "must be a positive integer");
    if (!isInt(meta.priceRange?.min) || !isInt(meta.priceRange?.max))
      err("meta.priceRange", "min and max must be integers");
  }

  if (!Array.isArray(menu?.families) || menu.families.length < 1) err("families", "must be a non-empty array");

  const seenItemIds = new Set();
  let itemCount = 0;
  const photoFiles = new Set();

  for (const [fi, family] of (menu?.families ?? []).entries()) {
    const fp = `families[${fi}](${family?.id ?? "?"})`;
    if (!/^[a-z0-9-]+$/.test(family?.id ?? "")) err(`${fp}.id`, "must be a kebab id");
    if (!isStr(family?.label) || !family.label.trim()) err(`${fp}.label`, "must be a non-empty string");
    if (!Array.isArray(family?.sections) || family.sections.length < 1) err(`${fp}.sections`, "must be non-empty");

    for (const [si, section] of (family?.sections ?? []).entries()) {
      const sp = `${fp}.sections[${si}](${section?.id ?? "?"})`;
      if (!/^[a-z0-9-]+$/.test(section?.id ?? "")) err(`${sp}.id`, "must be a kebab id");
      if (!isStr(section?.label) || !section.label.trim()) err(`${sp}.label`, "must be a non-empty string");
      if (!isStr(section?.source)) err(`${sp}.source`, "must keep the verbatim source group");
      if (!Array.isArray(section?.items) || section.items.length < 1) err(`${sp}.items`, "must be non-empty");
      if (section?.count !== section?.items?.length)
        err(`${sp}.count`, `says ${section?.count} but holds ${section?.items?.length}`);

      for (const [ii, item] of (section?.items ?? []).entries()) {
        const ip = `${sp}.items[${ii}](${item?.id ?? "?"})`;
        itemCount += 1;
        if (!/^[a-z0-9-]+$/.test(item?.id ?? "")) err(`${ip}.id`, "must be a kebab id");
        if (seenItemIds.has(item?.id)) err(`${ip}.id`, `duplicate id "${item.id}"`);
        seenItemIds.add(item.id);
        if (!isStr(item?.name) || !item.name.trim()) err(`${ip}.name`, "must be a non-empty string");
        if (!isInt(item?.price) || item.price < 0) err(`${ip}.price`, "must be a non-negative integer (KSh)");
        if (!isStr(item?.description)) err(`${ip}.description`, "must be a string, empty if their data has none");
        if (item?.family !== family.id) err(`${ip}.family`, `expects "${family.id}"`);
        if (item?.section !== section.id) err(`${ip}.section`, `expects "${section.id}"`);
        if (item?.source?.row == null) err(`${ip}.source.row`, "must carry their row id for drift tracing");

        if (!item?.photo || typeof item.photo !== "object") err(`${ip}.photo`, "must be an object");
        else {
          if (typeof item.photo.remote === "string" && !item.photo.remote.startsWith("https://"))
            err(`${ip}.photo.remote`, "must be an https URL");
          else if (item.photo.remote !== null && item.photo.remote !== undefined && !isStr(item.photo.remote))
            err(`${ip}.photo.remote`, "must be the https source URL or null");
          if (item.photo.placeholder === true) {
            // Their data currently puts 102 rows on an "Image to be updated soon" upload. The site
            // must know that so it can render a type card instead of pretending it is the dish.
            if (item.photo.alt !== `${item.name} — photograph pending from the restaurant`)
              err(`${ip}.photo.alt`, "a placeholder photo must not read as the dish");
          } else if (!isStr(item.photo.local)) {
            err(`${ip}.photo.local`, "mirrored path missing — run scripts/mirror-images.mjs");
          }
          if (item.photo.local != null && !item.photo.local.startsWith("/menu/"))
            err(`${ip}.photo.local`, "must be served from /menu/");
          if (item.photo.local != null && (!isInt(item.photo.width) || !isInt(item.photo.height)))
            err(`${ip}.photo`, "width and height are required so the grid cannot shift (CLS)");
          if (item.photo.local) photoFiles.add(item.photo.local);
        }

        if (!Array.isArray(item?.tags)) err(`${ip}.tags`, "must be an array");
        else for (const t of item.tags) if (!KNOWN_TAGS.includes(t)) err(`${ip}.tags`, `unknown tag "${t}"`);

        if (item?.signatureRole !== undefined && item.signatureRole !== null) {
          if (!isStr(item.signatureRole) || !item.signatureRole.trim())
            err(`${ip}.signatureRole`, "must be a non-empty string");
          if (!isInt(item.signatureOrder))
            err(`${ip}.signatureOrder`, "a signature must carry its position in the authored sequence");
        }

        if (item?.accompaniments != null) {
          const acc = item.accompaniments;
          if (!Array.isArray(acc.options) || acc.options.length < 1)
            err(`${ip}.accompaniments.options`, "must be a non-empty array");
          if (!isInt(acc.pick)) err(`${ip}.accompaniments.pick`, "must be an integer");
        }
      }
    }
  }

  if (isInt(meta?.items) && meta.items !== itemCount)
    err("meta.items", `claims ${meta.items} but the tree holds ${itemCount}`);

  return { ok: errors.length === 0, errors, stats: { items: itemCount, photoFiles: photoFiles.size } };
}

/** Throws with every error at once — the build should read the whole list, not one at a time. */
export function assertMenu(menu) {
  const result = validateMenu(menu);
  if (!result.ok) {
    const head = result.errors.slice(0, 25).join("\n  ");
    const more = result.errors.length > 25 ? `\n  … ${result.errors.length - 25} more` : "";
    throw new Error(`menu.json failed schema validation:\n  ${head}${more}`);
  }
  return result;
}
