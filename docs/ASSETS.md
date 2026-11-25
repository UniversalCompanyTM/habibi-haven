# Where every picture on this site comes from

Written 2026-11-18, after the owner's instruction: *"get images and videos concerning the Habibi
Haven from the internet. If you find that an item is not showing alone or as expected, generate or
edit that item and use it as the data. I have about 100 credits — use fewer."* Updated 2026-11-24
with the verified `menu.or.ke` venue-original retrieval and media exclusions.

That reordered the asset work. This file is the rule the rest of the site follows.

## The order of preference, and why

1. **The kitchen's own photographs.** `menu.or.ke` serves its dishes from a public Supabase bucket,
   and 141 of the 243 rows have a real picture behind them. Those are already mirrored into
   `site/public/menu/` and they are the only images on this site that are unquestionably of the food
   this restaurant actually plates. Full-file SHA-256 checks find **122 unique byte streams**, not 141:
   the other 19 rows repeat an existing upload and are not additional photographs.
2. **The restaurant's own photography.** Twelve frames salvaged from their abandoned site build
   (nine venue and three food), plus six portrait venue originals retrieved from the restaurant's
   `menu.or.ke` page on 2026-11-24. All eighteen photographs are inventoried in `brand/ASSETS.md`
   with measured dimensions, byte sizes and hashes: one 1200×1200 night façade, one 408×272 daylight
   façade, ten at 300×225, two at 346×506 and four at 329×512. Small, but real.
3. **Generated imagery, labelled as generated.** Only for rows where the source itself has nothing.
   Used for 28 rows so far.
4. **No unrelated open-web media and no re-hosted video.** See below.

## What the internet actually yielded

Updated 2026-11-24. The earlier conclusion that the open web yielded zero usable frames was
incomplete: anonymous retrieval from the restaurant's own `menu.or.ke` page produced **six additional
genuine venue photographs**. Every route considered, and the measured result:

