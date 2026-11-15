/**
 * site/src/lib/schema.mjs — the Restaurant JSON-LD, assembled from the same objects the pages render.
 *
 * Why a module rather than a literal inside Base.astro: this block is the one claim the site makes to
 * Google and to AI assistants, and a claim you cannot test is a claim you cannot trust. Inline, the only
 * way to check it was to read the built HTML by eye. As a module, tests/run.mjs can pin that every price
 * in it is the price the menu card shows, that the currency is the kitchen's own, and — the part that
 * matters most for a pitch built without the restaurant's involvement — that nothing enters the block
 * that does not have a source.
 */
import { signatureItems } from "./table.mjs";

/**
 * Their data models availability as `{ open, inStock }` on every one of the 243 items, which maps onto
 * Schema.org's two states without interpretation. Anything else — a price we do not have, a coordinate
 * nobody gave us — stays out of the block rather than getting a plausible value.
 */
function availability(item) {
  const inStock = item?.availability?.inStock;
  if (inStock === true) return "https://schema.org/InStock";
  if (inStock === false) return "https://schema.org/OutOfStock";
  return null;
}

/**
 * @param {{ menu: any, origin: string, canonical: string, description: string }} input
 * @returns {Record<string, any>} a Schema.org Restaurant graph, ready for JSON.stringify
 */
export function restaurantSchema({ menu, origin, canonical, description }) {
  const f = menu.meta.facts;
  const menuUrl = new URL("/menu", origin).href;

  const schema = {
    "@context": "https://schema.org",
    "@type": "Restaurant",
    "@id": `${canonical}#venue`,
    name: menu.meta.name,
    description,
    url: canonical,
    telephone: f.phone,
    priceRange: f.pricePerPerson,
    address: {
      "@type": "PostalAddress",
      // The three values are what a Kenyan address actually decomposes into. `f.address` is the display
      // string ("Koinange Street, Nairobi CBD") and splitting it on the comma would put " Nairobi CBD"
      // into streetAddress — a leading space in a field Google parses literally.
      streetAddress: "Koinange Street",
      addressLocality: "Nairobi",
      addressRegion: "Nairobi County",
      addressCountry: "KE",
    },
    hasMap: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(f.mapsQuery)}`,
    openingHoursSpecification: [
      {
        "@type": "OpeningHoursSpecification",
        dayOfWeek: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"],
        opens: f.hoursOfRecord.open,
        closes: f.hoursOfRecord.close,
      },
    ],
    aggregateRating: {
      "@type": "AggregateRating",
      ratingValue: f.rating,
      reviewCount: f.reviews,
      bestRating: 5,
    },
    servesCuisine: ["Somali", "Kenyan", "International"],
    sameAs: [f.socials.instagram, f.socials.tiktok, f.socials.facebook],
    image: new URL("/brand/venue-facade-night.jpg", origin).href,
    acceptsReservations: "True",
    // A Menu, then the dishes the kitchen itself marked as signature, each with the price their own data
    // gives it. Six, not 243: the block lives in every page's <head>, and Google's own guidance is to
    // mark up a representative selection. The full menu is in the HTML of /menu, where a reader sees it.
    menu: {
      "@type": "Menu",
      name: `${menu.meta.name} — full menu`,
      url: menuUrl,
      inLanguage: "en",
      hasMenuItem: signatureItems(menu).map((item) => {
        const entry = {
          "@type": "MenuItem",
          name: item.name,
          url: `${menuUrl}#${item.section}`,
        };
        if (item.description) entry.description = item.description;
        const stock = availability(item);
        entry.offers = {
          "@type": "Offer",
          price: Number(item.price),
          priceCurrency: menu.meta.currency,
          url: menuUrl,
        };
        if (stock) entry.offers.availability = stock;
        return entry;
      }),
    },
  };

  // GPS. `f.coordinates` is absent from the captured facts because no source we recorded carries it: the
  // listing gives a plus code (PR99+82, which is on /visit as written), OpenStreetMap has no node for the
  // venue, and a street centroid would be a different location wearing this venue's name. So the field is
  // implemented and stays dark until the restaurant hands over a pin — one edit to menu.overrides turns it
  // on, and tests/run.mjs covers both branches so it cannot half-work.
  const lat = Number(f.coordinates?.latitude);
  const lon = Number(f.coordinates?.longitude);
  if (Number.isFinite(lat) && Number.isFinite(lon)) {
    schema.geo = {
      "@type": "GeoCoordinates",
      latitude: lat,
      longitude: lon,
    };
  }

  return schema;
}
