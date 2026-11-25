// site/src/lib/gallery.mjs — what this site can honestly show as a picture of Habibi Haven.
//
// There are exactly two sources of photographs, and they are not the same kind of thing:
//
//   VENUE_FRAMES — eighteen frames of the room and the food, each opened, measured and described rather
//     than trusted to its filename. Twelve come from the restaurant's own abandoned project; six more
//     portrait frames come from its menu.or.ke page. Ten of the eighteen are still only 300×225, so the
//     component keeps the small files small, prints every file's real size, and never crops a portrait
//     into the older landscape frames' 4:3 shape. Provenance and rights status live in brand/ASSETS.md.
//
//   dishPhotographs() — the menu's own files, mirrored by scripts/mirror-images.mjs. 141 rows carry a real
//     photograph, all of them 800×800 with a 400px thumb, but repeated uploads reduce those rows to 122
//     unique byte streams. The other 102 rows are 28 illustrations (labelled as illustrations, by rule)
//     and 74 placeholders whose upstream text literally reads "Image to be updated soon". Those are not
//     pictures of the food, so
//     they are not in this wall, and the wall prints how many dishes are missing from it.
//
// The selection is deterministic. Nothing here reads a clock or a random number, and nothing depends on
// object-iteration accidents: within a family, a signature dish comes first, then the rows the kitchen
// described (longest description first), then the id; across families the picks interleave in menu order
// so one family cannot fill the wall because it happens to be alphabetical. That is what makes the wall
// rebuild identically in CI, in a preview, and on the deployed site.

import { money } from "./table.mjs";

