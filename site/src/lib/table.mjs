// site/src/lib/table.mjs — the maths behind "Set your table".
//
// Decision 4: the configurator never claims to reserve. It composes a table, prices it from
// content that came from their own database, and hands the result to the channel the restaurant
// already uses (WhatsApp on +254 116 880 000). A shareable URL is the only state, so there is no
// session to expire and nothing to lose on refresh.
//
// Pure functions over the menu JSON; the component that reads them stays thin enough to audit.

const KE = "en-KE";

/* ------------------------------------------------------------------ limits */

/**
 * The smallest and largest party this site will build, ask for, or decode from a link.
 *
 * It is a constant rather than a number written at each call site because the same policy currently sits in
 * four places: the stepper in TableBuilder, the `min`/`max` on the /visit party input, the share-link decoder
 * here, and `LIMITS.partyMax` in backend/src/validate.mjs, which is the one that actually refuses a request.
 * Three of those four were written independently, and one of them (/visit) said 20 — so a party of 25 got a
 * browser error on one page and a 422 on another for a rule the book states as 30. tests/api.mjs now compares
 * this pair against the Worker's, so a fifth copy that disagrees fails the build rather than the guest.
 */
export const PARTY_MIN = 1;
export const PARTY_MAX = 30;

/**
 * The party a sheet starts with, and the party a share link falls back to when its first field is not a
 * number, is zero, or is negative.
 *
 * Not PARTY_MIN, deliberately: a guest who opens a link whose party went corrupt still has dishes on the
 * sheet, and a table for one with three mains reads as an error in the page rather than as a default. Three
 * places needed this figure — `emptyTable`, the share-link decoder, and the store's `sanitize` in
 * lib/table-client.mjs — and each had its own literal `2`, which is how one default becomes three.
 */
export const PARTY_DEFAULT = 2;

/**
 * Bring any candidate party into the window.
 *
 * The three sources of a party — a stored table, a hand-edited share link, and the stepper — all need this,
 * and each used to write its own `Math.max`/`Math.min` around a `Number()` that could still land outside the
 * range it was clamping. A stored `0.4` was the live case: it passed the `> 0` test, rounded down to `0`, and
 * reached the book with no party at all. Round first, then clamp, and the only value that can escape is one
 * that was never a number — which becomes the default rather than an edge of the window, so a corrupt link
 * reads as "a table, size unknown" instead of "a table for one".
 */
export function clampParty(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return PARTY_DEFAULT;
  return Math.max(PARTY_MIN, Math.min(PARTY_MAX, Math.round(n)));
}

/**
 * How many different rows one recorded table may hold.
 *
 * The same argument as above, and the same bug class: `LIMITS.linesMax` in backend/src/validate.mjs answers
 * a 41st distinct dish with a 422 the guest cannot act on, while nothing on this site ever told them the
 * sheet had a ceiling. The sheet itself is uncapped on purpose — the WhatsApp message is a paragraph and a
 * long one is nobody's error — so the cap belongs at the button that writes, which disables itself and says
 * what it is doing. tests/api.mjs compares this number with the Worker's.
 */
export const LINES_MAX = 40;

/* ------------------------------------------------------------------ money */

const formatter = new Intl.NumberFormat(KE, { maximumFractionDigits: 0 });

/** Whole Kenyan shillings, as their own menu stores them: 2300 → "KSh 2,300". */
export function money(amount) {
  const n = Math.round(Number(amount) || 0);
  return `KSh ${formatter.format(n)}`;
}

/* -------------------------------------------------------------- selections */

/**
 * A table is `{ party, lines }` where each line is `{ id, qty, option? }`. `option` is the chosen
 * accompaniment label when the dish has one (the "Choose your side" rows in their data), and it is
 * part of the line's identity: two plates of the same rice with different sides are two lines.
 *
 * There is deliberately no hour in here. When you are coming is a separate choice made at the
 * handoff (`whatsappText(menu, table, when, origin)`), because a table is what you want and a time is
 * when — and the site must not imply it has booked anything by storing one with the other.
 */
export function lineKey(id, option) {
  return option ? `${id}::${option}` : id;
}

export function findItem(menu, id) {
  for (const family of menu.families) {
    for (const section of family.sections) {
      const hit = section.items.find((i) => i.id === id);
      if (hit) return hit;
    }
  }
  return null;
}

export function addLine(table, id, option) {
  const key = lineKey(id, option);
  const existing = table.lines.find((l) => lineKey(l.id, l.option) === key);
  const lines = existing
    ? table.lines.map((l) =>
        lineKey(l.id, l.option) === key ? { ...l, qty: Math.min(99, l.qty + 1) } : l,
      )
    : [...table.lines, { id, ...(option ? { option } : {}), qty: 1 }];
  return { ...table, lines };
}

