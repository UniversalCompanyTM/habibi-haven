# Open questions — to settle with Habibi Haven

Nothing here blocks the build. Each one is a decision we cannot make for them, so the preview takes
the conservative option and lists the question.

## 1. Photo rights and the logo original

**Found.** The abandoned Relume project's asset set — now in `../brand/` — contains the restaurant's
real logo and real venue photography. Nobody asked us for it; it is their own project's material.

**Unknown.** Who took the photographs, whether Habibi owns them or a photographer does, and whether
the restaurant will hand over originals. Seven of the nine venue frames are 300×225 — the size the
platform served, not the size they were shot at.

**Preview position.** Used as internal reference and as small cards only, never full-bleed. The site
publishes nothing until they confirm.

**Ask.** The vector or high-resolution logo file, and the original photo set.

## 2. Teal or gold — which is the brand

**Observed.** The badge, the signage and the neon in the photographs are teal, timber and green. The
palette authored in the abandoned project is espresso `#12100E`, gold `#CB9235`, cream `#F6EFE2`, with
one deep-green scheme.

**The tension.** The architecture's token table and its measured contrast pairs were built on the
gold/espresso set. The physical place is teal-forward. Both can be true — gold as the metal-and-lantern
accent, teal as the room colour — but that is a brand call, not an engineering one.

**Preview position.** Keep the approved tokens; the deep-green scheme is already in them, and the
door's light rig can carry teal at the evening end of the clock. Flagged at M2, not silently changed.

## 3. The three rooms

The authored copy names **the courtyard, the kitchen, the lounge**. The photographs show arches, a
terrace, a teal-sofa interior and table settings. We do not know which frame is which room, or whether
"the kitchen" is a dining area or the actual kitchen.

**Preview position.** Copy keeps the three names; photography is captioned by what is visible in the
frame, not by a room name we cannot verify.

## 4. Hours

Three sources disagree: Google Maps **06:30–23:00** daily, menu.or.ke computes **06:00–23:00**, Uber
Eats lists **09:00–17:00**. Approved decision: publish 06:30–23:00 as the value of record and log the
rest. The authored copy says "from 6.30am until 11pm", which agrees with Maps.

**Ask.** Confirm the opening time, and whether delivery windows are genuinely different.

## 5. Is Uber Eats live?

The store page reads **"Currently unavailable"**, and the name is misspelled — "Habib Haven Restaurant",
one "i" short. Either the listing is dormant or it was never completed.

**Preview position.** No delivery promise anywhere on the site. Delivery is a WhatsApp/menu.or.ke
conversation until someone confirms otherwise.

## 6. Descriptions for 136 items

107 of 243 menu items carry a description; the other 136 are photo-only. Writing ingredient copy for
them would be inventing what a kitchen serves.

**Preview position.** Photo-led tiles with no fabricated text. **Ask:** a description pass from them,
or permission to leave it as is.

## 7. Hosting copies of their dish photos

The 173 hosted photos sit in their Supabase bucket, and the bucket is **public-read for objects**:
all six sampled photos returned `200 image/jpeg` to a plain Node `fetch` with no browser, no cookie,
no referer and no token (350 KB–1.0 MB each, 1000×1000). The earlier line here — that the bucket
"answers 401/403 to probes from outside a browser" — described a *listing* request and was read as an
*object* request; the measurement is in [`PROBE-FINDINGS.md`](PROBE-FINDINGS.md) §2.

So mirroring was never blocked, and it has been done: `site/public/menu/` now carries 173 originals
plus 173 400px derivatives, and the site does not depend on their bucket at runtime.

**Ask.** Not access — rights. Whether we may host copies at all, who owns the files, and who tells us
when a dish changes photo (see §1 for the photographer question and §8 for who can answer).

## 8. Who signs off

This is a concept for a private preview, carrying a disclosure that it is not Habibi's official site.
Before anything is published as theirs we need a named person who can approve the copy, the prices and
the photography.

## 9. The pin on the map

**Decided 2026-11-16: published, with the source named on the page that shows it.** The structured data now
carries `geo` — `-1.281687, 36.817562` — and [Visit](../site/src/pages/visit.astro) sends *Directions* to
that pair while *Open in Maps* still searches the listing by name. The rest of this section is why that is a
defensible number rather than a guessed one, and what is still worth confirming.

The earlier position here was "no latitude/longitude, because no source we captured carries one". That was
accurate about the captures and incomplete about the venue: the listing does carry a location, just in
plus-code form rather than as degrees.

