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
| 9 | Booking | ~~WhatsApp handoff, static — no backend~~ **(superseded after approval — see Amendment A12: Worker + D1 order records with server-computed totals; the WhatsApp handoff stays as the no-JS path, and payments remain dark until credentials exist)** |
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
    build-content.mjs           # source + overrides + taxonomy -> src/data/menu.json (validated),
                                #  and the server's own catalog: backend/catalog.json + seed.sql (A12)
    mirror-images.mjs           # download referenced photos -> src/assets/menu/
    check-drift.mjs             # re-run ingest, report, exit non-zero on unreviewed change
  backend/                      # the server-side half (Amendment A12) — deployed with `wrangler deploy`
    wrangler.toml               # Worker name + D1 binding; secrets never live here
    migrations/20261116_0001_init.sql   # the schema, and the only copy of it
    catalog.json  seed.sql      # build outputs, committed like menu.json (243 prices + hours of record)
    src/index.mjs               # 5 routes: health, record, read receipt, pay, Daraja callback
    src/validate.mjs            # what a request may contain; no I/O, no ambient clock
    src/store.mjs               # every SQL sentence the server says, prepared and bound
    src/mpesa.mjs               # STK push + callback verification — written, and dark
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
    run.mjs                     # the site's unit gates: table math, hours sweep, taxonomy (A6 posture)
    api.mjs                     # backend gate: the real migration + seed on real SQLite, the real handler,
                                #  a fake Daraja for the money path (A12)
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
   │                        └► mirror-images.mjs → src/assets/menu/
   └───────────────────────► backend/catalog.json + seed.sql  (the SAME prices, for the server)
   ▼
Static build: Home · Table · Menu · Visit  (+ JSON-LD, sitemap, noindex on preview)
   ▼
Capability gate at runtime ──► 3D door OR 2D table  (identical data, identical price math)
   ▼
"Send this table" ──► POST /v1/requests (backend/) ──► server reprices from its own catalog,
   │                  stores the record, hands back a reference  ┐  (Amendment A12)
   │                  and the confirmation says, from the server, │
   │                  that no money is being taken yet            ┘
   └──────────────► wa.me/254116880000?text=<same table>   ← the no-JS path, and the fallback
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
| Backend | `tests/api.mjs` executes the real migration and the real build-generated seed on `node:sqlite` (foreign keys on, as D1 has them), drives the Worker's `fetch` with real `Request`s, sweeps all 1440 minutes against the site's own `hours.mjs`, and runs the whole Daraja path against a fake Safaricom. Then `wrangler d1 execute --local` + `wrangler dev --local` proves the same in workerd. What neither proves: the remote binding, and Safaricom. (A12) |
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
`menu/index.html`, so there is no directory for the host to redirect to. Nothing about the source links
had to change, because they were always slash-free strings. `scripts/verify-dist.mjs` gained a **route
shape** gate that fails if a route comes back nested, and its reference-resolution check now counts
`<path>.html` as a hit for `/path`, which is what the host does — the first flat build failed CI on
exactly that, three "broken references" for the routes themselves.

Re-measured on the live host after that build went up, and the re-measurement found a second defect that
the fix itself had created:

| request | result |
| --- | --- |
| `/`, `/menu`, `/table`, `/visit` | 200, no `Location` header |
| `/menu?party=4` | 200 — the query that used to cost a hop |
| `/menu/`, `/table/`, `/visit/` | **308 to the slash-free form**, i.e. converging on the canonical |
| `/menu/…jpg` (a dish photo) | 200 — `menu/` as a photo folder still resolves |
| `/menu.html` | 308 → `/menu` — the extension form is not a second copy of the page |
| `/nope` | 404 with the styled page |
| served `/menu` HTML | `noindex, nofollow`, `@type Restaurant`, Koinange Street, `openingHoursSpecification`, `tel:+254116880000`, Maps links, numeric KES prices |

The routing half was clean. The head half was not: the canonical on all four flat routes read
`https://habibihavenpreview.pages.dev/menu.html`. The cause is in the fix, not in the host — during a
static build `Astro.url.pathname` is the path of the file being written, so `format: "file"` hands the
template `/menu.html` where the directory build had handed it `/menu`. A canonical naming the extension
form asks a crawler to index the address whose only job is to redirect, and the address a person sees is
the one without it. `Base.astro` now strips the extension (and an `/index.html`) before building the
canonical and `og:url`.

**Why this one got through a green pipeline:** the artifact audit checked the origin for staleness — no
`netlify.app`, no `.example` — but never compared a page's canonical to the route it was built from, so
a canonical with a correct host and a wrong tail was passing. `verify-dist.mjs` now has a **canonical**
gate that asserts, per route, that both `rel=canonical` and `og:url` equal `SITE_URL + route` exactly,
and it is written against the origin spelled out in the script rather than read from `astro.config.mjs`,
so it cannot simply agree with whatever the build believed.

### Amendment A11 — the pages started swapping instead of loading, and the rig had to be told the document never changed

Approved as "yes, verify narrow": `<ClientRouter />` in `Base.astro` (line 110), so a nav click fetches the
next route and swaps its `<body>` rather than paying for a cold load — the single change that makes the
site feel like one continuous space during the pitch. Everything else about routing stayed
server-authoritative: the same flat files, the same 200s, the same canonicals, and a direct link or a
dead script still gets a complete page.

