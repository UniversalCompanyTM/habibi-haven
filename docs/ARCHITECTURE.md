# Habibi Haven — architecture and build plan

> Canonical copy, kept in the repo so the project is self-contained. It mirrors the plan approved on
> 2026-11-14, including the two post-approval **Amendments** below the decision table (A1: real logo
> and venue photography were in hand after all; A2: the Relume capture is deleted, its value distilled
> into `research/COPY-BANK.md` and `brand/`). Update this file when the architecture changes, not only
> the working plan.

## Context

Habibi Haven Restaurant (Koinange Street, Nairobi CBD) has **no website** — Google Maps literally
shows "Add website" on its own listing. The user had a verbatim extraction of an abandoned Relume
project for them (5 pages, only Home ever authored) and instructed that the Relume connection be cut.
The capture has now been **deleted** — its usable content distilled into
`habibi-haven-site/research/COPY-BANK.md` (every authored line, verbatim) and
`habibi-haven-site/brand/` (the real logo and the real venue photography, with a lossless-deletion
proof in `brand/ASSETS.md`). The new site is standalone and references nothing from Relume at runtime.

The ambition is a site "like Lusion's customisation or far better" but *for a real restaurant* —
not a sample. That means the spectacle has to survive contact with 243 menu items, a mobile
Nairobi audience, and staff who will change prices without asking anyone.

Everything factual in this plan comes from the research pass in
`habibi-haven-site/research/BRAND-FACTS.md`, `menu-structured.json`, `identity-raw.json` and
`uber-eats-raw.txt`. No implementation starts until this plan is approved, and the **first**
artifact produced after approval is the architecture preview image described in the last section —
still no site code.

## Locked decisions (from the user, this session)

| # | Question | Decision |
|---|---|---|
| 1 | How far into real-time 3D | **Immersive door + fast interior** — WebGL is the entrance, the rest of the site is DOM |
| 2 | Signature interaction | **Build-your-table configurator** — 3D table, real dishes, party scaling, live KSh total, WhatsApp handoff |
| 3 | Menu data at runtime | **Own the data, watch their source** — versioned typed file, never runtime-coupled |
| 4 | Who edits | **Sync from menu.or.ke** — the existing ordering system stays the system of record; no second admin |
| 5 | Performance floor | **Gate the 3D, never gate the site** — capability gate + 2D fallback with identical data and math |
| 6 | v1 scope | **Home + Table + Menu + Visit** (4 routes), clean seams for Events/Gallery |
| 7 | Visuals | **Real food, designed ambience** — their 173 hosted dish photos; procedural room; no faked or AI venue photos *(premise amended after approval — see Amendments A1: real venue photography and the real logo were in hand all along)* |
| 8 | Stack | **Astro + islands + Three.js**, static output |
| 9 | Booking | **WhatsApp handoff, static** — no backend, nothing to confirm a table falsely |
| 10 | Exposure | **Private preview, pitch-grade** — not published as Habibi's official property before they sign off |
| 11 | Hours of record | **06:30–23:00 daily (Google Maps)**, both disagreements logged |
| 12 | Preview image method | **Deterministic architecture board** — vector, generated from this file's own tables; labels that are not in this file cannot appear in the image |

## Amendments after approval

Recorded rather than quietly folded in, because they change what the site can show.

**A1 — the "no venue photography, no logo" premise was false.** While carrying out the file tidy,
opening the capture's own `MANIFEST.json` and then each image showed the real circular teal HABIBI
HAVEN badge (200×200) and nine genuine venue frames — night façade (1200×1200), daylight façade, the
timber arches, the teal-sofa interior with its yellow neon heart, the stone terrace, and four table
settings including the window table — plus three food frames. The claim had come from probing menu.or.ke's
Supabase buckets (dish photos only) and never checking the capture's asset folder. Evidence and
inventory: `habibi-haven-site/brand/ASSETS.md`; correction logged in
`habibi-haven-site/research/BRAND-FACTS.md` §6.

What changes: the site may use the real logo and real venue photography; the "designed ambience"
rationale for the procedural door becomes *choice, not necessity* — the room is still modelled because
a photograph cannot be orbited, but the DOM pages no longer have to imply the room. What does not
change: no AI-generated or stock venue imagery, and the 3D scene stays procedural.

Two consequences flagged for the client rather than decided here: the physical brand is
**teal-forward** while the approved tokens are gold/espresso (`docs/OPEN-QUESTIONS.md` §2), and seven
of the nine venue frames are 300×225 — card size, not hero size (§1). The room names in the authored
copy (courtyard / kitchen / lounge) cannot be matched to specific frames (§3).

**A2 — the Relume capture is deleted.** Its value was distilled first, losslessly: every authored
line into `research/COPY-BANK.md`, every unique image into `brand/` (the script proves all 19 capture
files are accounted for — 15 copied, 4 byte-identical duplicates). `docs/ARCHITECTURE.md` keeps this
plan in sync.

