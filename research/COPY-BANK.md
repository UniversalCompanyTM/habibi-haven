# Habibi Haven — copy bank

Verbatim language recovered from the abandoned Relume project before that capture was deleted.
Read on 2026-11-14 from the project's own Preview render. **Every line below is copied as-is** —
nothing here was rewritten. This file is the surviving record of that wording; the capture itself is
gone.

Why it is worth keeping: the copy is *good*, it is already the restaurant's own voice, and it is
consistent with the live sources. It is the nearest thing Habibi has to a tone-of-voice document.

Provenance rule for the build: any line used on the site is quoted from here, and factual claims in
it must still pass `BRAND-FACTS.md`.

---

## Page titles (SEO, as authored)

| page | title |
|---|---|
| home | Habibi Haven — Halal Somali & International Dining, Nairobi |
| dine | Dine at Habibi Haven — Lamb Chops, Mandi & Karak Chai, Nairobi |
| gallery | Gallery — Inside Habibi Haven, Koinange Street Nairobi |
| about | About Habibi Haven — The Haven on Koinange Street |
| visit | Visit Habibi Haven — Koinange Street, Nairobi CBD |

Only the home page was ever authored. Dine, Gallery, About and Visit contained navigation and footer
and nothing else.

---

## Navigation and footer

`Dine` · `Gallery` · `About` · `Visit` · `Book a table`

Footer: address `Koinange Street, Nairobi CBD, Kenya`, phone `+254 116 880000`, the same four links,
social icons to `https://www.instagram.com/habibi.haven/`, `https://www.tiktok.com/@habibi.haven`,
`https://www.facebook.com/profile.php?id=61575101935569`, and the line `Habibi Haven. All rights reserved.`

---

## Hero

> Koinange Street, Nairobi
>
> **A garden haven in the middle of the city**
>
> Somali cooking and international plates, halal throughout. Lamb chops off the charcoal, mandi for
> the table, karak chai that keeps coming. Behind the arches on Koinange Street, from 6.30am until 11pm.

Buttons: `Reserve a table` · `See the menu`
Trust strip: `Google Reviews` · `4.5` · `From 541 Google reviews`

## Thesis

> A taste of home, a world of flavour
>
> **A haven is not a place you pass through. It is a place you stay too long.**
>
> Koinange Street moves fast. Behind the arches it does not: greenery overhead, lanterns lit early,
> plates built to be shared, and a kitchen that keeps going until eleven. Most people arrive for one
> course and leave after three.

## Three places to sit

> Inside the haven
>
> **Three places to sit, and none of them rush you**
>
> Walk past the sign and the street noise drops. What is left is green, warm and unhurried, in three parts.

> **The courtyard** — Glass overhead, greenery on every side, benches long enough for a proper
> conversation. This is where most tables end up staying an extra hour.

> **The kitchen** — A charcoal grill, a copper dish of mandi for the middle of the table, biryani
> that arrives in portions meant to be shared. The lamb chops are what people come back for.

> **The lounge** — After the plates are cleared the lanterns stay on. Tea, coffee and low benches,
> with no hurry to turn the table.

Note for the build: the three named rooms are *authored*, not observed. The photographs in
`../brand/photos/` show arches, a terrace, a teal-sofa interior and table settings. Mapping the three
names onto the real frames is an open question for the client call — see `../docs/OPEN-QUESTIONS.md`.

## In motion (video slot)

> In motion
>
> **Watch the haven fill up**
>
> Lanterns lit, the grill going, karak chai poured from a brass pot. The room in motion, the way a
> photograph cannot show it.

No video file was ever attached — the section held a still image.

## The food strip

> The food
>
> **On the table**
>
> The kitchen runs from breakfast to last orders: a charcoal grill, mandi built for sharing, and a
> karak chai that regulars order before they even sit down.

Lightbox captions, in document order: `Grilled sandwiches and fries` · `Tea service` ·
`Coffee in the courtyard` · `The table, mid-meal` · `By the window` · `Chicken sandwich and fries`

## Reviews

> Guest voices
>
> **541 reviews, and the same things keep coming up**
>
> 4.5 stars on Google. Portions, karak chai and the way people are received come up again and again.

Two quotes were authored, with names and Google attribution:

