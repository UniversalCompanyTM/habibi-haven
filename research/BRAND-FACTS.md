# Habibi Haven — captured facts and brand reading

Research digest as of 2026-11-14. Everything here came from public pages rendered in the
in-app browser or from the earlier verbatim Relume extraction. Sources are named per line so
nothing in the design rests on an unsourced claim.

## 1. Business identity

| Field | Value | Source |
|---|---|---|
| Name | Habibi Haven Restaurant | Google Maps, menu.or.ke |
| Name on delivery | "Habib Haven Restaurant" — one "i" missing | Uber Eats |
| Descriptor | "a modern, posh restaurant located in the heart of Nairobi's Central Business District, along Koinange Street … stylish ambiance and a diverse menu featuring both local and international cuisines, Habibi caters to Nairobi's vibrant mi…" (text truncated at source) | Facebook about |
| Google category | Fusion restaurant | Google Maps |
| Price signal | Ksh 1,000–2,000 per person, reported by 53 people | Google Maps |
| Rating | 4.5 ★ from 541 reviews | Google Maps |
| Service options | Dine-in, Takeaway, Delivery | Google Maps |
| Phone | 0116 880000 (+254 116 880 000, WhatsApp `wa.me/254116880000`) | Google Maps, menu.or.ke |
| Address | Koinange Street, Nairobi CBD (Uber Eats: "Nairobi, EMEA 00100") | Google Maps, Uber Eats |
| Plus code | PR99+82 | Google Maps |
| Coordinates | −1.281687, 36.817562 — **derived, not captured**: the centre of the ~14 m cell that PR99+82 denotes (full form 6GCRPR99+82). Published as `geo` with the source named; OSM agrees on the street, nothing independent confirms the door. | decoded from Google's own code — see docs/OPEN-QUESTIONS.md §9 |
| Socials | instagram.com/habibi.haven · facebook.com/profile.php?id=61575101935569 · tiktok.com/@habibi.haven | supplied by user |
| Digital ordering | menu.or.ke/Habibi_Haven/habibi-haven.html (PWA, WhatsApp handoff), Uber Eats store | both read live |
| **Website** | **Google Maps shows "Add website" — they have no website listed.** This build fills a real, empty slot rather than replacing something. | Google Maps |

## 2. Hours — three sources, three answers (needs a decision)

- Google Maps (weekly panel, scraped from `aria-label`s): every day **6:30 am – 11:00 pm**.
- menu.or.ke live page: computes open/closed against **6:00 am – 11:00 pm** in `Africa/Nairobi`.
- Uber Eats store: **9:00 – 17:00** every day, and the store is flagged **"Currently unavailable"**.

The first two are close and both describe the restaurant. The third is a delivery window, not
opening hours — a naive site that shows one number in three places will look wrong to a local
reader. Design decision: one authoritative hours model with separate *dine-in* and *delivery*
fields, verified with the client before launch.

## 3. Menu — scale and shape

From `menu-structured.json` (rendered DOM of menu.or.ke, Supabase-backed):

- **243 items** across **20 section headings**, plus a 22-chip filter bar: All, Biryani,
  Breakfast, Burgers, Chicken, Curries, Drinks, Fish, Grilled, Habibi Specials, Healthy Keto,
  Kid's menu, Mexican, Pasta, Pizza, Salads, Sandwiches, Shawarma, Soups, Starters, Thai Fusion.
- **173 unique hosted photos**, and every one of the 243 items has an image URL. Descriptions
  exist for **107 of 243**. One item is flagged out of stock.
- Prices: **KSh 100 → 6,000**, median **KSh 550**.
- Caveat found while verifying: two headings are over-collected in my scrape — `BREAKFAST COMBO`
  (65) and `HABIBI COFFEE` (87) absorbed the sub-groups that follow them. Uber Eats, which
  paginates the same kitchen, splits it into ~37 real sections (Breakfast Combos, Pancakes and
  Waffles, Omelettes, Sweet Tooths, Cheese Cakes, Cookies, Habibi Coffees, Habibi Lattes,
  Habibi Teas, Habibi Cool Special, Iced Teas, Milkshakes, Smoothies, Dawas, Iced Lattes,
  Lemonades, Nojitos, Coladas, Juices, Kiddies Menu, Cakes, Goat Dishes, Steaks, …). So the
  *true* taxonomy is deeper than 20 and the content model must allow **family → section → item**.

