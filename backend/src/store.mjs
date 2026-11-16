// backend/src/store.mjs — every sentence this server says to its database, in one file.
//
// Grouping the SQL here is what keeps the Worker auditable: the handler decides *whether* something may
// be written, this module decides *how*, and neither reaches into the other's business. Every statement
// is prepared and bound — guest text never enters a SQL string.
//
// The D1 surface used is the small one: `prepare(sql).bind(...).all() / .first()` and `batch()`.
// tests/api.mjs runs this file against real SQLite through `node:sqlite`, behind an adapter that models
// exactly those methods, so the queries are executed rather than mocked. D1 is SQLite, so the dialect
// matches; what the adapter proves is the SQL and the bindings, and the live probe after deploy is what
// proves the real binding exists at all.

// No I, L, O, U, V, W, X or Y: read aloud to a waiter over the phone, those are the ones that come back
// wrong. Exported because the router in index.mjs has to accept exactly this set and nothing else — a
// pattern written out by hand is how a valid reference met a 400 (tests/api.mjs asserts the two agree).
export const REFERENCE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTZ";
export const REFERENCE_LENGTH = 6;

/* ------------------------------------------------------------- references */

/**
 * `HH-4KQ7MR`: short enough to type into WhatsApp, long enough not to be guessed (26^6), and drawn from
 * the platform CSPRNG rather than derived from anything about the request. A reference built from the
 * phone and the time would let one guest work out another's, which is exactly what makes a lookup URL a
 * leak.
 */
export function makeReference(bytes = crypto.getRandomValues(new Uint8Array(REFERENCE_LENGTH))) {
  let out = "";
  for (const byte of bytes) out += REFERENCE_ALPHABET[byte % REFERENCE_ALPHABET.length];
  return `HH-${out}`;
}

/* ---------------------------------------------------------------- catalog */

export class CatalogProblem extends Error {
  constructor(message) {
    super(message);
    this.name = "CatalogProblem";
  }
}

/**
 * The server's own price list and the hours it enforces, read at request time.
 *
 * Deliberately not cached in module scope: traffic here is a guest pressing a button, not a hot path,
 * and a cache would keep quoting a price for minutes after the kitchen moved it — the one failure this
 * table exists to prevent. If it ever needs caching, key the cache on `dataStamp` so a seed
 * invalidates it.
 */
export async function readCatalog(db) {
  let priceRows;
  let settingRows;
  try {
    ({ results: priceRows } = await db.prepare("SELECT item_id, name, unit_kes, available FROM prices").all());
    ({ results: settingRows } = await db
      .prepare("SELECT key, value FROM settings WHERE key IN ('hoursOfRecord', 'dataStamp', 'sourceFingerprint')")
      .all());
  } catch (error) {
    // A missing table means a deployment that has not been migrated or seeded yet — never a guest error.
    throw new CatalogProblem(`catalog read failed: ${error?.message ?? error}`);
  }

  const items = new Map();
  for (const row of priceRows ?? []) {
    const price = Number(row.unit_kes);
    if (!Number.isInteger(price) || price < 0) continue; // refuse to quote money we cannot trust
    items.set(row.item_id, { id: row.item_id, name: row.name, price, available: Number(row.available) !== 0 });
  }
  if (items.size === 0)
    throw new CatalogProblem("the price list is empty — seed backend/seed.sql before accepting requests");

  const settings = new Map((settingRows ?? []).map((r) => [r.key, r.value]));
  const hours = parseHours(settings.get("hoursOfRecord"));
  if (!hours)
    throw new CatalogProblem("settings.hoursOfRecord is missing or unreadable — the server cannot check a time it cannot read");

  return { items, hours, dataStamp: settings.get("dataStamp") ?? null, fingerprint: settings.get("sourceFingerprint") ?? null };
}

function parseHours(raw) {
  if (typeof raw !== "string") return null;
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  const open = String(parsed?.open ?? "");
  const close = String(parsed?.close ?? "");
  const openMinutes = hhmmToMinutes(open);
  const closeMinutes = hhmmToMinutes(close);
  // A close not after an open would make every reservation "outside hours", which reads as a busy
  // restaurant rather than as bad data — so the catalog refuses it instead.
  if (openMinutes === null || closeMinutes === null || closeMinutes <= openMinutes) return null;
  return { open, close, openMinutes, closeMinutes };
}