// `size` is the pixel size of the file we hold, from brand/ASSETS.md. It is printed in the viewer, which
// is the difference between a small photograph and a hidden small photograph.
export const VENUE_FRAMES = [
  {
    id: "facade-night",
    kind: "place",
    src: "/brand/venue-facade-night.jpg",
    w: 1200,
    h: 1200,
    size: "1200 × 1200",
    alt: "The stone facade after dark: the lit HABIBI HAVEN sign, trees wrapped in festoon lights, a green neon sign",
    caption: "The door after dark, with the planting lit.",
  },
  {
    id: "facade-day",
    kind: "place",
    src: "/brand/venue-facade-day.jpg",
    w: 408,
    h: 272,
    size: "408 × 272",
    alt: "The same facade in daylight, the circular Habibi Haven badge mounted between the two words of the sign",
    caption: "The same wall in daylight, and the badge between the words.",
  },
  {
    id: "courtyard-arches",
    kind: "place",
    src: "/brand/venue-courtyard-arches.jpg",
    w: 300,
    h: 225,
    size: "300 × 225",
    alt: "Timber arch ribs springing from a brick half-wall, hanging lanterns, dense greenery overhead",
    caption: "The arches: timber ribs off a brick half-wall, lanterns in the greenery.",
  },
  {
    id: "interior-teal-sofa",
    kind: "place",
    src: "/brand/venue-interior-teal-sofa.jpg",
    w: 300,
    h: 225,
    size: "300 × 225",
    alt: "Interior with a curved teal velvet banquette under the timber branch structure and a yellow neon heart on the wall",
    caption: "Inside: the teal banquette, and the neon heart nobody asked for.",
  },
  {
    id: "terrace-seating",
    kind: "place",
    src: "/brand/venue-terrace-seating.jpg",
    w: 300,
    h: 225,
    size: "300 × 225",
    alt: "Outdoor terrace with stone paving, grass in the joints, wooden tables and teal banquettes under a green canopy",
    caption: "The terrace, where the grass grows through the paving.",
  },
  {
    id: "table-by-window",
    kind: "place",
    src: "/brand/venue-table-by-window.jpg",
    w: 300,
    h: 225,
    size: "300 × 225",
    alt: "A table setting with greenery in the foreground and Nairobi towers behind it",
    caption: "A window table, with the CBD for company.",
  },
  {
    id: "terrace-table-city",
    kind: "place",
    src: "/brand/venue-terrace-table-city.jpg",
    w: 300,
    h: 225,
    size: "300 × 225",
    alt: "A terrace table with a tower rising behind the greenery",
    caption: "The same terrace from the other side: table, leaves, tower.",
  },
  {
    id: "table-branded-cup",
    kind: "place",
    src: "/brand/venue-table-branded-cup.jpg",
    w: 300,
    h: 225,
    size: "300 × 225",
    alt: "A laid wooden table: cup and saucer carrying the habibi script, a small brass pot, hot-sauce bottles, wrapped cutlery",
    caption: "How a table arrives: scripted cup, brass pot, two hot sauces.",
  },
  {
    id: "table-mid-meal",
    kind: "place",
    src: "/brand/venue-table-mid-meal.jpg",
    w: 300,
    h: 225,
    size: "300 × 225",
    alt: "A terrace table mid-meal with an iced frappe, sauce bottles, dates and a menu card",
    caption: "Mid-meal, before anyone has asked for the bill.",
  },
  {
    id: "food-tea-service",
    kind: "place",
    src: "/brand/food-tea-service.jpg",
    w: 300,
    h: 225,
    size: "300 × 225",
    alt: "A white teapot and a cup of karak chai resting on a saucer printed with the habibi script",
    caption: "Karak chai, poured the long way round.",
  },
  {
    id: "food-grilled-sandwich",
    kind: "place",
    src: "/brand/food-grilled-sandwich-fries.jpg",
    w: 300,
    h: 225,
    size: "300 × 225",
    alt: "A grilled sandwich with chips, slaw and a small jug of sauce",
    caption: "Grilled, with chips and slaw alongside.",
  },
  {
    id: "food-chicken-sandwich",
    kind: "place",
    src: "/brand/food-chicken-sandwich-fries.jpg",
    w: 300,
    h: 225,
    size: "300 × 225",
    alt: "A pressed chicken sandwich with fries and slaw on a wooden board",
    caption: "Pressed chicken, on a board, with fries.",
  },
  {
    id: "lounge-teal-sofa",
    kind: "place",
    src: "/brand/venue-lounge-teal-sofa.jpg",
    w: 346,
    h: 506,
    size: "346 × 506",
    alt: "Curved teal sofa beneath timber arches and greenery, with a yellow heart neon sign",
    caption: "The teal-sofa lounge under Habibi Haven’s timber arches.",
  },
  {
    id: "terrace-daylight",
    kind: "place",
    src: "/brand/venue-terrace-daylight.jpg",
    w: 346,
    h: 506,
    size: "346 × 506",
    alt: "Daylit terrace with a round wooden table, white cushioned chairs and stone-and-grass paving",
    caption: "A daylight table on the garden terrace.",
  },
  {
    id: "neon-green-wall",
    kind: "place",
    src: "/brand/venue-neon-green-wall.jpg",
    w: 329,
    h: 512,
    size: "329 × 512",
    alt: "Green living wall with illuminated “My Habibi” lettering, tan chairs and teal seating",
    caption: "The green neon wall at Habibi Haven.",
  },
  {
    id: "dessert-counter",
    kind: "place",
    src: "/brand/venue-dessert-counter.jpg",
    w: 329,
    h: 512,
    size: "329 × 512",
    alt: "Dessert display counter beneath woven pendant lights and curved timber arches",
    caption: "Desserts at the counter beneath woven lanterns.",
  },
  {
    id: "timber-arches-wide",
    kind: "place",
    src: "/brand/venue-timber-arches-wide.jpg",
    w: 329,
    h: 512,
    size: "329 × 512",
    alt: "Wide interior view through timber arches with dense greenery, lanterns and teal seating",
    caption: "Timber arches and greenery frame the dining room.",
  },
  {
    id: "banquette-occupied",
    kind: "place",
    src: "/brand/venue-banquette-occupied.jpg",
    w: 329,
    h: 512,
    size: "329 × 512",
    alt: "Curved teal banquette in the foreground with guests seated beneath timber arches",
    caption: "The occupied teal banquette at Habibi Haven.",
  },
];

// A photograph of a dish, for the purposes of this file, is a row whose photo came from the listing and is
// neither the upstream placeholder nor one of our labelled illustrations. Same test the cards use, so the
// wall and the menu can never disagree about what counts as a picture.
export function isRealPhotograph(item) {
  const photo = item?.photo;
  return !!photo?.local && photo.placeholder !== true && photo.illustration !== true;
}

// Every row with a genuine photograph, in menu order.
export function photographedRows(source) {
  const rows = [];
  for (const family of source?.families ?? []) {
    for (const section of family.sections ?? []) {
      for (const item of section.items ?? []) {
        if (isRealPhotograph(item)) rows.push({ item, family: item.family ?? family.id, section: item.section ?? section.id });
      }
    }
  }
  return rows;
}