**A3 — the asset count in A1 and on the board was wrong.** A1 said "ten genuine venue frames" and the
board said "logo + 13 photos". `brand/ASSETS.md` holds 15 files: 1 logo, 9 venue photographs, 3 food
photographs and 2 Google marks — so **12 photographs, not 13**, and **7 of the 9 venue frames** are
300×225, not "nine of the ten". The mistake was counting the window table twice: once as a venue
frame and again outside the "four table settings" it is already one of. Corrected here, on the board,
in `docs/OPEN-QUESTIONS.md` §1 and in `research/BRAND-FACTS.md` §6.

## Fact base (verified, with sources)

| Fact | Value | Source |
|---|---|---|
| Name / category | Habibi Haven Restaurant, "Fusion restaurant" | Google Maps |
| Delivery name | "Habib Haven Restaurant" — one "i" missing; store **"Currently unavailable"**, 09:00–17:00 | Uber Eats |
| Rating | 4.5 ★, **541** reviews | Google Maps |
| Price signal | Ksh 1,000–2,000 pp (reported by 53) | Google Maps |
| Phone / WhatsApp | 0116 880 000 → `wa.me/254116880000` | Maps + menu.or.ke |
| Address / Plus code | Koinange Street, Nairobi CBD · PR99+82 | Google Maps |
| Hours | Maps 06:30–23:00 daily · menu.or.ke computes 06:00–23:00 · Uber Eats 09:00–17:00 | three sources |
| Menu scale | **243 items**, all 243 with a photo, **173 unique photos**, 107 with descriptions, 1 flagged out of stock | menu.or.ke render |
| Prices | KSh **100 → 6,000**, median **550** | menu.or.ke render |
| Taxonomy caveat | `BREAKFAST COMBO` (65) and `HABIBI COFFEE` (87) are over-collected — they absorbed following sub-groups; Uber Eats splits the same kitchen into **~37 real sections** | verified this session |
| Beverages | ≈⅓ of the menu: coffees, lattes, teas (Karak Chai, Camel Tea, African Tea Pot), Cool Specials, iced teas, 10 milkshakes, smoothies, **dawas**, nojitos, coladas, 10 juices | both sources |
| The goat | Half Mandy 1,300 · Full Mandy 2,300 · Deillo 2,600 / 1,400 half · Arosto 2,800 / 1,450 half · **Sinia platter 6,000** | live `menu_items` rows (Amendment A5; the delivery listing lags) |
| Bakery as product | whole cakes in **2KG and 3KG formats** + slices, cheesecakes, muffins, cookies ×3, brownies | both sources |
| Coastal/Somali vocabulary | malawax, anjera, mandy, mandazi, dawa, kahawa, samosa, in-house tortilla | both sources |
| Voice | second person, short, playful, emoji as punctuation ("Sip, savor, and stay a while", "Warning: dangerously delicious", "where every visit feels like coming home") | 12 Instagram captions |
| Review themes | welcoming staff **13**, friendly supervisor **11**, chicken biryani 2, mandi 2 → the site is about *staying*, not only eating | Google Maps |
| Existing copy bank | "A garden haven in the middle of the city"; "A haven is not a place you pass through. It is a place you stay too long."; "Three places to sit, and none of them rush you"; "Come for the lamb chops. Stay for the third cup of chai."; "541 reviews, and the same things keep coming up"; "Find us on Koinange Street" | `research/COPY-BANK.md` (verbatim, from the deleted capture) |
| Brand assets in hand | real logo (200×200 raster badge, teal), 9 venue + 3 food photographs, 2 Google marks | `brand/ASSETS.md` — corrected by Amendment A1 |
| Still not in hand | vector logo, high-resolution venue originals, TikTok grid, IG media/follower counts (bot-gated) | research gaps |

## Concept (creative spine)

**"Set your table"** — one evening on Koinange Street, in five movements:
**Arriving** (the 3D door) → **Sitting** (the table you build) → **Ordering** (all 243 dishes) →
**Staying** (541 reviews and what they keep repeating) → **Coming back** (hours, map, WhatsApp).

Lusion's customisation panel is answered by the **light rig as a clock**: a draggable 06:30 → 23:00
hour (their real opening window) drives one shared variable — palette, scene lighting, and the
site's mood — so morning reads chai-and-pastry and midnight reads lounge. Copy rule: every factual
claim traces to the Fact base above. No invented heritage, no fake awards.

## Architecture

### Repository layout (`habibi-haven-site/`)