What the numbers say about the brand:

- **Drinks are not an afterthought.** The beverage bucket is roughly a third of the menu —
  coffee, lattes (Matcha, Lotus Biscoff, Caramel, Cinnamon), teas (African Tea Pot, Camel Tea,
  Karak Chai), "Cool Specials" (Mango Chilli, Matcha Yuzu, Orange Presso), iced teas, 10
  milkshakes, smoothies, **dawas** (ginger/lemon/honey, Mint, Cinnamon Garlic, Kinywaji Chakula),
  nojitos, coladas, 10 juices. This is a café-that-eats as much as a restaurant-that-drinks, and
  it opens 6:30 am — the chai-and-coffee morning is a distinct customer.
- **The signature is goat.** Full Mandy KSh 2,300, Half Mandy 1,300, Deillo 2,600 full / 1,400 half,
  Arosto 2,800 full / 1,450 half, and the **Sinia platter at KSh 6,000** (goat mandy + grilled chicken
  + mandy rice + pilau +
  spaghetti + chutney) — the table-feast hero. Google's own "popular with regulars" dish list:
  **Full Mandy** and **Wet Fry Fish with Rice**.
  *Amendment A5, 2026-11-15:* these six figures were corrected from the live `menu_items` rows. The
  earlier numbers here (2,200 / 1,200 / 1,300 / 1,400 / 5,000) came from the Uber Eats cached listing
  and the original design note, both of which lag the kitchen's own system — see `research/PRESS.md`
  §4 and `press.json` → `disagreements`. Nothing in the site, the build, or the tests carries the old
  numbers any more.
- **Bakery is a product line, not a footer.** Whole cakes sold in **2 KG and 3 KG formats**
  (White Forest, Black Forest, Blueberry, Red Velvet, Carrot, Chocolate Fudge, Chocolate Mint),
  slices, cheesecakes, muffins, cookies by threes, brownies. Orderable cakes are a revenue
  channel a website can carry that a paper menu cannot.
- **Coastal/Somali/East-African vocabulary runs through it**: malawax, anjera, mandy, karak chai,
  dawa, kahawa, samosa, shawarma in in-house tortilla, mandazi — paired with ribeye, tikka-free
  pastas, pizzas and Thai fusion sections. "Local and international" is literal.

## 4. Voice (their own words, from Instagram)

Twelve captions recovered from the rendered profile:

> "You asked, we listened. Finally introducing delivery services. Doorstep delivery now available"
> "Our updated MEALS MENU"
> "Sip, savor, and stay a while ✨ At Habibi Haven, every drink is a vibe—crafted to refresh, excite, and keep you coming back for more 🥂 From bold flavors to smooth classics, there's a perfect sip waiting just for you. What are you having today? 🍹💫"
> "Peach, please! This one is irresistible 😉"
> "Which is your favorite drink 🤔"
> "October food dump 😋"
> "Are you an expert 🤔 comment on this video with a screenshot if you were able to catch it"
> "Welcome to Habibi Haven, where every visit feels like coming home ❤️"
> "Beauty captured in every angle 😍"
> "Come and enjoy our signature dish today — goat mandy"
> "A Kenyan classic that never disappoints."
> "Warning: dangerously delicious 🤤"

Reading: playful second-person, short, emoji as punctuation, questions that demand a reply, food
as personality rather than as spec. Hashtags they own: `#habibihaven` `#habibi` `#nairobirestaurants`
`#nairobieats` `#goodfood` `#ambiance`. Nothing in their voice is formal or corporate — so any
website copy that reads like a brochure is off-brand.