| route | attempt | outcome |
|---|---|---|
| `menu.or.ke` Supabase bucket | all 243 rows have a `photo.remote`; the 102 without a picture point at files named `…-image-to-be-updated-soon-….jpg` | **141 rows with real dish photographs (122 unique files)** are already mirrored into `site/public/menu/`. No additional dish frames: the gap is the kitchen's, not the capture's — they never uploaded those shots. |
| Bucket file listing | `POST /storage/v1/object/list/menu-photos` | `400 headers must have required property 'authorization'`. Public read of known names only; no discovery of unreferenced photos. |
| [`menu.or.ke` Habibi Haven page](https://menu.or.ke/Habibi_Haven/habibi-haven.html) | anonymous GET of the page and its `Habibi_Haven_Ambience2.jpg` through `Habibi_Haven_Ambience7.jpg` originals on 2026-11-24 | **Six distinct venue JPEGs retrieved byte-for-byte.** Dimensions, byte sizes and full SHA-256 hashes were verified; none matched an existing brand or mirrored-menu file. They are mirrored in `brand/photos/`, with exact URLs in `brand/ASSETS.md`. |
| `menu.or.ke` exterior candidate | measured a 1280×604 exterior frame | **Excluded:** only a different crop of the existing 1200×1200 night facade, not another genuine scene. |
| `instagram.com/habibi.haven` | public official profile and posts discoverable; anonymous media retrieval | Direct media was blocked or signed behind login/checkpoint responses. **No image or video re-hosted.** |
| `facebook.com/61575101935569` | profile fetch returned `400`; two public video pages later exposed signed MP4 metadata on 2026-11-25 | **No media retrieved or re-hosted.** Only stable public post links are recorded in `press.json` and `research/PRESS.md`. |
| `tiktok.com/@habibi.haven` | public official videos discoverable; anonymous media retrieval | Direct media was blocked or signed. **No video re-hosted.** |
| Third-party YouTube item | discovered during the video search | **Excluded** as third-party material rather than an official-source asset; no frames or audio re-hosted. |
| Google Maps listing | anonymous fetch, desktop UA | `lh3.googleusercontent.com` appears once, as `ogw/default-user` — the photos are behind JS. |
| Web image search, four queries | "Habibi Haven restaurant Nairobi Koinange Street", "…courtyard interior", "…goat mandy", "habibi.haven Instagram restaurant" | Hits were an unrelated hotel or another restaurant entirely (a Chinese search index, a Leicester hotel, an Indonesian `habibi ai` landmark). **Zero** additional verified frames of this business. |

The six `menu.or.ke` originals supersede the old zero-frame conclusion, but unrelated web hits still
produced nothing usable. A photograph of somebody else's courtyard is not a placeholder — it is a
false statement about a real business, on a page whose entire argument is that its numbers are
traceable. This site would rather show a tile that says *photograph pending*.

No explicit reuse licence was found for the six official-source venue photographs. They are not
licensed assets and remain for the **private pitch preview only**, with photo rights still open.

## The 28 generated plates

Chosen by the owner's own rule: a row whose real photograph does not exist may be illustrated. They
are attached by `scripts/ingest-illustrations.mjs` from `content/illustrations.json`, which maps each
render to explicit item ids — hand-curated, because fuzzy matching is how a cheesecake lands on a
beef steak.

Three things make them honest rather than decorative:

- the script only touches a row whose `photo.placeholder === true`, so a kitchen photograph can never
  be overwritten by a render;
- every attached row carries `photo.illustration: true` and alt text reading *"an illustration of the
  dish, not a photograph from the kitchen"*, and `DishCard` paints an **Illustration** badge from that
  flag;
- `menu.meta` recomputes `realPhotos / illustratedPhotos / placeholderPhotos` from the rows on every
  run, so the counts the pages print are derived, and the 74 rows still without anything are still
  announced as pending.

### Where the files land, and why the build order matters

`build-content.mjs` regenerates `menu.json` from the kitchen's feed on **every** `prebuild`, and that feed
has no renders in it. So the illustration pass is the last step of `prebuild`, `data` and `content`; if it
is ever dropped from that chain the site does not break, it publishes a menu that quietly lost 28 plates
while the JPEGs sat in the bucket unreferenced. Two checks exist to make that mistake expensive instead of
invisible: `tests/run.mjs` compares the manifest against the rows (set equality, both directions), and
`scripts/verify-dist.mjs` counts `class="frame__badge"` in the built `/menu` — which is the only one of the
two that runs *after* the build CI actually ships.

The 45 MB of originals lives in `../vibe_images`, deliberately outside the repository. A checkout without
them is therefore the normal case, not an error, and the ingest handles it: no original but committed
mirrors means verify the mirrors and attach from them; neither means fail the build.

Venue frames go to `site/public/scenes/`, not `site/public/brand/`. That is not tidiness —
`sync-brand.mjs` deletes `site/public/brand` and republishes it from `brand/` (all eighteen photographs,
including the six `menu.or.ke` originals) as the first step of every build. A render parked in `/brand`
survives locally, where the originals are on disk to re-render it, and vanishes from a CI artefact, where
they are not. Dishes stay in `/menu`, the bucket `mirror-images.mjs` owns, because the illustration pass
runs after it in the two scripts where that mirror runs at all. On every content build,
`build-content.mjs` hashes each committed full-size dish mirror and stores that SHA-256 as
`photo.sha256` in `menu.json`. Gallery selection and its tally deduplicate on that digest; older
data without a valid digest falls back to the local path and cannot detect identical bytes under
different names. This changes the derived menu data, not the upstream source fingerprint.

## Credits, and what that rules out

One 5-second courtyard clip was generated before this instruction arrived. It is not used anywhere and
nothing similar will be generated again. Public official Facebook/TikTok videos and third-party clips
were discoverable, but direct media was blocked or signed and reuse permission is unconfirmed. Five
stable video links — three from the restaurant's own accounts and two third-party — plus one aggregate
are credited and linked, never re-hosted. Video on this site is therefore made the free way: real
photographs moving under the same light rig the rest of the page uses, which is a slideshow with better
manners rather than a claim about footage nobody has.

Remaining generation budget goes, in order, to whatever the pitch deck actually shows large — not to
filling 243 tiles. If the kitchen's own Instagram export can be requested at the meeting (it can be
produced from their account settings in one action, and it is the only source with real, plentiful,
correctly-labelled photography), that closes 74 gaps at zero cost and retires the illustrations
downstream. It is now question §12 in `docs/OPEN-QUESTIONS.md`.