A swap is not a load, and five things the site had been doing once per document quietly became bugs:

**The `js` class disappears.** `swapRootAttributes` removes every attribute from the live `<html>` and
copies the incoming one's, so the class the inline head script adds is gone the moment the swap lands —
and because that inline script is keyed by its own text inside Astro's swap function, it is marked as
already run and never adds it again. Every `[data-reveal]` and `.kin` on the incoming page would then sit
in its no-JavaScript state. **The hour disappears with it**: `--hour` and `--night` live on the root
element, written by `lib/rig-client.mjs`, and a visitor who dialled 3 a.m. on the home page would walk
into a midday menu. `reassert()` (`Base.astro:256`) puts both back, bound to `astro:after-swap` — the
earliest instant the incoming document exists, which matters because the router awaits its script imports
*after* the swap, so a component painting in that window would show the unstyled page and snap back a beat
later. It also runs from `onPage`, which is what keeps the same code correct on a first arrival and with
the router switched off. It repaints only when the root disagrees with what the visitor dialled, because
the two callers mean it runs twice per navigation and `applyHour` broadcasts to the door and both dials.

Three behaviours were read out of the installed package rather than assumed (`site/node_modules/astro/dist/transitions/`):
`triggerEvent` dispatches on **`document`** (`router.js:17`), so a listener bound to the Document survives
every swap; `after-swap` fires inside `updateDOM` (`router.js:216`) and `page-load` fires after the script
imports resolve (`router.js:354-358`), so the order the two names above depend on is guaranteed; and when
`document.startViewTransition` is missing Astro builds a shim (`router.js:327`) that still drives
`runScripts → page-load → announce` — the island lifecycle is not hostage to View Transition support, which
is the difference between a working demo and a blank one on an older iPhone at the table.

**The fade was not ours.** Enabling the router turns on View Transitions, and Astro ships a cross-fade
whose default UA timing is slower than this site's motion budget. `global.css:1850-1863` pins
`::view-transition-{old,new,group}(root)` to 180 ms and cancels it outright under
`prefers-reduced-motion: reduce`. The harness counts the authored rules rather than trusting the intent:
`vtRules = { total: 2, medias: [null, "(prefers-reduced-motion: reduce)"], inMedia: 1 }`.

**An interrupted swap rejected, and this is the part no markup review could find.** Run 43808133369 failed
the runtime battery with `uncaught: AbortError: Transition was skipped. skipTransition() called` on the
clicked sequence `/ ⇄ /menu ⇄ /table`, on a commit whose only repository change was `backend/` — the defect
was older than the failure, and the harness's click cadence had simply never landed inside the 180 ms window
before. The cause is upstream and specific: when a second navigation starts, `router.js:310` calls
`skipTransition()` on the running transition and `router.js:359` attaches `.finally()` to its `finished`
promise. Chrome rejects that promise on skip, `.finally()` forwards the rejection to a derived promise nobody
awaits, and the browser reports an unhandled rejection. Nothing about the swap itself is wrong — the probe
below shows the incoming document installed, the update callback resolved and the guest arriving where they
tapped. Impatience is a normal gesture on a phone in a courtyard, so the site tolerates it:
`site/src/lib/transition-guard.mjs` cancels the `unhandledrejection` event for that one rejection, matched on
both `name === "AbortError"` and the message `Transition was skipped`, and for nothing else.

The mechanism was chosen by experiment rather than by taste, and the intuitive fix lost. Attaching our own
`catch` at the source was tested three ways in real Chrome (`.tmp/vt-repro.mjs`, three pages, CDP
`Runtime.exceptionThrown` counted after each): a handler on the *original* `finished` still reports, because
it is Astro's derived promise that goes unhandled; shadowing the property with an already-handled promise via
`Object.defineProperty` on a `Document.prototype.startViewTransition` wrapper still reports; only
`preventDefault()` on `unhandledrejection` produced zero exceptions — and the page still ended with
`swapped: "1"`, `done: true`, so nothing was swept under the rug that the battery had not already measured.
`tests/run.mjs` pins the predicate in both directions, including the *other* `AbortError` this site can
produce (a superseded `fetch`, message "The user aborted a request."), which must survive to the console.
The gate itself was not loosened: `verify-runtime.mjs` still fails on any uncaught exception.

Measured on the runner (headless Chrome, `verify-runtime`, run 43760830456). Four clicked navigations plus
one reduced-motion navigation, each counted with handlers that attach once per step and detach after the
settle window:

| step | swapped | loaded | announcer elements | `--hour` after | other evidence |
| --- | --- | --- | --- | --- | --- |
| `/ → /menu` | 1 | 1 | 1 | "3" | menu search, reset and category chips usable |
| `/menu → /table` | 1 | 1 | 1 | "3" | party steppers usable |
| `/table → /` | 1 | 1 | 1 | "3" | 1 door canvas, `live: true`, curtain settled |
| back, then forward | 1 | 1 | 1 | "3" both ways | landed `/table` → `/`, `mark: "router"` |
| `/ → /menu` (reduced motion) | 1 | 1 | 1 | — | `animation: none` path taken |

