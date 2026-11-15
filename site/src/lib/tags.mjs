// site/src/lib/tags.mjs — how the eleven taxonomy tags are allowed to appear on screen.
//
// The tag *identifiers* are data (content-schema.mjs exports KNOWN_TAGS and the build refuses anything
// else), but the words a guest reads are design. "sharing" as a chip is not English; "To share" is.
// tests/run.mjs asserts this map covers every KNOWN_TAGS entry and nothing more, so a tag added to the
// taxonomy without a word here fails the build's test rather than printing a bare slug.

import { KNOWN_TAGS } from "../content-schema.mjs";

export const TAG_LABELS = {
  goat: "Goat",
  sharing: "To share",
  spicy: "Spicy",
  veg: "Vegetarian",
  kids: "Kids",
  keto: "Keto",
  chai: "Chai",
  coffee: "Coffee",
  cold: "Cold",
  bakery: "Bakery",
  signature: "Signature",
};

/** Chips that carry weight in the room, so they get the accent treatment rather than grey. */
export const TAG_EMPHASIS = new Set(["signature", "spicy", "goat"]);

/** Safe by construction: an unknown tag still renders, as its own slug, rather than crashing a card. */
export function tagLabel(tag) {
  return TAG_LABELS[tag] ?? tag;
}

export function isKnown(tag) {
  return KNOWN_TAGS.includes(tag);
}