export function setQty(table, id, option, qty) {
  const key = lineKey(id, option);
  const clamped = Math.max(0, Math.min(99, Math.round(Number(qty) || 0)));
  const lines = table.lines
    .map((l) => (lineKey(l.id, l.option) === key ? { ...l, qty: clamped } : l))
    .filter((l) => l.qty > 0);
  return { ...table, lines };
}

export function removeLine(table, id, option) {
  const key = lineKey(id, option);
  return { ...table, lines: table.lines.filter((l) => lineKey(l.id, l.option) !== key) };
}

/**
 * Change which side a dish came with, in place.
 *
 * The line's identity includes its accompaniment, so "switch Mandy Rice to Chips" is not an edit of a
 * field — it is a move from one key to another. If the target is already on the table (two plates of
 * the same chicken, one already with chips) the quantities merge rather than the table growing a
 * duplicate row, because two rows for one dish is what a printed bill has to avoid.
 */
export function setOption(table, id, option, nextOption) {
  if (option === nextOption) return table;
  const fromKey = lineKey(id, option);
  const toKey = lineKey(id, nextOption);
  const line = table.lines.find((l) => lineKey(l.id, l.option) === fromKey);
  if (!line) return table;
  const twin = table.lines.find((l) => lineKey(l.id, l.option) === toKey);

  // Renaming keeps the row where the guest left it. Merging keeps the row that was already there and
  // drops the one being moved, so the list never grows a duplicate dish.
  const lines = twin
    ? table.lines
        .filter((l) => lineKey(l.id, l.option) !== fromKey)
        .map((l) => (lineKey(l.id, l.option) === toKey ? { ...l, qty: Math.min(99, l.qty + line.qty) } : l))
    : table.lines.map((l) => (lineKey(l.id, l.option) === fromKey ? { ...l, option: nextOption } : l));
  return { ...table, lines };
}

export function emptyTable(party = PARTY_DEFAULT) {
  return { party, lines: [] };
}

/* ------------------------------------------------------------------ totals */

export function totals(menu, table) {
  const rows = [];
  let subtotal = 0;
  let unavailable = 0;
  for (const line of table.lines) {
    const item = findItem(menu, line.id);
    if (!item) continue; // a stale URL can name an id the current menu no longer has
    const amount = item.price * line.qty;
    subtotal += amount;
    if (!item.availability.open || !item.availability.inStock) unavailable += 1;
    rows.push({
      key: lineKey(line.id, line.option),
      id: item.id,
      name: item.name,
      ...(line.option ? { option: line.option } : {}),
      unit: item.price,
      qty: line.qty,
      amount,
      unavailable: !item.availability.open || !item.availability.inStock,
    });
  }
  const count = rows.reduce((n, r) => n + r.qty, 0);
  return {
    rows,
    count,
    subtotal,
    /** Their own signal is Ksh 1,000–2,000 per person; use it as guidance, never as a surcharge. */
    perPerson: table.party ? Math.round(subtotal / table.party) : 0,
    lineCount: rows.length,
    unavailable,
  };
}

/**
 * Per-dish counts for a party. Their menu carries explicit multi-person formats (the KSh 6,000
 * Sinia platter is a table dish, a slice of cake is not), so scaling is a recommendation about
 * *which* rows to add, not a multiplication of every row.
 */
export function partyAdvice(totals_, party) {
  if (!totals_.count) return null;
  const perHead = totals_.perPerson;
  if (party >= 4 && !totals_.rows.some((r) => r.name.match(/platter|mandy|sinia/i))) {
    return "Feeding four or more? The goat platters are built for a table — one Sinia replaces several mains.";
  }
  if (perHead < 500) return "A light table so far. The starters are the size of a small main.";
  if (perHead > 2500) return "A serious spread. Add the dawa and expect to stay too long.";
  return null;
}

/* ------------------------------------------------------- bakery cake sizes */

/**
 * Two rows, same cake, different weight (White Forest Cake 2KG / 3KG). The bakery cards should
 * present them as one cake with a size choice rather than two unrelated products.
 *
 * The weight suffix is case-insensitive on purpose: their own data writes four of the fourteen cake
 * rows "2KG"/"3KG" (White Forest, Black Forest) and ten "2Kg"/"3Kg" (Blueberry, Red Velvet, Carrot,
 * Chocolate Fudge, Chocolate Mint), so a `/KG|kg/` alternation misses the mixed-case half.
 */
