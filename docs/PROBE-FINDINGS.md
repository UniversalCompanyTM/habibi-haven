# M0 probe findings

Ran 2026-11-15T01:28:34Z against the live sources, on Node v24.21.0 / npm 11.19.0 with
`C:/Program Files/Google/Chrome/Application/chrome.exe` as the headless browser. Raw evidence:
[`research/probe-ingest.json`](../research/probe-ingest.json), transcript in
[`research/probe-ingest.log`](../research/probe-ingest.log).

This file exists because two early assumptions did not survive contact with the probes, and the
documents kept repeating them. Everything below is a measurement, not a plan.

## 1. The menu page is not readable by fetching it

`https://menu.or.ke/Habibi_Haven/habibi-haven.html` answers `200 text/html`, 33,628 bytes in 341 ms,
but the HTML carries **0 hosted photo references, 0 price mentions and `hostedPhotoRefs: 0`** — the
dishes are painted by the page's own two scripts after load. Rendering it in headless Chrome lifted
the bytes to 39,823 and surfaced **6 price mentions, 5 distinct prices (800–1,400), 6 hosted photo
refs** — i.e. only the first screen. The probe verdict `readChannel: "neither channel yielded a
readable menu"` is about bulk reading, and it stands: a scrape of that page gets one screenful, never
243 items.

What actually carried the menu was the JSON the page talks to, captured in
[`research/menu-items-all.json`](../research/menu-items-all.json) and normalised through
`scripts/ingest.mjs` into `content/menu.source.json`. Browser rendering is therefore used for
verification, not for content acquisition.

## 2. Their photo bucket is public-read — the "401/403" claim was wrong

Six dish photos were sampled twice: once with a plain Node `fetch`, no browser, no cookies, no
referer, no token; once inside headless Chrome as an `<img>`.

| Sample | Plain fetch | In browser |
| --- | --- | --- |
| Liver Malawa | 200, `image/jpeg`, 350,609 B, 1,421 ms | loaded, 1000×1000 |
| Habibi Texas Burger | 200, `image/jpeg`, 816,374 B, 1,980 ms | loaded, 1000×1000 |
| BBQ Chicken Wings | 200, `image/jpeg`, 1,000,042 B | loaded, 1000×1000 |
| (3 more) | 200, 492,384 / 1,014,426 / 716,138 B | loaded, 1000×1000 |

Six of six returned `200` from outside a browser. The earlier note in
[`docs/OPEN-QUESTIONS.md`](OPEN-QUESTIONS.md) §7 said the bucket "answers 401/403 to probes from
outside a browser" — that was true of a *listing* request, not of an object request, and it is
corrected there now. `mirrorChannel: "fetch works for every sampled photo — mirroring is scriptable"`
is the finding, and the mirroring was subsequently run: `site/public/menu/` holds 173 originals and
173 400px derivatives, so the site ships its own copies and never depends on their bucket at runtime.

What remains an ask is not access. It is rights and ownership — §1 and §7 of `OPEN-QUESTIONS.md`.

## 3. Consequences the build already acts on

- Prices come from `menu_items` rows, so where a delivery listing disagrees with the kitchen's own
  record the row wins; the disagreements are printed rather than averaged (`press.json`
  → `disagreements`, `docs/ARCHITECTURE.md` Amendment A5).
- Originals are ~1 MB each at 1000×1000, which is why cards reference a 400px derivative and only the
  featured few load the full file (`srcset` in `DishCard.astro`).
- Because the menu page is client-painted, any future re-ingest must go through the JSON channel;
  `scripts/check-drift.mjs` fails if the shipped data and the captured manifests diverge.