OpenStreetMap's Nominatim returns nothing for "Habibi Haven", the Uber Eats capture carries no coordinates,
and a street centroid on Koinange Street would be a different location wearing this venue's name — those
three sentences are still true, and they are the reason the decode below had to be done at all.

**What the plus code turns out to resolve to.** A short code is recoverable: `PR99+82` + a reference
near the venue expands to the full code **`6GCRPR99+82`**, whose ~14 m cell centres on
**−1.281687, 36.817562**. The reference only picks which repetition on Earth is meant — the cell comes
from the venue's own code, and the decode was checked digit by digit against the grid.
`research/tools/pluscode.mjs` performs the recovery and then tries to falsify it:

| check | result |
| --- | --- |
| Nominatim reverse, zoom 18 | road **Koinage Street** — OSM's spelling of the published address |
| Nominatim reverse, zoom 17 | road **Koinage Street** |
| OSM ways named "Koinange Street" | nearest is 482 m — a *different* way; OSM maps the main road under the misspelling |
| OSM ways named "Koinage Street" | nearest segment ~117–146 m by vertex distance (a vertex metric, not perpendicular) |
| 250 m around the pin | Sapee Lounge 42 m, Kowloon Garden 54 m, Java House 61 m, "CJ's Koinage Street" 166 m, a coffee node 1 m |
| OSM node for the venue itself | none — Nominatim has never heard of Habibi Haven |

Read charitably, one source (Google's own code) agrees with a second (OSM snaps the point onto the
street the address names). Read strictly, it is still one source: the venue has no OSM node, the Uber
Eats capture carries no coordinates, and the street is mapped under two spellings, so nothing
independent confirms the door. An earlier run of this check printed "Monrovia Street" instead — my first
centre was off by half a cell (7 m), which is all it took to flip the answer at a junction. The tool now
prints the centre, both zooms and both spellings so a lucky snap cannot hide behind a metric.

**What the build now guarantees.** `site/src/lib/pluscode.mjs` holds the grid arithmetic — one copy, because
a second copy is what produced the 7 m error described above, and `research/tools/pluscode.mjs` imports it
rather than re-typing it. Three things are pinned:

