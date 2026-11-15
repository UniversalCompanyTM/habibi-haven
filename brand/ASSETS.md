# Habibi Haven — real brand assets

Salvaged 2026-11-14 from the image set the restaurant's own abandoned Relume project used
(`habibi-haven/assets/`, deleted after this ran — the script is a one-time record of the copy).
These are the **only local copies** of the real logo and the real venue
photography. The CDN URLs in the capture were signed and expire; these bytes do not.

This corrects an earlier research note that said Habibi had no logo file and no venue
photography. That was wrong: it was based on probing menu.or.ke's Supabase buckets (which hold
dish photos only) and on never opening the capture's own asset manifest. See
`../research/BRAND-FACTS.md` §6.

## What is in hand

- **1 logo** — `logo/habibi-haven-badge.jpg`, a 200×200 raster of the circular teal badge. No vector original exists locally.
- **9 venue photographs** — night facade (1200×1200), daylight facade, the timber arches, the teal-sofa interior, the terrace, four table settings, the window table.
- **3 food photographs** — two sandwich plates and the karak chai service.
- **2 Google marks** — for attributing the review quotes.

## Inventory

| file | size | pixels | sha256/12 | what is actually in the frame |
|---|---|---|---|---|
| `logo/habibi-haven-badge.jpg` | 10.5 KB | 200×200 | `18c08c629d73` | Circular badge: teal mandala ring, HABIBI HAVEN around the top, HH monogram centre, RESTAURANT below. The mark the capture used in nav and footer. |
| `photos/venue-facade-night.jpg` | 402.6 KB | 1200×1200 | `4b1258473cdf` | Night exterior: stone facade, lit HABIBI ● HAVEN sign, trees wrapped in festoon lights, a HAPPY NEW YEAR sign, green neon reading Habibi Eat… |
| `photos/venue-facade-day.jpg` | 38.4 KB | 408×272 | `54cf8713742f` | The same facade in daylight, circular badge mounted between the two words of the sign. (The capture's alt text calls this "Habibi Haven courtyard" — the alt is wrong.) |
| `photos/venue-interior-teal-sofa.jpg` | 32.5 KB | 300×225 | `923b0d90f524` | Interior: arched timber branch structure, curved teal velvet banquette, yellow neon heart on the wall. |
| `photos/venue-courtyard-arches.jpg` | 20.9 KB | 300×225 | `6017172feb07` | The arches canopy: timber ribs springing from a brick half-wall, hanging lanterns, dense greenery overhead. |
| `photos/venue-terrace-seating.jpg` | 25.9 KB | 300×225 | `728e0804e6ff` | Outdoor terrace: stone paving with grass in the joints, wooden tables, teal banquettes, lanterns and a green canopy. |
| `photos/venue-table-branded-cup.jpg` | 21.6 KB | 300×225 | `e9f2b4c7afe4` | A laid wooden table: cup and saucer carrying the habibi script, small brass pot, hot-sauce bottles, wrapped cutlery. |
| `photos/venue-table-mid-meal.jpg` | 19.8 KB | 300×225 | `cff8811cb6e9` | Terrace table mid-meal: iced frappe, yellow cushion, sauce bottles, dates, menu card. |
| `photos/venue-terrace-table-city.jpg` | 20.5 KB | 300×225 | `eee7c9246085` | Near-identical framing of the same terrace table, CBD tower rising behind the greenery. |
| `photos/venue-table-by-window.jpg` | 12.9 KB | 300×225 | `e204258fb17a` | Table setting with greenery in front and Nairobi towers behind. |
| `photos/food-grilled-sandwich-fries.jpg` | 20.7 KB | 300×225 | `2b06052dad46` | Grilled sandwich with chips, slaw and a sauce jug. |
| `photos/food-chicken-sandwich-fries.jpg` | 20.7 KB | 300×225 | `cd26dbef2fb4` | Pressed chicken sandwich, fries and slaw on a wooden board. |
| `photos/food-tea-service.jpg` | 16.1 KB | 300×225 | `52c834e7be8f` | White teapot and a cup of karak chai on a habibi-scripted saucer. |
| `third-party/google-g.svg` | 12.4 KB | viewBox 0 0 24 24 | `7075e0e69be1` | Google mark, vector — used to attribute the review quotes. |
| `third-party/google-g.png` | 13.7 KB | unknown | `fc6013a69eda` | Google mark, raster variant of the same icon. |

Authored alt text in the capture was generic ("Guest photo at Habibi Haven") and in one case
wrong, so the descriptions above come from opening each file, not from its metadata.

## Deleting the capture is lossless

All 19 files in the capture are accounted for: 15 copied, and the 4 below are byte-identical duplicates of a file that was. Nothing is lost by removing the capture.

| capture file (second CDN id, not copied) | identical to |
|---|---|
| `1035270b-e1da-436a-01d5-5782f10e4701.jpg` | `photos/venue-terrace-seating.jpg` |
| `35bead63-c128-4801-f83e-0040230f9a01.jpg` | `photos/venue-interior-teal-sofa.jpg` |
| `dd06b1b5-edd7-48f6-9314-965e69045501.jpg` | `photos/food-chicken-sandwich-fries.jpg` |
| `e31674fd-c9f8-4cef-2547-4369db51c601.jpg` | `photos/venue-facade-day.jpg` |

## Resolution reality

Measured from the headers, the set spans 1200×1200, 200×200, 300×225, 408×272. Only the night facade is large;
most venue and food shots are 300×225 — thumbnail size. Blown up to a hero they will read soft,
so the layout uses them as cards and proofs of the room, and the one 1200×1200 frame is the only
candidate for a full-bleed image.

## What the real assets say about the brand

The logo and the signage are **teal-forward**, not gold. The room is timber arches, a green
canopy, hanging lanterns, teal banquettes and stone paving with grass in the joints — the
"garden haven" line in the existing copy is describing something that is actually there. Tableware
carries a "habibi" script mark. Any palette or scene work has to start from these observations.

## Status

Reference assets for a **private pitch preview**, not cleared for publication. Photo ownership and
the original logo file are open questions for the client call — `../docs/OPEN-QUESTIONS.md`.
