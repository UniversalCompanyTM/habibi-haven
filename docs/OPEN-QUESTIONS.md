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