function hhmmToMinutes(text) {
  const m = /^(\d{2}):(\d{2})$/.exec(text);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

/* ----------------------------------------------------------------- writes */

const INSERT_REQUEST =
  "INSERT INTO requests (reference, kind, status, party_size, visit_at, when_label, contact_name, contact_phone, " +
  "notes, subtotal_kes, line_count, item_count, unavailable_count, claimed_subtotal_kes, price_delta_kes, " +
  "source_url, payment_state, created_at) VALUES (?, ?, 'recorded', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'none', ?)";

const INSERT_LINE =
  "INSERT INTO request_lines (request_reference, item_id, item_name, option_label, unit_kes, qty, amount_kes, available) " +
  "VALUES (?, ?, ?, ?, ?, ?, ?, ?)";

/**
 * Commits the header and its bill as one batch, and returns the reference only when both landed.
 *
 * `batch()` is a single round trip and D1 runs the statements as one transaction, so no guest is ever
 * handed a reference that points at half a record — which matters because that reference is what they
 * will quote on WhatsApp. A duplicate reference (astronomically unlikely at 26^6, possible in principle)
 * rolls the whole batch back and reports `null`, and the caller retries with a fresh one.
 */
export async function insertRequest(db, value, { reference, createdAt }) {
  const header = db
    .prepare(INSERT_REQUEST)
    .bind(
      reference,
      value.kind,
      value.party ?? null,
      value.visitAt ?? null,
      value.whenLabel ?? null,
      value.name,
      value.phone,
      value.notes ?? null,
      value.subtotal,
      value.lineCount,
      value.itemCount,
      value.unavailableCount,
      value.claimed ?? null,
      value.priceDelta ?? null,
      value.source ?? null,
      createdAt,
    );

  const lines = value.rows.map((row) =>
    db
      .prepare(INSERT_LINE)
      .bind(reference, row.id, row.name, row.option ?? null, row.unit, row.qty, row.amount, row.available ? 1 : 0),
  );

  try {
    await db.batch([header, ...lines]);
  } catch (error) {
    if (isDuplicateReference(error)) return null;
    throw error;
  }
  return { reference };
}

function isDuplicateReference(error) {
  return /UNIQUE constraint failed: requests\.reference/i.test(String(error?.message ?? error ?? ""));
}

/* ------------------------------------------------------------------ reads */

const SELECT_REQUEST =
  "SELECT reference, kind, status, party_size, visit_at, when_label, contact_phone, notes, subtotal_kes, line_count, " +
  "item_count, unavailable_count, claimed_subtotal_kes, price_delta_kes, source_url, payment_state, created_at " +
  "FROM requests WHERE reference = ?";

const SELECT_LINES =
  "SELECT item_id, item_name, option_label, unit_kes, qty, amount_kes, available FROM request_lines " +
  "WHERE request_reference = ? ORDER BY id";

/**
 * The guest's receipt, by reference.
 *
 * `contact_name` is not in the select on purpose: this endpoint is reachable by anyone who has or guesses
 * a reference, so it answers with the bill and the time — the things the guest already knows — and keeps
 * the name and the full number out of it. There is no endpoint that returns a list of requests, for the
 * same reason; the floor manager's view is a job for an authenticated one (docs/OPEN-QUESTIONS.md §10).
 */
export async function readRequest(db, reference) {
  const [header, lines] = await db.batch([
    db.prepare(SELECT_REQUEST).bind(reference),
    db.prepare(SELECT_LINES).bind(reference),
  ]);
  const record = header?.results?.[0];
  if (!record) return null;
  return { record, lines: lines?.results ?? [] };
}

/** When this phone last asked, for the abuse backstop in index.mjs. */
export async function lastRequestAt(db, phone) {
  const row = await db
    .prepare("SELECT created_at FROM requests WHERE contact_phone = ? ORDER BY id DESC LIMIT 1")
    .bind(phone)
    .first();
  return row?.created_at ?? null;
}

/** The audit row for one STK push. */
export async function readPayment(db, checkoutRequestId) {
  return (
    (await db
      .prepare(
        "SELECT request_reference, checkout_request_id, merchant_request_id, mpesa_receipt, amount_kes, phone, state, " +
          "result_code, result_desc, initiated_at, verified_at FROM payments WHERE checkout_request_id = ?",
      )
      .bind(checkoutRequestId)
      .first()) ?? null
  );
}

export function insertPaymentStatement(db, payment) {
  return db
    .prepare(
      "INSERT INTO payments (request_reference, checkout_request_id, merchant_request_id, mpesa_receipt, amount_kes, " +
        "phone, state, result_code, result_desc, initiated_at, verified_at, callback_digest) " +
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(
      payment.requestReference,
      payment.checkoutRequestId,
      payment.merchantRequestId ?? null,
      payment.receipt ?? null,
      payment.amountKes,
      payment.phone,
      payment.state,
      payment.resultCode ?? null,
      payment.resultDesc ?? null,
      payment.initiatedAt,
      payment.verifiedAt ?? null,
      payment.callbackDigest ?? null,
    );
}

/**
 * Marks a request paid. Two writes in one batch: the payment row records that M-Pesa said yes, the
 * request row carries the state the guest and the staff will actually read. Keeping them apart would
 * allow the state this site quotes to disagree with the audit trail that justifies it.
 */
export function markPaidStatements(db, { requestReference, checkoutRequestId, at, receipt, resultCode, resultDesc }) {
  return [
    db
      .prepare(
        "UPDATE payments SET state = 'verified', verified_at = ?, mpesa_receipt = ?, result_code = ?, result_desc = ? " +
          "WHERE checkout_request_id = ?",
      )
      .bind(at, receipt, resultCode, resultDesc, checkoutRequestId),
    db.prepare("UPDATE requests SET payment_state = 'verified' WHERE reference = ?").bind(requestReference),
  ];
}

/**
 * Marks a request unpaid. The mirror of `markPaidStatements` and the same two writes: a callback that
 * says the customer never entered their PIN has to move the payment row *and* the state the guest reads,
 * or the confirmation screen keeps saying "payment initiated" forever on a bill that is simply not paid.
 */
export function markFailedStatements(db, { requestReference, checkoutRequestId, resultCode, resultDesc }) {
  return [
    db
      .prepare("UPDATE payments SET state = 'failed', result_code = ?, result_desc = ? WHERE checkout_request_id = ?")
      .bind(resultCode, resultDesc, checkoutRequestId),
    db.prepare("UPDATE requests SET payment_state = 'failed' WHERE reference = ?").bind(requestReference),
  ];
}