export function cakeFamily(name) {
  const m = String(name).match(/^(.*?)\s*(\d)\s*kg\s*$/i);
  if (!m) return null;
  return { base: m[1].trim(), kg: Number(m[2]) };
}

export function cakeSiblings(menu, item) {
  const fam = cakeFamily(item.name);
  if (!fam) return [];
  const out = [];
  for (const family of menu.families) {
    for (const section of family.sections) {
      for (const other of section.items) {
        if (other.id === item.id) continue;
        const of = cakeFamily(other.name);
        if (of && of.base.toLowerCase() === fam.base.toLowerCase()) out.push(other);
      }
    }
  }
  return out.sort((a, b) => a.price - b.price);
}

/* ------------------------------------------------------------- share links */

// Compact, hand-editable, and it survives being pasted into WhatsApp: `party|id xQty|id>Opt xQty`.
// `>` separates an accompaniment because `:` already separates the id from its count.
export function encodeTable(table) {
  const parts = [String(table.party)];
  for (const l of table.lines) {
    const id = l.option ? `${l.id}>${encodeURIComponent(l.option)}` : l.id;
    parts.push(`${id}x${l.qty}`);
  }
  return parts.join("|");
}

export function decodeTable(raw) {
  const text = String(raw || "");
  if (!text) return null;
  const parts = text.split("|").filter(Boolean);
  if (parts.length < 1) return null;
  const party = clampParty(Number(parts[0]) || PARTY_DEFAULT);
  const lines = [];
  for (const part of parts.slice(1)) {
    const m = part.match(/^(.*)x(\d{1,2})$/);
    if (!m) continue;
    const [idChunk, qty] = [m[1], Number(m[2])];
    const gt = idChunk.indexOf(">");
    if (gt === -1) lines.push({ id: idChunk, qty });
    else lines.push({ id: idChunk.slice(0, gt), option: decodeURIComponent(idChunk.slice(gt + 1)), qty });
  }
  return { party, lines };
}

export function shareUrl(origin, table) {
  return `${origin}/table?t=${encodeURIComponent(encodeTable(table))}`;
}

/* ------------------------------------------------------------ the handoff */

/**
 * The WhatsApp body. It reads like a guest typed it, because the restaurant receives it as a
 * message from a guest: no marketing footer, no invented table number, no promise of a booking.
 * Prices are included so the guest and the floor staff are looking at the same number.
 *
 * `origin` is the site the guest is actually on — passed in from Astro's `site` config rather than
 * hardcoded, so a preview deploy never sends the restaurant a link to production.
 */
export function whatsappText(menu, table, when, origin = "") {
  const t = totals(menu, table);
  const lines = ["Hello Habibi Haven — we'd like a table.", ""];
  lines.push(`Party: ${table.party} ${table.party === 1 ? "guest" : "guests"}`);
  if (when) lines.push(`When: ${when}`);
  lines.push("", "What we're after:");
  for (const r of t.rows) {
    const suffix = r.option ? ` (${r.option})` : "";
    lines.push(`• ${r.qty} × ${r.name}${suffix} — ${money(r.amount)}`);
  }
  lines.push("", `Estimated total: ${money(t.subtotal)}`);
  if (t.unavailable) lines.push(`(${t.unavailable} of those are showing as unavailable today — happy to swap.)`);
  if (origin) lines.push("", `From: ${shareUrl(origin, table)}`);
  return lines.join("\n");
}

export function whatsappUrl(menu, table, when, origin = "") {
  const phone = menu?.meta?.facts?.whatsapp ?? "254116880000";
  return `https://wa.me/${phone}?text=${encodeURIComponent(whatsappText(menu, table, when, origin))}`;
}

/* ------------------------------------------------------------- signature */

/**
 * The rows the author marked in `content/menu.overrides.json`, ordered by `signatureOrder` — the
 * position they were written at (Full Mandy → Sinia → Lamb Chops → Chicken Biryani → Karak Chai →
 * White Forest Cake 2KG). Without the sort this returns taxonomy order, which puts the cake first;
 * the field is emitted by build-content.mjs and its gaplessness is asserted there, so a dropped
 * position fails the build instead of quietly reordering the home page.
 */
export function signatureItems(menu) {
  const out = [];
  for (const family of menu.families) {
    for (const section of family.sections) {
      for (const item of section.items) if (item.signatureRole) out.push(item);
    }
  }
  return out.sort((a, b) => a.signatureOrder - b.signatureOrder);
}

export function sectionItem(menu, sectionId) {
  for (const family of menu.families) {
    const hit = family.sections.find((s) => s.id === sectionId);
    if (hit) return hit.items;
  }
  return [];
}
