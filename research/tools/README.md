# Research tools

How the numbers in `../BRAND-FACTS.md` were produced. Run from anywhere with
`node habibi-haven-site/research/tools/<file>`.

| script | what it did | still runnable |
|---|---|---|
| `inventory.js` | media refs, item/description coverage, price min/median/max, per-section counts from `../menu-structured.json` — the source of "243 items · 173 photos · 107 described · KSh 100–6,000, median 550" and of the `BREAKFAST COMBO` / `HABIBI COFFEE` over-collection finding | yes |
| `extract-identity.js` | pulled name, category, rating, price signal, phone, address, plus code and hours out of the saved Google Maps / Instagram / Facebook page dumps, writing `../identity-raw.json` | no — reads a session temp folder that Qoder has since cleared |
| `extract-identity2.js` | widened the same pass: full Facebook "about" paragraph, Instagram counters and the 12 post captions | no — same reason |

The two `extract-identity` scripts stay here as a record of method: their output survived in
`../identity-raw.json`, which is what the plan cites. Re-running the identity pass would mean
re-capturing those pages, which M0 does properly.