> Had an amazing experience here. From the moment I walked in, they received me well. Then the
> breakfast spread was amazing. Great portions. Oh, and the Karak chai was really good, I'd recommend
> anytime.
> — Lindah, Google review, 3 months ago

> Really good food with such generous portions. Everything came at the right temperature and was
> served promptly. The cinnamon latte was also really good. I came for a solo date and it was a lovely
> spot for a Monday afternoon.
> — Farida Kerubo, Google review, 2 months ago

The "3 months ago" / "2 months ago" stamps were relative to the capture date. If these two quotes are
reused they need re-checking against Google and re-dated, or the relative wording dropped.

## Reservations

> Reservations
>
> **Come for the lamb chops. Stay for the third cup of chai.**
>
> From 6.30am through to last orders at 11pm, every day. Call and we will hold a table, or send a
> request and we will come back to you.

`Reserve a table` · `Call +254 116 880000`

## Visit / contact

> Find us on Koinange Street
>
> In the middle of the CBD, a short walk from the Koinange Street matatu stage. Open every day until
> 11pm, phone answered from breakfast.

`Address — Koinange Street, Nairobi CBD, Kenya` · `Phone — +254 116 880000` · `Hours — Every day, 6.30am to 11pm`

Form as authored (fields, placeholders and the three response states):

| label | control | name | placeholder / options |
|---|---|---|---|
| Name | text | `name` | Enter your answer |
| Email | email | `email` | you@example.com |
| Date you're coming | date | `date` | Enter your answer |
| What is this about? | select | `topic` | A table booking · A private event |
| Anything we should know? | textarea | `message` | How can we help? |

- button: `Send request`
- pending/notice: `We usually reply the same day. For tonight, call +254 116 880000.`
- success: `Thank you, we have your request. We will call or email you to confirm your table.`
- failure: `That didn't send. Please call us on +254 116 880000.`

The new build has no backend, so this form becomes the WhatsApp handoff. The wording above is the
tone to keep; the success/failure states must describe what actually happens (a message composed in
WhatsApp), or they must go.

---

## Design system as authored

| scheme | background | secondary | heading | text | accent |
|---|---|---|---|---|---|
| scheme-1 | `#12100E` | `#282625` | `#F5F5F5` | `#F5F5F5` | `#CB9235` |
| scheme-2 | `#F6EFE2` | `#EDE7DA` | `#080706` | `#080706` | `#7C5920` |
| scheme-3 | `#7C5920` | `#A5762B` | `#ffffff` | `#ffffff` | `#F6E5C8` |
| scheme-4 | `#081511` | `#102D25` | `#ffffff` | `#ffffff` | `#CB9235` |

Fonts loaded: **Bricolage Grotesque** (headings, H1 at 64px) and **Inter** (body). Material Symbols
for icon glyphs.

These are the values the architecture's token table is built from. They are espresso/gold/cream with
one deep-green scheme. The restaurant's own logo and signage are teal — see `../brand/ASSETS.md` and
`docs/OPEN-QUESTIONS.md` — so the green scheme is the one that agrees with the physical place.

Brand gold ramp, all eleven authored stops (`--color-color1-50…950`):
`#FBF4E8 · #F6E5C8 · #EFCF99 · #E0A13A · #CB9235 · #A5762B · #7C5920 · #553D16 · #32240D · #171006 · #0A0702`

Type, verified in the render rather than guessed from the CSS: Bricolage Grotesque at **64px for the
H1**, Inter for body text.

## Home section order as authored

Worth keeping as an IA reference — it is the only sequence Habibi has ever had.

1. Navigation — Dine / Gallery / About / Visit / Book a table
2. Hero — "A garden haven in the middle of the city"
3. Thesis — "A haven is not a place you pass through…"
4. Three places to sit — courtyard / kitchen / lounge
5. In motion — "Watch the haven fill up"
6. The food — "On the table", 6 captioned gallery tiles
7. Guest voices — "541 reviews, and the same things keep coming up"
8. Reservations — "Come for the lamb chops…"
9. Visit — "Find us on Koinange Street" + request form
10. Footer — socials, address, phone, nav

## One caution carried over from the capture log

A second reading of the project reported `rgb(241,240,238)` and the Geist typeface. That was
**Relume's editor chrome**, not the restaurant's design. The authored CSS above is the real thing. Do
not let editor UI tokens into the token set.