```
habibi-haven-site/
  brand/                        # real logo + venue/food photography (ASSETS.md inventories it)
  research/                     # read-only evidence base
    BRAND-FACTS.md              # sourced facts, incl. the A1 correction
    COPY-BANK.md                # every authored line from the deleted capture, verbatim
    menu-structured.json  identity-raw.json  uber-eats-raw.txt  menu-live.json
    tools/                      # the probes that produced the above
  content/
    menu.source.json            # raw ingest output, never imported by the site
    menu.overrides.json         # house-written descriptions/tags only
    taxonomy.json               # source heading -> family -> section map (~37 sections)
    drift.md                    # generated diff report, human-approved before publish
  scripts/
    probe-ingest.mjs            # M0 feasibility probe (headless read + image reachability)
    ingest.mjs                  # fetch/parse -> menu.source.json + drift.md
    build-content.mjs           # source + overrides + taxonomy -> src/data/menu.json (validated)
    mirror-images.mjs           # download referenced photos -> src/assets/menu/
    check-drift.mjs             # re-run ingest, report, exit non-zero on unreviewed change
  site/                         # Astro app
    astro.config.mjs            # static output, image service, sitemap
    src/
      data/menu.json            # the ONLY menu the site reads
      content-schema.mjs        # validation schema (family/section/item/price/photo)
      lib/table.mjs             # pure configurator math + WhatsApp payload builder
      lib/hours.mjs             # single hours model + open/closed (Africa/Nairobi)
      lib/gate.mjs              # capability tiers: full | lite | 2d | poster
      components/ DoorScene.astro   # island, client:idle, dynamic-imports three
      components/ TableBuilder.astro
      components/ MenuExplorer.astro
      components/ HoursClock.astro
      scenes/ haven.js          # scene graph, materials, steam, tile pattern
      scenes/rig.js             # time-of-day light rig (shared with CSS var)
      pages/ index.astro  table.astro  menu.astro  visit.astro
      styles/tokens.css         # palette, type scale, motion, hour→palette
    public/
  docs/
    OPEN-QUESTIONS.md           # hours disagreement, Uber Eats status, name spelling, photo rights
    ARCHITECTURE.md             # this plan, kept in sync
  tests/
```

### Data flow

```
menu.or.ke (their system of record)
   │  scripts/ingest.mjs  ← M0 probe decides: plain fetch | scripted read
   ▼
content/menu.source.json  ──► content/drift.md  (human reviews, approves)
   │                              ▲
   ├─ taxonomy.json ──────────────┤ fixes the over-collected 20-heading problem
   ├─ menu.overrides.json ────────┘ house copy for the 136 items with no description
   ▼
scripts/build-content.mjs ──► site/src/data/menu.json   (schema-validated, typed)
   ▼                                                    └► mirror-images.mjs → src/assets/menu/
Static build: Home · Table · Menu · Visit  (+ JSON-LD, sitemap, noindex on preview)
   ▼
Capability gate at runtime ──► 3D door OR 2D table  (identical data, identical price math)
   ▼
"Send this table" ──► wa.me/254116880000?text=<structured message>   (no backend)
```

### The door engine (the only WebGL in the site)

- **Scene**: procedural long table, woven cloth, hammered-brass and ceramic materials, parametric
  8-fold coastal tile backdrop generated at build into a texture, GPU-point steam spawned only
  above genuinely hot items (Full Mandy, Sinia, soups, Karak Chai). No photogrammetry, no stock,
  no AI venue photo. Each dish object is a simple lathe/plate proxy **plus its real hosted photo**
  on the hover card — so the food stays factual even where the modelling is stylised.
- **Interaction**: orbit ±35° by pointer; hover lifts a dish and shows its real name, section and
  price; click adds it to the table; party-size chips 2/4/6/8 scale quantities using real sharing
  formats (Shawarma Family, Sinia, 2KG/3KG cakes); live KSh total via `Intl.NumberFormat('en-KE')`.
- **Tiers** (`lib/gate.mjs`, checked in order): `save-data` or 2g/3g → **poster**; reduced-motion →
  **poster + scroll**; no WebGL context → **2d**; ≤4 cores / ≤4GB deviceMemory / coarse pointer →
  **lite** (dpr clamp 1, one light, particle cap); else **full**. After init, 30 measured frames
  averaging >24ms downgrade full→lite once. Every tier keeps the same configurator, same data,
  same checkout.
- **Bundle discipline**: `three` is never in the entry graph — only the gate-yes path
  dynamic-imports it. `lib/table.mjs`, `lib/hours.mjs`, `lib/gate.mjs` are dependency-free and
  unit-testable without DOM or GPU.

### Routes

| Route | Contents |
|---|---|
| `/` | Arriving (door, poster-first paint), the "stay too long" thesis, Three places to sit, the table teaser linking to `/table`, review themes + 541, "Come for the lamb chops. Stay for the third cup of chai." bridge, Visit strip |
| `/table` | The configurator standalone and shareable (URL encodes the built table), totals, per-head, WhatsApp handoff, cake-format and accompaniment options |
| `/menu` | All 243 items, family → section → item, search, tags (spicy, vegetarian, kids, sharing), live availability, real photos, no fabricated descriptions |
| `/visit` | Hours of record 06:30–23:00 with the live clock, map link, phone/tap-to-call, WhatsApp booking request, private-event enquiry, "this is a concept — not Habibi's official site" disclosure |