- `scripts/build-content.mjs` re-encodes the published coordinates and fails the build if the result is not
  the plus code the site also publishes. The two location claims are hand-typed into the same file, and 111 m
  separates a right digit from a wrong one, so agreement is checked, not assumed. (Writing this assertion
  caught a bug in the helper itself: rounding the cell *centre* to the nearest cell steps into the next one,
  so `PR99+82` re-encoded as `PR99+93`. The function floors, which is the definition of "the cell containing
  this point", and a test now proves the guard can fail by shifting the pin 30 m.)
- `site/src/content-schema.mjs` refuses a coordinate that is not finite, not in range, exactly `0,0`, or
  published without a `coordinatesSource` sentence. A pin with no provenance attached is not publishable on
  this site.
- `tests/run.mjs` pins both branches — `geo` present and equal to the facts, and `geo` absent when the facts
  carry no coordinates — so turning it off later is one edit with the same safety net.

`scripts/verify-dist.mjs` still rejects a `geo` that is not a real coordinate in the built output, and the
Visit page prints the provenance under the buttons instead of leaving the number to speak for itself.

**Ask (unchanged, and still ten seconds on the owner's phone).** Open the Google Business listing's place
page and read either the two numbers behind the pin or the plus code, then compare with
`−1.281687, 36.817562`. If they match, the published `geo` is confirmed and the caveat can come off the
page. If they do not, the code stored in `menu.json` is wrong — worth knowing before anyone drives anywhere
on the strength of it.

## 10. Taking money — what M-Pesa would actually need

The brief asks for a checkout that pushes an M-Pesa prompt to the guest's phone and verifies the callback.
That is a real integration, and every part of it belongs to the restaurant:

- a Daraja account under their Safaricom business profile, plus the consumer **API key/secret** and the
  **Passkey** — three credentials we do not have and must never be sent through a chat;
- a **Paybill or Till number** to receive the money, and the short code that shows on the customer's phone;
- an **HTTPS callback URL** we control, plus a store for order records so a callback can be matched to an
  order and a double-tap cannot double-charge;
- their **consent** to take payments on their behalf at all — this site is a concept.

A button that looks like checkout and is not one is worse than no button: a guest who enters a phone number
expecting a PIN prompt and gets nothing takes that story to the counter. So the preview sends the order to
the venue's own WhatsApp thread with the lines, quantities and total already formatted, and the payment
happens where the restaurant already does business.

**What is already in place for the real thing.** The order maths (`site/src/lib/table.mjs`) runs on the menu
data, not on anything the browser typed, so a server-side function can reuse it to recompute the total
before it asks Daraja for money — the part that must not be trusted to the client. **Ask:** who owns the
Paybill, and is a card-on-file M-Pesa prompt even wanted for dine-in, or is this a delivery-only flow?

## 11. The day it stops being a preview — three knobs, in this order

The preview is deliberately invisible and deliberately paranoid, and both have to be turned off on purpose
rather than by accident. Checked against the live host on 2026-11-16, so this is what the deploy does today,
not what the config says it should:

1. **Indexing is off, and it is off in the pages rather than in a `robots.txt`.** All four routes ship
   `<meta name="robots" content="noindex, nofollow">` because `PUBLIC_INDEXABLE` defaults to `false`
   (`site/astro.config.mjs:50`) — the right posture for a site the restaurant has not agreed to yet. There is
   no `robots.txt` in the build: `https://habibihavenpreview.pages.dev/robots.txt` answers 200 with 1 248 bytes
   of Cloudflare's own content-signals comments and no `User-agent:` line, and `/sitemap.xml` is 404. Neither
   is a defect while every page is `noindex`, because a crawler told not to index a page needs no map to it.
   The order matters at launch: domain first, then `PUBLIC_INDEXABLE=true`, then a sitemap — so the file has
   something to point at.
2. **The canonical follows one variable.** `SITE_URL` becomes the real domain at build time, and every
   `rel=canonical`, `og:url` and JSON-LD `@id` moves with it. `scripts/verify-dist.mjs` compares each page's
   canonical and `og:url` with the route it was built from, so a stale host fails the build instead of
   shipping quietly.
3. **The Worker would then stop accepting the site — this is the one that actually bites.** CORS in
   `backend/src/index.mjs` allows `https://habibihavenpreview.pages.dev` plus any `*.habibihavenpreview.pages.dev`
   preview, and nothing else. A new domain is a same-day edit to the allow-list, not a follow-up: leave it
   alone and the pages still render, the WhatsApp and `tel:` links still work, and only the Record/Book button
   fails — into the `unreachable` arm, which hands the guest the WhatsApp fallback with their own words in it,
   so nobody sees a stack trace. Graceful, still broken. **Ask:** the domain, and change the allow-list in the
   same deploy that uses it.

Nothing in the book notifies anyone yet. A recorded table sits in D1 until someone queries it — for the pitch
that is exactly what the page claims ("nothing is confirmed", the phone number is who decides); for a trading
restaurant it is the first thing that needs a watcher. See §8 for who signs off.

## 12. The 74 dishes still without a picture — one export closes it for free

The menu carries 243 rows. 141 of them are the kitchen's own photographs, mirrored from their site. 28 are
labelled renders standing in for dishes nobody has photographed. **74 show a type card that says "Photograph
pending"** — the row's name and price, honestly empty.

That last number is not a build problem, and it is not fixable from the outside. Measured on 2026-11-18 and
recorded in [ASSETS.md](ASSETS.md): every remote URL on the 74 rows is the literal string
`image-to-be-updated-soon` that their CMS emits for an empty slot; their public bucket refuses a listing
without credentials; the Instagram and Facebook pages return a login shell with zero image URLs in it; TikTok
returns a stub; the Google Maps place carries only default avatars; and every reverse image search came back
with other restaurants' food. Publishing one of those would make the site's central claim — that its facts
trace to a source — false, so none went in.

**Ask:** one export from whoever holds the phone that took the menu photos. Any of these is enough:

- the **Google Business Profile media library** (owners can download all of it in one action), or
- a **ZIP / Drive link** to the camera-roll folder or the Instagram grid archive, or
- a folder of shots for just the highest-traffic gaps — the seven rows the kitchen leads with, and the
  rice-and-mandy family, account for most of what a guest scrolls looking for.

Worth asking for in the same breath: **10–15 vertical seconds of the courtyard at dusk and one plate of
mandy arriving at the table.** That is the footage the site currently has no real version of, and it is the
difference between a menu that looks like a spreadsheet and a place you can picture eating at.

**What happens if it never comes:** nothing breaks. The 74 stay type cards, the 28 keep their "Illustration"
badge, and the counts in the meta are derived from the rows rather than asserted, so the copy can never claim
more coverage than the folder actually had. `tests/run.mjs` fails the build if a render is ever saved as if it
were a photograph — the empty state is the failure mode this project prefers.