`window.__hhMark` — set before the first click — was still readable after all five swaps, which is the
cheap proof that the JS world persisted and nothing silently fell back to a full load. The route announcer
matched `<title>` on every step (`announced === title`); `announce()` (`router.js:19-33`) creates a fresh
`div.astro-route-announcer` each time, and because the body swap `replaceWith`s the old one there is
exactly one, never a stack of stale announcements.

**Four errors in my own harness, all disclosed rather than quietly patched.** Passing `drain()`'s
`{errors, warnings}` object straight into a report row crashed the reporter on a green battery
(`TypeError: r.errors is not iterable`). A `cameForward` assertion read a `mark` field the step never
returned, so a *correct* back/forward pair was reported as "the router does not handle popstate" while
every number beside it passed. Counters bound with `{ once: true }` could only ever read 0 or 1, making a
duplicate sweep unfalsifiable — hence the named handlers above. And twice, a backtick inside a comment
inside a template literal truncated the literal, which `node --check` caught locally before the runner did.

**The no-JavaScript claim in the harness had been measuring the wrong thing.** The old `/ (scripts
removed)` row deleted `<script>` tags from a page that had already loaded, so `html.js` was set, the
observer was gone, and `[data-reveal]` sat at `opacity: 0` — it measured a bundle dying mid-session, not a
browser without JavaScript, and it counted cards by `offsetParent !== null`, which is true at opacity 0.
The row is kept and relabelled (that *is* a real failure mode: a chunk 404ing on a flaky hotel Wi-Fi), and a
genuine probe was added: `Emulation.setScriptExecutionDisabled` before the load, with the styles read
through the CDP DOM and CSS domains instead of `page.evaluate`, which is reported unreliable under that
flag. Run 43761717485:

| route | `html.js` on root | reveal nodes | sampled `opacity` | probe error |
| --- | --- | --- | --- | --- |
| `/` | 0 | 10 | 1, 1, 1 | none |
| `/menu` | 0 | 243 | 1, 1, 1 | none |

A browser that cannot run scripts never gets the class, so the CSS never hides anything: 253 content
regions across the two heaviest routes, all visible. The probe reports `probeError` as a failure worded
"unmeasured, not confirmed", so a tooling gap cannot masquerade as a pass.

The same run exposed that the verdict line promised more than the code enforced — it printed "no console
errors on any route" while per-row errors were only echoed. Rows are now gated (`loudRows`), so a route
that logs cannot also be called clean.