### Design system

Tokens: espresso `#12100E`, gold `#CB9235`, cream `#F6EFE2`, bronze `#7C5920`, deep green
`#081511`, gold ramp `#FBF4E8 → #0A0702`. Display **Bricolage Grotesque**, text **Inter** (both
Google Fonts, open licence). 60/30/10 held on cream/espresso surfaces.

Measured contrast (computed here; re-verified by axe in CI):

| Pair | Ratio | Use |
|---|---|---|
| espresso on cream | 16.6:1 | body text ✓ |
| bronze on cream | 5.6:1 | accents/links ✓ |
| **gold on cream** | **2.4:1** | **text forbidden** — large display ≥24px bold and non-text decoration only |
| gold on espresso | 7.0:1 | ✓ (dark sections) |
| gold on deep green | 6.8:1 | ✓ |
| espresso on deep green | 1.0:1 | **forbidden combination** |

Amendment A1 adds a fact these tokens did not have: the restaurant's own badge, signage and neon are
**teal**, and the room is timber arches, green canopy, lanterns and teal banquettes (`brand/ASSETS.md`).
The approved set already carries a deep-green scheme, so the resolution proposed at M2 is gold kept as
the lantern/metal accent with teal taking the room and the evening end of the clock — a brand call
logged in `docs/OPEN-QUESTIONS.md` §2, not made silently here. Contrast pairs must be re-measured for
any teal that enters the token set.

## Performance and quality floors

- LCP ≤ **2.0s** on Slow-4G/Moto-class throttle, CLS ≤ 0.1, INP ≤ 200ms.
- First-load JS ≤ **400KB gz** with the door enabled; **≤ 60KB** gz when the gate routes to
  poster/2d. Initial payload ≤ 1.2MB including hero image (`astro:assets` AVIF/WebP + srcset).
- Nothing is ever a blank canvas with a spinner: the poster layer carries real content in HTML.
- 100% usable keyboard-only and screen-reader-only; the 3D table is an *enhancement* over a real
  form; `prefers-reduced-motion` respected; every dish reachable in the plain menu list.
- SEO: Restaurant + Menu JSON-LD from validated data, sitemap, per-route titles/descriptions,
  `X-Robots-Tag: noindex` while in private preview.

## Verification plan

| Layer | Check |
|---|---|
| Ingest | `probe-ingest.mjs` reports whether a headless read of menu.or.ke is possible; if not, M0 records the scripted-read fallback and the plan proceeds. Image refs HEAD-checked before mirroring. |
| Content | `build-content.mjs` fails the build if any item lacks family/section/price/photo-reference; count assertions: 243 items in, 243 out, 173 unique photos; `check-drift.mjs` exits non-zero on unreviewed upstream change |
| Unit | `lib/table.mjs` (party scaling, cake formats, totals, KSh formatting, WhatsApp URL escaping), `lib/hours.mjs` with TZ frozen to Africa/Nairobi at 06:29/06:30/22:59/23:00, taxonomy mapping for the two over-collected headings |
| E2E | _(planned, superseded by Amendment A6)_ Playwright at 1440×900, 1280×800, 390×844: configurator total updates, `/table` URL round-trips, menu search/filter, all four gate tiers forced (reduced-motion, WebGL blocked, save-data) each producing a working checkout |
| A11y/perf | _(planned, superseded by Amendment A6)_ axe-core 0 AA violations; Lighthouse CI against the budgets above; 30-frame measurement downgrade proven on a throttled profile |
| Preview | static build served by `astro preview` on 4322 and verified against it; a screen-recorded walkthrough plus a per-route screenshot pack |

### Amendment A6 — the E2E and a11y rows above were written before the no-downloading directive

The plan named Playwright, axe-core and Lighthouse CI. None of them are installed, and installing them is
against the standing instruction, so the row was a description of a system that does not exist. What
actually runs is `scripts/verify-runtime.mjs`: it launches the Chrome already on the machine, drives it
over the DevTools protocol with no packages at all, and fails the build on any console error, any broken
contract or any measurement that contradicts the claim being tested. It takes ~62 s and covers:

| Claim | How it is proven in a real browser | Last measured |
|---|---|---|
| No console errors anywhere | every route plus a deliberate 404, drained after each navigation | 12 route passes, 0 errors, 0 warnings |
| The door contributes pixels | screenshot with the canvas, screenshot without, compare | mean shifts, unique colours shift |
| The dial reaches the renderer, not just the CSS | `DoorScene` writes `data-rig-exposure` beside `renderer.toneMappingExposure`; the scene region is shot at 20:00 and 14:00 with the photograph hidden | exposure 1.127 → 0.979; cross-hour distance 42–44 vs same-hour, margin 1.97–2.99× over four consecutive runs |
| A weaker tier costs pixels, never content | `Emulation.setEmulatedMedia` asks for reduced motion | tier `poster`, reason `prefers-reduced-motion`, 0 canvases, still painted, 0 reveals stuck; /menu 243/243 dishes in 6 groups |
| A saved table survives the phone being put down | add through the real button, reload the route, re-read | 0 → 1 row, `habibi-haven:table:v1` written, restored 1 row / KSh 2,300 / 1 marked button |
| The pointer magnet works and lets go | synthesised `pointermove` on `[data-magnetic]`, then `pointerleave` | offset 16.83 px, released to "" |
| No JavaScript still books a table | scripts removed before load | hero photograph painted by CSS, working `wa.me` href |

Not proven, and not claimed: axe-core AA (no accessibility engine is installed — the harness checks
`aria-hidden`, roles, labels and focus-visible structurally instead), Lighthouse budgets, and the `2d`
tier in a browser (would need `--disable-webgl`; it is unit-tested only). The margin on the hour test is
deliberately shown because it is only ~2× the lamp-breathing noise, and a gate that hides its own headroom
is not evidence.

### Amendment A7 — the door was painting from its fallbacks at every hour, and the art pass that followed

Found by measurement, not by looking. `--probe` was added to `scripts/verify-runtime.mjs` (prints the 8×8
luminance grid for both hours and the palette the scene read) and it showed the palette arriving as
`"color-mix(in oklab, #ffffff, #0b2621 calc(0.097 * 100%))"`. A custom property's computed value is its
declared text with `var()` substituted and nothing else evaluated, so `readPalette`'s rgb/hex parser matched
nothing and every surface token fell through to `FALLBACK` — the midnight values. The rig's intensities, fog
and exposure moved with the clock while the colours did not, which is why noon looked like a dark room with a
blown-out arch rather than daylight. `scenes/rig.js` now completes the substitution the only way that cannot
disagree with the stylesheet: it writes the expression to an off-layout probe element as a `color` and reads
the engine's answer back. That answer is `oklab(0.92685 -0.00328372 0.0000595812)` — Chrome keeps a
`color-mix(in oklab, …)` in Oklab — so the file gained an Oklab→linear-sRGB→sRGB conversion (Ottosson's
matrices, sign carried through the transfer curve so out-of-gamut channels clamp rather than shift hue). Four
tokens the scene had been inventing (`--ivory`, `--brass`, `--brass-soft`, `--lamp-glow`) are now declared in
`tokens.css` as the door's materials and lamps, deliberately not interpolated by `--night`: a lamp's colour
does not change with the hour, only how much of it reaches you. A token that is missing or unresolvable now
warns once in the console instead of silently using a fallback, and the harness counts warnings, so the class
of bug cannot return unnoticed.

What the corrected palette then exposed, and what the same two frames were used to fix:

| Defect | Cause | Fix |
|---|---|---|
| Courtyard read as a black hole with a bright garden inside it | seven free-standing arch slabs 3.6 m wide, nothing at `\|x\| > 1.8` and nothing above the lintel, so the canvas was transparent there and the fallback photograph showed through | two plaster side walls from the street wall to the end wall, and the bay slabs carried up to `WALL_TOP`; the arcade is a wall with holes in it again |
| A black diagonal bar crossing the arch | brass at `metalness: 0.85` with no environment map — a metal with nothing to reflect gives up its diffuse term and draws unlit | `metalness: 0.3, roughness: 0.5`, plus a small warm emissive that rises with the lamps |
| Noon façade clipping to a flat field | daylight key 0.95 on a near-white albedo left ACES nothing to compress | key 0.95 → 0.78, sky 0.40 → 0.34, bounce 0.58 → 0.50, and the stone/plaster albedo pulled toward real limestone by `0.5 × (1 − night)` |
| Interior too dark at dusk, too flat at noon | no light reached past the second arch and directional lights cannot be occluded | `rigValues.interiorFill` drives a low warm emissive on the stone — a bounce approximation, one uniform, no new light term, works on the lite tier |
| Nav invisible over the hero at day and dusk | `.nav` sits outside `.hero`, so it inherited the page's day ink (`--mist` resolves to `--ink` at `--night: 0`) over a scene that is a night picture in either scheme | `Base.astro` passes `overHero` on the home route, the bar pins the hero's own contrast pair, carries a short top scrim until `[data-stuck]` frosts it, and the frost uses the night ink rather than paper |

Re-measured on the shipped build: 12 route passes, 0 console errors, 0 warnings; exposure 1.127 → 0.979
between 20:00 and 14:00; cross-hour distance against the four-frame-per-hour noise floor gives a margin of
1.68×, above the 1.5× floor but thinner than A6 recorded. That is partly real — the enclosed corridor is now
lit at both hours — and partly the statistic, which compares luminance only, while the visible difference
between those two frames is mostly colour temperature. The margin stays printed rather than tuned upward.