## 5. Copy bank that already exists (Relume extraction, ours to reuse or throw away)

The strongest lines Habibi has ever had written for them, captured verbatim before the capture was
deleted. The full transcription — every headline, body paragraph, review quote, form field and
response state — is now in **`COPY-BANK.md`** in this folder.

- "A garden haven in the middle of the city"
- "A haven is not a place you pass through. It is a place you stay too long."
- "Three places to sit, and none of them rush you" — courtyard / kitchen / lounge
- "Come for the lamb chops. Stay for the third cup of chai."
- "541 reviews, and the same things keep coming up"
- "Find us on Koinange Street"

Google's review themes corroborate the "stay" idea independently: **welcoming staff (13
mentions)**, **friendly supervisor (11)**, then the food (chicken biryani 2, mandi 2). Named
reviewers quoted in the capture: Lindah and Farida Kerubo.

Palette and type from the same capture (table in `COPY-BANK.md`): espresso `#12100E`, gold `#CB9235`,
cream `#F6EFE2`, bronze `#7C5920`, deep green `#081511`, gold ramp `#FBF4E8 → #0A0702`;
Bricolage Grotesque for display, Inter for text.

## 6. Assets on hand

**Correction, 2026-11-14.** An earlier version of this section claimed there was "no logo file" and
that interior/ambience photography was "not in hand". Both were wrong, and the reason matters: I
probed menu.or.ke's Supabase buckets — which hold dish photos — and never opened the asset manifest
sitting in the Relume capture. Opening it, then opening each image, changed the answer.

- **The real logo exists locally**: `brand/logo/habibi-haven-badge.jpg` — a 200×200 raster of the
  circular teal mandala badge reading HABIBI HAVEN / HH / RESTAURANT. It was used in the nav and
  footer of all five authored pages. No vector original is on hand.
- **Real venue photography exists locally**: 9 venue frames in `brand/photos/` (12 files there in
  total, the other 3 being food) — the night façade with its lit HABIBI ● HAVEN sign (1200×1200, the
  only large image), the same façade in daylight, the timber arches canopy with hanging lanterns, the
  teal-sofa interior with its yellow neon heart, the stone terrace, and four table settings including
  the window table and one with a CBD tower behind the greenery.
- **Real food photography** in the same set: two sandwich plates and the karak chai service on
  "habibi"-scripted tableware.
- Full inventory, hashes, measured pixel sizes and what is in each frame: **`../brand/ASSETS.md`**.
- 173 unique hosted food photographs (live Supabase `menu-photos` bucket URLs; they load in a
  browser but REST probes from outside it return 401/403, so any build must reference them as
  remote URLs or mirror them with permission).
- The `restaurant-photos` bucket on the same project still yielded no references — the venue photos
  above came from the capture's own CDN (Cloudflare `imagedelivery.net`), whose signed URLs expire,
  which is exactly why they were copied to disk.
- No font licence needed — Bricolage Grotesque and Inter are open-licence via Google Fonts.

Two consequences for the design, both recorded in `docs/OPEN-QUESTIONS.md`: the physical brand is
**teal-forward**, not gold; and the room is photographable, so "designed ambience because there are
no photos" is no longer the reason the door is procedural.

## 7. Gaps worth naming before designing

1. TikTok and Instagram media grids are JS/bot-gated; captions came from rendered HTML, follower
   counts and video assets did not.
2. Venue photography is in hand but **small** — nine of the ten frames are 300×225. Enough for cards
   and proofs of the room, not enough for full-bleed heroes. A shoot (or the client's own originals)
   is still the right ask.
3. Reservations: the Relume shell had a contact form with "A table booking / A private event"
   topics, but there is no evidence of a booking system in production. WhatsApp is the actual
   channel.
4. Whether Uber Eats is live at all — the store says "Currently unavailable". Delivery may in
   fact run through their own WhatsApp/menu.or.ke flow.
5. Prices and hours will move. Any build must treat menu data as data, not as markup.