Live after upload (381 files from the runner's artifact, direct upload, nothing compiled on the laptop):
production `habibihavenpreview.pages.dev` is byte-identical to the deployment preview (same SHA-1 of
served `/`), `/`, `/menu`, `/table`, `/visit` all 200, `/menu.html` 308 → `/menu`, `/nope` 404 with the
styled page, `_astro/ClientRouter.astro_…js` plus `astro-view-transitions-enabled` and `-fallback` in the
head, the `Restaurant` / `Menu` / `MenuItem` / `Offer` / `OpeningHoursSpecification` / `PostalAddress` /
`AggregateRating` graph intact, `tel:+254116880000`, and `noindex, nofollow` still on every route.

*(Numbering note: there is no A9 — the sequence skipped it, and the gap is left rather than back-filled so
the amendment order keeps matching the commit order.)*

### Amendment A12 — decision 9 was reversed on purpose: the site now has a server-side half, and it is honest about what it cannot do

Approved change, from the user: *"Build Worker + D1 order records, payments dark."* Decision 9 ("WhatsApp
handoff, static — no backend") was written when the only thing a server could add was risk. The brief's
fourth framework group asks for more than that — server-side keys, server-computed totals, stored order
records, and Daraja STK push with callback verification — and a total the browser calculated is a total the
browser chose. So `backend/` exists: one Cloudflare Worker, one D1 database, five routes.

Why a Worker beside Pages instead of Pages Functions inside it: the deploy is a direct upload of a
runner-built `dist`, and Functions then have to be discovered from a `functions/` folder next to the
command's working directory, with bindings in a config the deploy also has to be told about — three pieces
of wiring each able to fail silently, and a silently missing function is a "Book a table" button that does
nothing. A Worker of its own is one `wrangler deploy` with a `/health` route that answers whether any of it
is wired. Same product the brief named.

What "payments dark" means precisely: no Daraja credential exists on the deployment, so `paymentStatus()`
reports `payments_not_configured` with the six missing secret names, both money routes answer 503, and —
the part that matters for the pitch — the *confirmation the guest reads* takes its `payments.available:
false` from the server's answer rather than from page copy. Switching money on is a credentials task, not
an edit to a sentence. The STK-push builder, the timestamp rule, the four callback checks and the audit
writes are real code, run for real against a fake Safaricom, and have never touched Safaricom.

Two defects that only executing the thing could find:

1. **A valid reference that 400s on the guest's own receipt link.** `makeReference` draws from a
   26-character alphabet; the router's pattern had been written out by hand as `[2-9A-HJ-KM-NP-RT-Z]`, which
   silently omits `S`. A guest handed `HH-J7GSQ5` would have been told their reference "looks like
   HH-4KQ7MR" by the endpoint that is supposed to show it. Fixed by deleting the hand-typed class: the
   router now builds its regex from the alphabet the generator exports, so the two cannot disagree by an
   edit. The gate for it writes 26 records — one per character — and reads each back through the real
   handler.
2. **A `wrangler.toml` that would not deploy.** The `[migrations]` table I had written is the Worker-version
   migration bindings, not D1's; D1 wants `migrations_dir` inside the binding. `wrangler deploy --dry-run`
   said so in one line ("should be an array, got {folder:migrations}") — before anything was uploaded. The
   same check removed `nodejs_compat`, which was there on a comment's say-so while `src/` imports no `node:`
   specifier at all.

Proof, in the order it was obtained: `node tests/api.mjs` — **87 assertions, 0 failures** — which executes
`backend/migrations/20261116_0001_init.sql` and the build's own `backend/seed.sql` through `node:sqlite`
with `PRAGMA foreign_keys = ON`, behind an adapter modelling only the D1 methods the code uses, then calls
the Worker's `fetch` export with real `Request`s. Then `wrangler d1 execute --local` (migration, then seed:
243 prices) and `wrangler dev --local` — the Worker in workerd, not in Node — probed over HTTP: `/health`
200 with `items=243, payments.mode=off`; a built table 201 with the server's own `total=3100`, drift
`{claimed 2001 → delta 1099}` reported rather than hidden, and `payments.available=false`; the lowercase
receipt 200 with no `contact_name` in it; a 19:00 reservation 201 stamped `2026-11-22T16:00:00.000Z` and a
03:00 one 422 `outside_hours`; both money routes 503 with 6 secrets named; `GET /v1/requests` 405 (there is
no list endpoint, and saying so is truer than 404); an unknown reference 404; an evil origin getting no
`Access-Control-Allow-Origin`; and the same phone twice answered 201 then 429 with `retry_after_seconds=20`.

Proven since, against the deployment rather than a laptop: `wrangler d1 create habibi-haven-preview` →
`2d3577ad-9691-489a-b4f1-a24e2cf4ac1f`, which replaced the placeholder in `backend/wrangler.toml`; migration
(9 commands) and seed (492 rows across 6 tables) applied remotely; `wrangler deploy` →
`https://habibi-haven-api.adanjemeshack.workers.dev`, version `8d7f2a7d-1696-407d-961b-c13f41208fbc`, with the
`DB` binding resolved. The probe re-run against that host read `/health` 200 with `items=243` and
`hoursOfRecord {06:30, 23:00}` coming out of remote D1, a built table 201 as `HH-AMQZN5` with server total
3100 against a claimed 2001, the lowercase receipt 200 `status:"recorded"`,
`POST /v1/requests/HH-AMQZN5/payments` 503 naming the same 6 secrets, a 03:00 reservation 422 `outside_hours`,
`GET /v1/requests` 405, an unknown reference 404, the Pages origin echoed in `Access-Control-Allow-Origin`
where an evil origin got no header at all, and `cache-control: no-store` on every response.

Two errors in the first probe, both mine, both closed by re-running rather than by reasoning about it: it
posted `/v1/requests/{ref}/payment` and read the 404 as a missing route when the route is plural
(`/payments`), and it put an outside-hours instant in the free-text `when` field — which the server keeps as a
label and is right not to police — instead of the machine-checkable `visitDate`/`visitTime` pair, so a correct
201 looked like a hole in the hours rule. The hours rule was enforced on both kinds all along
(`backend/src/validate.mjs:282-315`); it took the second probe to demonstrate it.

And a wrong premise, said plainly because a decision was collected on it. `wrangler deploy` first refused with
"you need to register a workers.dev subdomain", which read as a missing namespace and was put to the user as
one. The actual cause was the placeholder `database_id`: the account already had `adanjemeshack.workers.dev`,
nothing was registered or needed registering, and filling in the real id made the deploy succeed on the first
attempt. No resource was created on the strength of that question.

Not proven, and not claimed: that any of the payment path works against Safaricom — deferred by the user ("the
Daraja we will have to skip it until communicate with them"), so the credentials stay absent and both money
routes answer 503 by construction — and that the site's forms talk to this API yet, which is the next
milestone.

### Milestones

1. **M0 — probes** (headless ingest, image reachability, toolchain availability). No UI.
2. **M1 — content spine**: ingest → taxonomy → `menu.json` → mirrored photos → drift report.
3. **M2 — the fast interior**: tokens, Menu, Visit, Home copy sections. Fully usable, zero WebGL.
4. **M3 — the door**: scene, rig, gate, poster/2D fallback.
5. **M4 — the table**: math, 3D ↔ DOM shared state, shareable URL, WhatsApp payload.
6. **M5 — the clock**: hour variable driving palette and scene, live open/closed.
7. **M6 — hardening**: a11y, perf budgets, drift check wired, preview deploy, OPEN-QUESTIONS.

### Amendment A13 — the sheet can now be written into the book, and the audit had to learn how a built page is actually shaped

A12 gave the site a server-side half and left the guest's side of it untouched: only `/visit` could write.
That made the promise on `/table` — "this writes the sheet above into the kitchen's order book" — a sentence
about a page that had no such control. So `TableBuilder.astro` gained one: a **Record this table** form
(name, phone, notes) that posts `kind:"table"` with the priced lines and the guest's own claimed subtotal to
the same `POST /v1/requests` `/visit` uses, through the same `lib/request-client.mjs`. The board needed no
new edge — one label, `POST /v1/requests → D1 record`, already covered both writers, because it is one
endpoint with two pages pointing at it.

Three rules the control had to obey, each of which produced a defect when it was not followed:

1. **The `wa.me` anchor stays the base element, not a decoration.** A guest whose fetch fails still has a
   message that carries the table. When the fallback first mutated the `href` that `render()` owns, the next
   edit to the sheet silently dropped the contact block from the link. The fix is a dedicated
   `data-handoff` anchor that `syncHandoff()` rewrites on every render *and* on every keystroke in the form —
   the link is a derived value, so exactly one function derives it.
2. **Nothing the script rewrites may contain markup the page promised.** `data-record-hint` originally held
   the `tel:` sentence inside the paragraph `render()` replaces with `textContent`; the first re-phrase
   deleted the phone link. The permanent claim — "a reference is not a confirmation, this number is" — is now
   its own paragraph the script never touches.
3. **The page must say less than it cannot prove.** The site does not cap the sheet, so the cap the Worker
   enforces (`linesMax 40`) became a silent 422 the guest could not act on. `LINES_MAX` is now exported from
   `lib/table.mjs`, the button disables itself above it and says so, and `tests/api.mjs` compares it against
   `LIMITS.linesMax` in the Worker. The same sweep found the default party written three times as a bare `2`,
   and `sanitize()` able to return `0` from a stored `0.4` (pass the `> 0` test, round down, reach the book
   with no party) — both folded into `PARTY_DEFAULT` and one `clampParty()` that rounds before it clamps.

The four `verify-dist` failures that followed were not defects in the site; they were the audit assuming a
built page looks like its source. Read off the runner's own artefact:

- The no-JS hide rule is emitted **inside the page HTML**, not in `_astro/*.css`, and Astro inserts the
  component's scope marker in the middle of the selector:
  `html:not(.js) [data-astro-cid-5z3mfmnb][data-record-form]{display:none}`. Matching the source text
  `html:not(.js) [data-record-form]` fails on a rule that is working. The check now reads a rule as a set of
  conditions — a declaration that sets `display:none` whose selector tests both `html:not(.js)` and the hook
  attribute — and searches the page plus the global sheet.
- `"/v1/requests"` lives in exactly one chunk, `_astro/request-client.tSDpAVVk.js`, which **no page HTML
  names**. With two pages importing it, Vite hoists it and the page chunks reach it relatively
  (`from"./request-client.tSDpAVVk.js"`). Scanning only the chunks listed in the HTML therefore reported "the
  form cannot reach the book" for a form that can. The check now walks the import graph, bounded by the set of
  chunks already read.

That ordering matters for trust: the fix was first run against the *previous* commit's downloaded artefact,
where `/visit`'s four assertions turned green while `/table`'s still failed for the control that build
predated. A checker that only passes on the build it was written against proves nothing.

Proof, in the order it was obtained: `tests/run.mjs` **102 passed**; `tests/api.mjs` **89 passed**, including
the new section that posts a payload built by `tablePayload()` itself and reads `source_url`,
`claimed_subtotal_kes` and `price_delta_kes` back out of the same SQLite file, plus the boundary pair
(`PARTY_MAX` accepted, `PARTY_MAX + 1` refused) against the Worker's own code. CI run 43820392603 then finished
green on the runner: `verify-dist: ok — 5 pages, 305 references, 5 routes, contracts + a11y + weight all
clean`, `check-drift: clean — 3 checks passed`, `verify-runtime: ok — no console errors on any route`. The
artefact from that run is what went to Cloudflare Pages: deployment `2ddc60d0`, live at
`https://habibihavenpreview.pages.dev`, serving `/`, `/menu`, `/table`, `/visit` and `/404` as 200s, with the
page's own `data-api` reading `https://habibi-haven-api.adanjemeshack.workers.dev`.

Finally the deployed pair, probed from the built page's own origin with the site's own payload builder: an
honest `kind:"table"` POST returned **201** with `totalKes 4000`, `itemCount 3`, `lineCount 2` and
`priceDrift.deltaKes 0`; a deliberately wrong claim returned **201** with `claimedKes 1`, `serverKes 4600` and
`deltaKes 4599` — the server's number, not the browser's, which is the whole point of A12; `GET
/v1/requests/:reference` returned **200** with the line items; `POST …/payments` returned **503** naming the
five Daraja secrets still absent; and a second POST from the same phone two seconds later returned **429
slow_down**, which is the throttle working in production rather than in a test. The two automated rows were
deleted after reading them back; three earlier verification rows remain, and nobody at Habibi Haven is
notified when a record lands — that is still OPEN-QUESTIONS territory, and money stays dark until they are
contacted.

### Amendment A14 — the receipt endpoint was the one door with nothing on it, and the lock I fitted turns out to be a speed bump

A13 wired the write path and then audited it. The audit that mattered was the one on the read path, and it
found a hole nobody had looked at: `GET /v1/requests/:reference` had **no rate limit of any kind**. Every
other route sat behind something — writes behind the per-IP window and `MIN_SECONDS_PER_PHONE`, payments
behind a `503` because the Daraja secrets do not exist — but this one answered as many lookups as anyone
could send, and the answer it gives is a stranger's own free text. The response carries `notes` verbatim
("high chair, allergic to peanuts, please sit us near the window"), and the only thing standing between that
and the open internet is a reference: six characters from `REFERENCE_ALPHABET` (28 symbols, `store.mjs`),
about 29 bits. Six characters is a lot for a person who is guessing once and nothing like enough for a
loop that costs 480 million requests. The endpoint also has no authentication by design — the reference *is*
the credential — so there is no better fix available than making a guess expensive.

The change is fifteen lines in `backend/src/index.mjs`. `throttle()` took the limit as a third argument
(defaulting to the existing `IP_WINDOW_LIMIT`) so there is one counting implementation and not two, the read
route passes `${ip}:read` into it — a separate bucket key, so a guest hammering receipt links cannot spend
the write allowance and a bot POSTing cannot be stopped by the reader's ceiling — and the new ceiling is
`READ_WINDOW_LIMIT = 24` per 60-second window, deliberately looser than the 12 the write path uses because
nothing on the site fetches a receipt, so no legitimate guest can reach it.

Two ordering decisions in `getOne` carry more weight than the number does:

- The counter runs **before** `shapedReference()`. A caller spraying `HH-AAAAAA`, `HH-AAAAAB` and
  `HH-###bad###` mixed together must pay the same rent for all of them; if malformed references were
  refused for free, the limiter would become an oracle that whispers "that one was shaped like a real
  reference" once it engaged.
- The refusal sentence is the same whether the reference was well-shaped-but-absent or nonsense, and the
  status is the same `429 slow_down` the write path uses, so the response a throttled caller gets teaches
  them nothing about which references exist.

`tests/api.mjs` gained four checks, and the fourth is the one I would defend in review: after 26 exhausted
reads, a `POST` from a fresh phone still returns **201** — the two buckets genuinely do not share a budget.
The suite is now **93 passed** (A13's 89 predates this change; that number stays as the record of what was
true then). `tests/run.mjs` still **102 passed** and `scripts/check-board.mjs` still finds every one of the
177 board strings.

Then I deployed it — Worker version `4cf923e7-55a8-47c8-91a0-d25402dd41fb` — and the first live probe said
it was not working. Twenty-six `curl` invocations against a real reference, one process per request:
twenty-six `200`. Not one `429`. The honest reading at that moment was "the deploy is stale" or "the code is
wrong", and both were testable, so I ran the cheapest falsifying thing instead of concluding: eighty requests
over **one** keep-alive connection. That came back **31 × 200 and 49 × 429**, with bodies like
`{"code":"slow_down","message":"Too many lookups from here. Give it a minute.","retry_after_seconds":2}`.

So the guard is live and firing, and the difference between the two probes is the thing worth writing down:
`const buckets = new Map()` lives in one isolate, and Cloudflare spreads concurrent requests over many of
them. One-connection-per-request gave each request a cold bucket to itself; one multiplexed connection gave
forty-nine of them the same one. A13's neighbour in the file already conceded exactly this about the write
limiter — "the in-memory one is per-isolate and best effort: it cannot be trusted to be global, and it is
offered as a speed bump rather than as a defence" — but there the database backed it up with
`MIN_SECONDS_PER_PHONE`, a real cross-isolate rule. On the read path there is no database rule to back it
with, because a receipt read that writes a counter row is a write per read, which is the wrong trade for a
preview.

What that leaves, stated plainly: the ceiling multiplies the price of a guess by something between 1 and the
isolate count. It stops a script that walks references at human speed, and it slows a fast one by a factor
that is not in my control. It is not a defence, and the comment above `READ_WINDOW_LIMIT` used to claim it
was — the first version said "walking the 480-million-key space is a century per address", which the second
probe disproved for the production Worker, so it now says what was measured and what the durable options
are. Either a counted read in D1 when this becomes a trading site, or the cheaper fix at launch: eight
characters instead of six, which is 3.8×10^11 and needs no bookkeeping at all. Lengthening is not free —
`REFERENCE_RE` is built from `REFERENCE_LENGTH`, so existing six-character receipts would 400 on their own
links unless the pattern is widened to `{6,N}` before the generator changes. That is a decision for whoever
takes this over, which is why it is recorded here and in the code comment rather than half-implemented now.

Nothing about the guest-facing behaviour changed: a receipt link that works today works after this deploy,
and the only caller who notices anything is the one sending forty lookups a minute through a single socket.

### Amendment A15 — the error path was built out of strings the server owns, and one of them is not a selector

A14 came out of measuring production instead of trusting the suite. The same habit, applied to the response
arms the live probes had never reached, produced four good results and one defect.

Driven from the built page's own origin through the site's own `submitRequest`/`outcome` mapping: a
deliberately wrong reservation (party `999`, phone `0712`) returned **422** and mapped to
`{kind:"invalid", messages:[…], fields:["party","contact.phone"]}`; **415** →
`failed` with "Send application/json."; **413** → `failed` with the size sentence; **404** on a well-shaped
missing reference → `failed` with "We have no request with that reference."; **405** on `GET /v1/requests` →
`failed` with the "never as a list" explanation. None of those POSTs wrote a row — a `422` records nothing —
so the book still holds the same three verification rows and no cleanup was needed.

The defect is in what the pages then *do* with `fields`. Both forms did this:

```js
result.fields.map((field) => form.querySelector(`[name=${field.split(".").pop()}]`))
```

`split(".").pop()` is right for `contact.phone` → `phone`, which is why the /visit arm works today. It is also
what turns a field name into CSS: an unquoted attribute value has to be a CSS identifier. `validate.mjs` emits
`lines[${i}]` **bare** for a line that is not an object at all, and the deployed Worker was probed to confirm
it: `{"lines":["x"]}` → `{"field":"lines[0]","code":"shape"}`. So that expression constructs
`[name=lines[0]]`, brackets and all — a string the browser's selector engine refuses. The throw would land in
the failure handler, after the guest's sentence had been printed: right message, no cursor, one uncaught
exception, on the one path that exists to explain a mistake.

Stated precisely: I did not run a browser to watch it throw — the case is removed rather than argued, and the
hypothesis is not a measurement. What *is* measured is that the server sends that field name, that both pages
interpolated it into a selector, and that nothing in the suite or the runtime rig exercises a `422` against a
live book, which is why it survived every gate so far.

`request-client.mjs` now exports one pure function both pages call: `firstBadControl(fields, controls)` walks
the server's list, takes the last dotted segment, and compares it against the form's own `name`s. No selector
is built, so no string the server can invent — today or after a future `validate.mjs` change — reaches a CSS
parser. Two behaviours it pins that the old line left to chance:

- a complaint with no matching control is skipped, so the cursor lands on the first thing the guest can act on
  rather than on nothing;
- a leaf that comes out empty (`""`, `"."`, `[]`) is not a name and cannot match, which matters because every
  real `form.elements` contains controls whose `name` is `""` — the buttons — and matching that would focus
  the submit button and present it as guidance.

`tests/run.mjs` is now **103 passed**, including a check that feeds the exact field names the Worker answers —
`lines[0]`, `lines[0].qty`, `lines[3].option`, `_body`, `kind`, `source`, `claimedSubtotal` — plus nine
malformed `fields` shapes, and asserts the indexed name is matched when a control really is named that way
(the regression: found by comparison, not by interpolation). `check-ssr-safety`, `check-astro-parse` and
`check-css` are clean, and because the bundle changed this needs a Pages rebuild and redeploy, not only the
Worker.

One limitation is left on purpose rather than fixed quietly: `/visit` names its inputs `date` and `time`,
while the book's complaint is called `visitDate` / `visitTime`, so a past-or-far-ahead time shows its sentence
and does not move the cursor. Aligning them means renaming the inputs and re-pointing the tested payload
builder, which would put the server's vocabulary into the form markup — a bigger edit than the comfort it
buys, on a form whose `min`/`max` already stop most of those mistakes client-side. It is recorded here so
whoever takes this over finds it as a decision, not as a surprise.

### Amendment A16 — A15 went live, and the batch that was reported as done is not done

Two things belong here: what was actually shipped and measured, and a correction to what was claimed last time.

**Shipped.** The green artifact of CI run 43841193277 (commit `1489dc1`, 383 files) was published to Pages
deployment `df9cdeca`, which is now production at `https://habibihavenpreview.pages.dev`: `/`, `/menu`, `/table`
and `/visit` answer 200 and `/nope` 404. The live `/visit` pulls
`_astro/visit.astro_astro_type_script_index_0_lang.B8ww95bt.js`, and the shared chunk
`_astro/request-client.CaBTWWPn.js` carries the comparison loop — `String(r??"").split(".").pop()` matched
against the controls' own `name`s. The interpolated selector A15 removed is gone from the bundle: the only
`[name=` strings left in any chunk are literals (`[name="astro-view-transitions-enabled"]`,
`[name="astro-view-transitions-fallback"]`, `[name=date]`). A15's closing requirement — a Pages rebuild and
redeploy, not only the Worker — is satisfied by this.

**Measured against production, not a fixture.** The same body A15 probed (`kind:"order"` with `lines:["x"]`)
still answers **422** with `fields:["kind","lines[0]"]`. Run through the *shipped* client rather than a mock,
`outcome()` gives `{kind:"invalid", fields:["kind","lines[0]"]}` and `firstBadControl` finds no control for
either name — so no selector is built and nothing throws — while adding one real name to the front of that list
returns `phone`. The book is unchanged: 3 rows, because a 422 records nothing.

**A tooling error, recorded because it changed a conclusion.** Several of those probes were built with
`curl --data-urlencode`, which percent-encodes what it is given: the Worker received `%7B%7D%0A` and answered
**400 `bad_json` — "That is not JSON."** That is the right answer to garbage, not a defect, and it means the
plain-object case (`{}`) is still unmeasured. Re-checking `GET /v1/requests` without that mistake gives **405**
JSON, exactly as the committed table says.

**What is not true.** The previous report described a browser battery (`__hhRequestArms`) driving every arm of
both submit handlers through stubbed responses, two new pure views of the busy answer in `request-client.mjs`, a
104th site test, and a correction to `docs/API-CONTRACT.md`. None of that is in the repository. HEAD is
`1489dc1`; `grep -c __hhRequestArms scripts/verify-runtime.mjs` is **0**; the client exports are the seven
committed ones; the suites still read **103 passed** (site) and **93 passed** (api); `docs/API-CONTRACT.md` does
not exist and no committed document cites it. That work must be treated as not started, and the sentence A15
left standing — that no browser has ever executed the page-level submit handlers — is still exactly right.

### Amendment A17 — the handlers were finally executed in a browser, and the browser disagreed with the page

A15's closing sentence — no browser had ever executed the page-level submit handlers — is now retired, and it
earned its keep: the first run that executed them found a defect in what those handlers *say*.

**What ran.** CI run 43856166954 (commit `3569310`) drove both handlers through fourteen arms in headless Chrome
against `astro preview` — seven exits on `/visit` (recorded, 422 with named fields, the 422 whose field path is
`lines[0]`, 429 with a countdown, unreachable, a 500 that writes nothing) and seven on `/table` (three
price-drift sentences, the same indexed path, 429, unreachable, 500, and the empty-sheet guard). All fourteen
finished with zero console errors. Responses are stubbed by replacing `window.fetch` before
`form.requestSubmit()`, which is the seam `submitRequest(base, payload, { post = globalThis.fetch })` already
exposes; the shipped modules do the work, the arm only schedules the answer. Stubbing is not laziness: a passing
201 on every push would write D1 rows nobody ordered, and two CI cycles of fourteen arms left `requests` at
**3 rows**, which is the evidence that the interception happens before the network.

**What it found.** `/visit server-failure` reported "the submit produced no sentence at all" — the universal
gate that the live region must change had caught a case where the new sentence was *identical* to the previous
arm's. `outcome()` distinguishes `{kind:"unreachable"}` (nothing arrived) from `{kind:"failed", status,
messages}` (the book answered and wrote nothing), and both pages threw that distinction away in a shared
fallback reading "The book could not be reached". For a 500/`not_recorded` that is a claim about the network the
site never observed, and it discarded the server's own message — the one string a guest can act on ("Nothing was
saved. Try again, or send it on WhatsApp.", `backend/src/index.mjs:181`). Each page now names which failure
happened and quotes the book when it quoted back; both still arm the WhatsApp handoff and neither touches the
sheet. The arms forbid the conflation in both directions, so the two sentences cannot merge again.

**Harness lessons, recorded because they are the reason to keep the harness.** Three of the assertions I wrote
first were about the harness rather than the site: a phone number I typed instead of reading `data-wa`, an
`https://` rule on `source` that only the deployment can satisfy (this harness serves over http), and a
value-preservation read that queried `[data-request-form]` from the shared tail — which runs after the `/table`
navigation, so the form was legitimately absent. The rule that follows is that an assertion must name the
document it reads, which is why that read now sits beside the `/visit` battery. The second lesson is structural:
when the tail threw, Node printed a stack and the run lost the report for thirteen arms that had already
executed. The report is a function now, and `uncaughtException`/`unhandledRejection` call it with the error as
the reason, so an interruption costs a line at the top of the evidence instead of the evidence. Those handlers
displace Node's print-and-die default, so each arms an unref'd 30-second backstop — without it a report that
never reached `goodbye` would hold Chrome until GitHub cancelled the job an hour later.

**Also gated.** The phone battery used to sample the dock at one scroll position, which a bar that scrolls away
with the document would pass. `ActionDock.astro` makes it `position: fixed` under 720px, so it is now required to
be in the viewport at 0%, 50% and 95% — the sticky Order/Book controls are in the brief for this site, and this
is the gate that proves they follow the guest rather than merely exist.

**Deployed.** The artifact of that run is Pages deployment `a6b2828b`, production at
`https://habibihavenpreview.pages.dev`: four routes 200, `/nope` 404, live `/visit` pulls
`visit.astro_astro_type_script_index_0_lang.BDbQsG8K.js` and `/table` pulls
`TableBuilder.astro_astro_type_script_index_0_lang.DDwHGTIs.js`, both carrying the new sentences. Each chunk
still contains exactly one "could not be reached" — the genuine connection failure, which is the wording that
should have survived.

**Not proven, and now the honest edge of this work.** The second 500 shape (`server_error`,
`backend/src/index.mjs:120`) shares `kind:"failed"` and the message-quoting path, but no arm of its own — a
fifteenth arm would prove the page quotes the book rather than one hardcoded sentence. Independent subagent
review of these arms was not available in this environment, so they have been read once, by their author, and
executed by the runner. And commit `3569310` has a cosmetic defect of its own: the subject line and its first
paragraph were written without a blank line between them, so git merged them into one 475-character subject. The
text is all in the log; rewriting it would need a force-push, which is not how this repository is operated.

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
   `research/COPY-BANK.md`; a side stack on the runtime column — after A12 six bars deep, pitch 44:
   `gate.mjs → tier` → `DoorScene (three, lazy)` → `2D fallback — same data` →
   `table.mjs (pure math)` → `POST /v1/requests → D1 record` (the one dark bar, the Worker) →
   `wa.me/254116880000 — no-JS` (dashed outline, because it is the path that survives with JavaScript
   off, not the terminal); the line under the column reads `Server reprices every order. Payments stay
   dark.` — full stop, because the caption is the one string in that card with room for nothing longer
   (`fit-board.mjs` measured the longer wording 101px over its card and pinned it, which is condensing a
   lie into a squeeze instead of fixing it). That sentence replaces the pre-A12 board's `No backend.
   No admin. No second source of truth.` — a claim the Worker made false, and the reason the board is
   regenerated whenever a decision is amended rather than left to `check-board.mjs`, which only proves
   a string is *sourced*, never that it is still *true*.
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