### Amendment A8 — M6: the site was measured with a keyboard and a stopwatch, and four defects came out of it

The gates before this one read the built HTML and the pixels. Neither of them could answer the two questions
that decide whether the site is usable: whether the whole thing can be operated without a mouse, and what it
costs per frame on the machine doing the running. `scripts/verify-runtime.mjs` gained both — real `Tab`
presses through `Input.dispatchKeyEvent` (not an audit of `href` and `aria-label`), the `/` and `Escape`
shortcuts the menu page promises in its own copy, `Enter` on the party stepper, and a `requestAnimationFrame`
wrapper installed at document start that reports frames, callbacks-per-frame, and p50/p95/worst frame times per
window. 92 Tab stops across four routes, and every route passes with `unnamed 0 · blind 0 · ghosts 0 ·
sinks 0 · positives 0`: no control whose accessible name is empty, no stop with no visible indicator, none with
no box, none invisible, and no `tabindex` above 0 anywhere in the source.

What the measurement found, in the order it was fixed:

| Defect | Evidence | Cause | Fix |
|---|---|---|---|
| 13 focus stops had no focus indicator (9 on `/menu`, 4 on `/table`) | `blind: 9` / `blind: 4` with the stops named in the output | `global.css:1041` `.field input { outline: 0 }` — specificity 0,1,1 — beat `:focus-visible { outline: 2px }` at 0,1,0, so the search box, the date field and the time select were invisible to the keyboard | `.field:focus-within` paints the ring on the field wrapper, and `.field input:focus-visible { outline: 0 }` says out loud that the suppression is deliberate and which element answers instead |
| The door painted a room nobody could see | 6 frames recorded after `scrollTo(55%)` put it 5,061 px above the viewport | `DoorScene` stopped the loop for `document.hidden` and nothing else | an `IntersectionObserver` with a 120 px margin drives `inView`; the same `onVisibility` decision now covers both reasons to stop. Re-measured: 3 frames while on screen, 0 while off |
| The cursor never stopped running | 2 rAF callbacks per frame *forever* after a single mouse move | `draw()` re-requested unconditionally, and the ring is an exponential lag — it never arrives, so the numbers repeat long before the loop notices | `draw()` stops when \|pointer − ring\| < 0.05 px (the point where the next step moves less than a device pixel). Re-arm keys off `!raf`, and `blur` zeroes the id after cancelling — without that line the same fix bricks the cursor on the next tab switch |
| A downgrade nobody could see | probe said nothing; the page claimed `tier: "full"` while drawing the lite room | `downgradeToLite()` rebuilt the geometry and left `data-tier` at the gate's page-load answer | the probe now writes `data-tier="lite"`, `data-tier-reason="measured frame time"` and `data-probe-ms` beside the rebuild. Measured on this machine: 532.9 ms average over 30 frames → lite → 267 ms per frame afterwards, against 533 ms before |

Three more were defects of the measurement rather than the site, and are recorded because they are the traps
in this kind of harness. `Enter` did not activate a focused button from `rawKeyDown` alone — Chrome's default
activation needs the `char` event, so `press()` sends it. `getComputedStyle(child).display` is not `"none"`
inside a `display: none` ancestor, so the first "invisible focusable" audit was fiction until it switched to
`Element.checkVisibility`; and the second version's 9 remaining "sinks" were the *fade-up reveal working as
designed* — `/menu` holds 129 controls at opacity 0 whose reveal has not been observed yet, which is a keyboard
guest two seconds away from a real button, not a bug. The classifier now treats an element as stuck only when
nothing is governing its reveal or its reveal ancestor is on screen and no animation is running, and separately
proves the pending population by focusing one control and reading the result: `/` landed at `revealed: true ·
opacity 1 · inViewport: true · ring: true`. The wait for that is a poll, not a snapshot, because
`html { scroll-behavior: smooth }` means the browser's focus-follows scroll is an animation and a 950 ms
photograph caught the control mid-flight — the first version of that check failed a page that was correct.

Absolute frame numbers are not portable and are not claimed as such. The renderer here is
`ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)), SwiftShader driver)` at 1403×940, dpr 1, tier
`full` for `desktop-class` — a CPU rasteriser, so ~3 fps is a property of the harness's browser, not of the
site or of a phone. What the gate asserts is the *shape* of the loop: it runs while the door is on screen, it
stops when the door leaves, no loop exists on a page without a door, one frame only under reduced motion, and
after a parked pointer the only loop left is the door's (`idle.maxPerFrame 1 → chasing 2 → settled 1`, the
ring having stopped writing at 17.7 s of chasing on this hardware, ~1 s on a GPU). `maxPerFrame > 3` is what
fails as "a loop nobody wrote", because three legitimate consumers exist at page start: `DoorScene.step`,
`Preloader.tick` and `Cursor.draw`.