// The build records the full mirrored file's SHA-256. Different listing URLs can still resolve to identical
// bytes, so paths alone are not photograph identity. Older/fixture data without a valid digest falls back to
// its local path: it cannot prove byte equality, but it can still avoid showing the exact same file twice.
const photographIdentity = (photo) => {
  const digest = photo?.sha256;
  return typeof digest === "string" && /^[a-f0-9]{64}$/i.test(digest)
    ? `sha256:${digest.toLowerCase()}`
    : `path:${photo?.local ?? ""}`;
};

// Distinct byte streams, because the listing reuses a photograph for two rows now and then and the wall must
// not show the same plate twice and call it two dishes.
export function photographFiles(source) {
  return new Set(photographedRows(source).map((r) => photographIdentity(r.item.photo))).size;
}
const betterWithinFamily = (a, b) =>
  (b.item.signatureRole ? 1 : 0) - (a.item.signatureRole ? 1 : 0) ||
  (b.item.description?.length ?? 0) - (a.item.description?.length ?? 0) ||
  a.item.id.localeCompare(b.item.id);

// The wall itself: signature dishes and described dishes first, spread across the six families so the
// courtyard does not look like a breakfast room, capped at `limit` so one section of one page cannot
// become 141 image requests.
export function dishPhotographs(source, { limit = 18 } = {}) {
  const buckets = new Map();
  const order = [];
  for (const row of photographedRows(source)) {
    if (!buckets.has(row.family)) {
      buckets.set(row.family, []);
      order.push(row.family);
    }
    buckets.get(row.family).push(row);
  }
  for (const list of buckets.values()) list.sort(betterWithinFamily);

  const picks = [];
  const seen = new Set(VENUE_FRAMES.map((f) => `path:${f.src}`));
  const cursors = new Map(order.map((family) => [family, 0]));
  // Round-robin over each family's next *unique* photograph. A repeated upload is skipped inside that
  // family's turn rather than consuming a turn, so deduplication cannot make one family vanish early.
  while (picks.length < limit) {
    let added = false;
    for (const family of order) {
      const list = buckets.get(family);
      let cursor = cursors.get(family);
      while (cursor < list.length) {
        const row = list[cursor++];
        const identity = photographIdentity(row.item.photo);
        if (seen.has(identity)) continue;
        cursors.set(family, cursor);
        seen.add(identity);
        const { item, section } = row;
        picks.push({
          id: item.id,
          kind: "dish",
          src: item.photo.local,
          thumb: item.photo.thumb ?? item.photo.local,
          w: item.photo.width ?? 800,
          h: item.photo.height ?? 800,
          size: `${item.photo.width ?? 800} × ${item.photo.height ?? 800}`,
          alt: item.photo.alt || `${item.name}, as the listing photographs it`,
          caption: item.description || "Photographed by the listing; the kitchen gives this one no description.",
          title: item.name,
          price: item.price,
          // Formatted here, by the same function the dish cards use, rather than in the browser: a price in
          // the viewer and the same price on /menu have to be the same string, and two formatters is how
          // they stop being one.
          priceLabel: item.price == null ? null : money(item.price),
          family: row.family,
          section,
        });
        added = true;
        break;
      }
      cursors.set(family, cursor);
      if (picks.length >= limit) break;
    }
    if (!added) break;
  }
  return picks;
}

// The line that goes under the wall. Every number in it is measured from the same data the wall is built
// from, so a future ingest run cannot leave it lying. `rows` and `files` are counted separately and are
// not the same question: a row is a dish the kitchen sells, a file is a picture, and the listing has been
// known to photograph one plate for two rows. "N rows have no photograph" is about rows.
export function galleryTally(source, dishes) {
  const total = source?.meta?.items ?? photographedRows(source).length;
  const withPhoto = photographedRows(source).length;
  // The two flavours of "no photograph" are counted separately because they are different sentences: one
  // is an upstream gap the restaurant can close, the other is a drawing this site made and labelled.
  let illustrated = 0;
  let placeholder = 0;
  for (const family of source?.families ?? []) {
    for (const section of family.sections ?? []) {
      for (const item of section.items ?? []) {
        if (isRealPhotograph(item)) continue;
        if (item?.photo?.illustration === true) illustrated += 1;
        else placeholder += 1;
      }
    }
  }
  return {
    frames: VENUE_FRAMES.length,
    dishes: dishes.length,
    files: photographFiles(source),
    families: new Set(dishes.map((d) => d.family)).size,
    withPhoto,
    total,
    without: total - withPhoto,
    illustrated,
    placeholder,
  };
}
