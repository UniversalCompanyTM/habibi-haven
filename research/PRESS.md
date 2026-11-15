# Habibi Haven — third-party coverage, video and review sources

Gathered 2026-11-14 by web search. This file exists so every external claim, quote and link on the
site has a line back to where it was read, and so a reader can tell what was fetched as a full page
from what was only ever visible in a search snippet. Nothing here is paraphrased into the site as if
it were our own copy; quoted lines are marked as quotes with their source.

## 1. Listing and directory facts

| Claim | Value | Where it was read | How it is used |
|---|---|---|---|
| TripAdvisor rating and depth | 3.7 / 5, 3 reviews | [TripAdvisor, Habibi Haven – Nairobi Restaurants](https://www.tripadvisor.com/Restaurant_Review-g294207-d34100284-Reviews-Habibi_Haven-Nairobi.html) | The Reviews section shows Google's 4.5 / 541 as the primary number and this as a *second* number. Two ratings from two panels, both shown, neither averaged into a comfortable single figure. |
| TripAdvisor rank | #651 of 928 restaurants in Nairobi | same page, via search snippet | Not printed on the site. It is a real number, but a rank a restaurant would not choose to advertise, so it belongs in this file and not in a hero. |
| Their positioning in their own listing | "a modern halal restaurant and cultural lifestyle destination in Nairobi CBD, offering a unique blend of Somali and international cuisine" | same page, via search snippet | Used as the factual basis for the halal and Somali framing on `/visit`. |
| Google rating | 4.5 / 5 from 541 reviews | Google Maps listing, captured in `BRAND-FACTS.md` §1 | Primary rating on `/visit`. |
| Price signal | Ksh 1,000–2,000 per person, reported by 53 people | Google Maps listing, `BRAND-FACTS.md` §1 | The configurator's per-person guidance compares against this, and only this. |
| Instagram bio line | "Habibi Haven Restaurant – A Taste of Home, A World of Flavor / Koinange Street, Nairobi CBD / ☎️ 0116 880000" | [instagram.com/habibi.haven](https://www.instagram.com/habibi.haven/) | Their own tagline. "A Taste of Home, A World of Flavor" is used as the home page's second-line statement because it is theirs, not ours. |
| Facebook about | "Habibi Haven is a modern, posh restaurant located in the heart of Nairobi's Central Business District, along Koinange Street. With a stylish ambiance and a…" (truncated at source) | [facebook.com/61575101935569](https://www.facebook.com/61575101935569/) | Quoted with the truncation visible, as their words. |
| Uber Eats store | "Habib Haven Restaurant" (one *i* missing), Full Mandy KES 2,200, Deillo KES 1,300, hours 09:00–17:00, flagged *Currently unavailable* | [ubereats.com/ke/store/habib-haven-restaurant](https://www.ubereats.com/ke/store/habib-haven-restaurant/0vCaJLbWXoa5xOoD97NtPQ) | Delivery window kept as a separate field, never as "opening hours". See §4 for the price it disagrees with. |
| Their ordering page | [menu.or.ke/Habibi_Haven/habibi-haven.html](https://menu.or.ke/Habibi_Haven/habibi-haven.html) (the menu.or.ke order screen is `menu-order-habibi-haven.html`) | read live in M0 | The `order` social link, and the ingest source. |

## 2. Video and social coverage (link, never re-host)

Third-party video is presented as **a link out with a caption**, not as a re-uploaded file or an
embedded player. Two reasons, both stated plainly: the clips are the reviewers' work, and a
downloaded copy of someone else's video on a commercial site is an asset we have no right to ship.
Instagram and TikTok also bot-gate their media, so a scrape would be unreliable as well as
unauthorised. The site therefore does what a good editor does: it credits, quotes and links.

| Item | What it says | Link |
|---|---|---|
| Instagram reel, food reviewer | "RESTAURANT REVIEW: @habibi.haven Koinange Street; Nairobi CBD — Habibi Haven is a Green Escape in the heart of Nairobi CBD; Tucked away on the…" | [instagram.com/reel/DQlckpEDDKJ](https://www.instagram.com/reel/DQlckpEDDKJ/) |
| TikTok, @johnson_valentis | "Habibi Haven Restaurant Review: Food & Prices on Koinange St." — description praises its "garden elegance" ambience | [tiktok.com/@johnson_valentis/video/7559881339999161656](https://www.tiktok.com/@johnson_valentis/video/7559881339999161656) |
| TikTok discovery page for the name | aggregate of visitor clips, captioned "Good ambience. Beautiful smiles. Great service. This is what dining at Habibi Haven feels like ✨ Come for the food, stay for the…" | [tiktok.com/discover/habibi-haven-restaurant](https://www.tiktok.com/discover/habibi-haven-restaurant) |
| Their own TikTok | @habibi.haven | [tiktok.com/@habibi.haven](https://www.tiktok.com/@habibi.haven) |

Search results also attached these phrases to the restaurant in other creators' captions — recorded
because they are how the place is talked about, and the copy should not contradict them: "aesthetic
dining Nairobi", "date night restaurants Nairobi", "hidden gem in Nairobi CBD", "Somali restaurants
in Nairobi". Where a phrase is used on the site it is either attributed or rewritten as ours.

## 3. Why the review section shows two ratings

Google says 4.5 from 541 reviews. TripAdvisor says 3.7 from 3. A site that averages those into
"4.4" or that quietly drops the small panel is doing marketing, not information. The two panels
have different populations, different depths and different dates, so the page shows both with their
counts, states which is which, and lets the reader weigh 541 against 3. The number of reviews is the
argument; hiding it would be the error.

## 4. Open disagreements carried forward

1. **Full Mandy: KES 2,200 vs KES 2,300.** Their live `menu_items` row (read 2026-11-14, fingerprint
   `cb80fa12fd31e7bc`) says **2,300**. The Uber Eats store still shows **2,200**, and so do
   `BRAND-FACTS.md` §3 and the architecture board — those were captured from Uber Eats. The site
   ships the row: **2,300**. `tests/run.mjs` pins the row's value, so a note that drifts back to
   2,200 fails the build's test step. Same class of staleness applies to Sinia (row 6,000; the
   earlier design note read 5,000).
2. **Name on delivery platforms.** "Habib Haven" (Uber Eats) vs "Habibi Haven" (Google, menu.or.ke,
   Instagram, their own page). The site uses the correct spelling everywhere and does not reproduce
   the typo, except as this note.
3. **Hours.** Google 06:30–23:00, menu.or.ke computes against 06:00–23:00, Uber Eats 09:00–17:00
   while flagged unavailable. Modelled as dine-in hours of record plus a separate delivery window,
   both printed on `/visit` (`content/taxonomy.json` → `menu.json` `meta.facts.hoursDisagreements`).
4. **102 of 243 dishes have no photograph** in their own database — the row's `image_url` points at
   an upload named "Image to be updated soon". Rendered as type cards with an honest alt, never as
   food. `content/menu.source.json` and the mirrored bucket also hold 64 objects no row references
   (237 stored vs 173 cited), so "the photos exist somewhere" is not true either.

## 5. What a client conversation could still add

- The venue photography in hand is real but small (nine of ten frames 300×225), so a shoot or the
  client's originals remain the right ask for full-bleed imagery.
- No vector logo on hand — only a 200×200 raster badge, so the wordmark is typeset, not traced.
- Whether reservations exist as an operation at all: nothing in the captured stack shows a booking
  system, and WhatsApp is demonstrably the channel, so the configurator hands off there and claims
  nothing more.
- Permission to re-host the reviewers' clips (with credit) if a future version wants video on the
  page rather than links out.