`evaluate()` bodies in this file are statement blocks, not expressions: the helper wraps them in an async
function, so a body written as `matchMedia(q).matches` returns `undefined` — which read as "(pointer: fine) is
false" and nearly shipped a false claim about the test environment in a comment. The harness carries a
document-start override that forces that query true only when the browser does not, so the desktop cursor path
cannot go untested either way, and the override's status is printed in the result line rather than assumed.

Gate state at the end of M6: `npm run check` 67/67, `check-drift` clean, `verify-dist` ok (5 pages, 301 local
references, 5 routes, contracts + a11y + weight), `check-board` 176 strings, `verify-runtime` exit 0 with 12
route passes and 0 console errors. JS is 890 kB across 10 chunks with `three` lazy at 673 kB, i.e. never in the
entry graph.

### Amendment A10 — the hosted URLs disagreed with the linked URLs, and the first fix did not work

The site went live on Cloudflare Pages at `habibihavenpreview.pages.dev` from the runner's `dist`
artifact (380 files, direct upload, nothing compiled on the laptop). Measured immediately after:

| request | result |
| --- | --- |
| `/` | 200 |
| `/menu`, `/table`, `/visit` | **308 to the trailing-slash form**, then 200 |
| `/menu?party=4` | 308 preserving the query |
| `/nope` | 404 with the styled page |
| served `/menu/` HTML | canonical `…/menu`, `noindex, nofollow`, `@type Restaurant`, KES offers |

Pages answers a slash-free path that names a **directory** by permanently redirecting to the slashed
form, and this build emitted `menu/index.html`, so every nav link took a hop and the address bar ended
up on a different URL than the canonical tag in its own `<head>`.

**The attempt that failed, recorded because it is the tempting one.** A `site/public/_redirects` file
with `/menu /menu/index.html 200` for each route. It built, it uploaded — the deploy log said
"Uploading _redirects" — and `/menu` still returned 308. The rule shape is the one the platform
documents for relative 200 proxying, so either Pages settles the directory case before it reads the
file or the rule is ignored for a source that also names a directory; the measurement does not
distinguish the two, and it does not need to. The file and its gate are gone.

**What actually works:** `build.format: "file"` — routes are emitted as `menu.html` rather than
`menu/index.html`, so there is no directory for the host to redirect to. `/menu` is 200, the canonical
and the address bar agree, and nothing about the source links had to change because they were always
slash-free strings. `scripts/verify-dist.mjs` gained a **route shape** gate that fails if a route comes
back nested, and its reference-resolution check now counts `<path>.html` as a hit for `/path`, which is
what the host does — the first flat build failed CI on exactly that, three "broken references" for the
routes themselves.

### Milestones

1. **M0 — probes** (headless ingest, image reachability, toolchain availability). No UI.
2. **M1 — content spine**: ingest → taxonomy → `menu.json` → mirrored photos → drift report.
3. **M2 — the fast interior**: tokens, Menu, Visit, Home copy sections. Fully usable, zero WebGL.
4. **M3 — the door**: scene, rig, gate, poster/2D fallback.
5. **M4 — the table**: math, 3D ↔ DOM shared state, shareable URL, WhatsApp payload.
6. **M5 — the clock**: hour variable driving palette and scene, live open/closed.
7. **M6 — hardening**: a11y, perf budgets, drift check wired, preview deploy, OPEN-QUESTIONS.

## Risks / must-not-say

- Hours and the Uber Eats status are contradictory upstream facts; we publish one value of record
  and log the rest rather than smoothing it over.
- Descriptions exist for only 107 of 243 items. The other 136 stay photo-led and description-free;
  inventing ingredient copy is out of bounds.
- Photos are hosted in their Supabase bucket and returned 401/403 to REST probes from outside the
  browser. Mirroring into the build is intended, but permission to redistribute is an OPEN-QUESTION
  for the client call; the preview must not be published as official before that.
- ~~No venue photography exists, so nothing in the site may read as a photograph of the room.~~
  Superseded by Amendment A1: real venue photography exists but is mostly 300×225, so it is used at
  card size and never stretched into a hero. Nothing may look like a photograph of the room unless it
  *is* one of their files.
- Photo rights and the vector logo are unconfirmed (`docs/OPEN-QUESTIONS.md` §1). The assets are used
  in a private preview only.
- Relume decoupling is absolute: the capture has been deleted, its wording survives in
  `research/COPY-BANK.md` and its images in `brand/` — both cited as provenance in docs. No Relume
  runtime, markup, component id or CDN URL appears anywhere in the build.

## Architecture preview image — method and exact content

One landscape board, vector-drawn from the tables in this file and rasterised to PNG
(`docs/architecture/board.png`). **Deterministic, not AI-rendered**, because an image model will
silently invent or mangle a price, a route name or a hex code — which is precisely what was ruled
out. Every string below is copied from this plan; nothing else may appear.

Five panels, left to right:

1. **The spine** — five numbered nodes "Arriving → Sitting → Ordering → Staying → Coming back"
   under the label "Set your table", with the four route paths `/`, `/table`, `/menu`, `/visit`.
2. **The layer stack** — boxes in order: `menu.or.ke (system of record)` → `ingest.mjs` →
   `menu.source.json` + `drift.md` → `taxonomy.json` / `menu.overrides.json` →
   `build-content.mjs` → `src/data/menu.json (243 items · 173 photos)` → `Astro static build` →
   four route boxes; a second input feeding the build: `brand/ (logo + 12 real photos)` and
   `research/COPY-BANK.md`; a side stack on the runtime column: `gate.mjs` →
   `DoorScene (three, lazy)` / `2D fallback` → `table.mjs` → `wa.me/254116880000`.
3. **The door, as wireframe** — an orthographic top-down schematic of a long table with six place
   markers, each annotated only with real menu strings: `Full Mandy KSh 2,300`, `Sinia KSh 6,000`,
   `Lamb Chops KSh 1,350`, `Chicken Biryani KSh 1,300`, `Karak Chai KSh 350`,
   `White Forest Cake 2KG`; party chips `2 · 4 · 6 · 8`; a slider labelled `06:30 ——— 23:00`;
   a small tier strip `full · lite · 2d · poster`.
4. **Design tokens** — five swatches with hex and measured contrast pairs exactly as tabulated
   above, including the two forbidden pairs flagged in red hatch: `gold on cream 2.4:1`,
   `espresso on deep green 1.0:1`; font names Bricolage Grotesque / Inter; plus the Amendment A1
   note `real badge + signage read teal — re-measure before M2`.
5. **The budget and the proof** — numbers only: `LCP ≤ 2.0s`, `CLS ≤ 0.1`, `INP ≤ 200ms`,
   `JS ≤ 400KB (door) / ≤ 60KB (no door)`, `243 items · KSh 100–6,000 · median 550`,
   `4.5★ · 541 reviews`, `06:30–23:00`, milestones `M0…M6`.

**Board chrome** — the strings outside the five panels, held to the same rule:

- masthead `HABIBI HAVEN — ARCHITECTURE BOARD`; sub-line `Set your table · immersive door, fast
  interior · Astro + islands + Three.js · static output · private preview · every string copied from
  the approved plan` (the concept label plus decision rows 1, 8 and 10)
- panel cards numbered `01`–`05`; the five spine nodes repeat that numbering and the six door place
  markers `1`–`6` index the six dish strings in the order panel 3 lists them
- deferred seams under panel 1, from decision 6 ("clean seams for Events/Gallery"):
  `/events — Sinia feast, private dining` and `/gallery — 12 real photos, card size`
- footer `Sources verified 2026-11-14: Google Maps · menu.or.ke · Uber Eats · Instagram · Facebook ·
  the abandoned project, distilled and deleted`; provenance line `Deterministic board drawn from the
  approved plan — no invented dish, price, feature, award or venue photograph. Relume connection:
  cut.`; sign-off `HABIBI HAVEN · SET YOUR TABLE`

**Enforcing the rule mechanically** — two scripts rather than a promise.
`scripts/fit-board.mjs` measures every label against its panel edge in a real browser and pins the
overflowing ones with `textLength`, so rewording is never the fix for a tight card.
`scripts/check-board.mjs` extracts every visible string from `board.svg` and fails unless every
number, hex colour, file name and route it contains also appears in this plan.

**Forbidden in the image:** any number, dish, price, route, tool or claim not present in this
plan; any photorealistic interior or "render of the finished site"; awards or client logos; the
words "official" or "live" (that ban is on claiming the site is Habibi's own live property — the
plan's own feature wording, "live KSh total" and "live open/closed", is allowed); any Relume mark or asset; invented features (online payment, loyalty,
accounts, AI anything); any venue photograph.

After generating it I will read the PNG back and diff every visible label against this section by
hand, and re-roll if a single string drifted.

## Critical files

Read before building: `research/BRAND-FACTS.md`, `research/COPY-BANK.md`, `brand/ASSETS.md`,
`research/menu-structured.json`, `research/uber-eats-raw.txt`, `research/identity-raw.json`,
`docs/OPEN-QUESTIONS.md`. The Relume capture these once pointed at is deleted.
Create (highest-risk first): `scripts/probe-ingest.mjs`, `scripts/ingest.mjs`,
`content/taxonomy.json`, `site/src/content-schema.mjs`, `scripts/build-content.mjs`,
`site/src/lib/table.mjs`, `site/src/lib/gate.mjs`, `site/src/lib/hours.mjs`,
`site/src/scenes/haven.js`, `site/src/scenes/rig.js`, `site/astro.config.mjs`,
`site/src/pages/*.astro`, `docs/OPEN-QUESTIONS.md`.
