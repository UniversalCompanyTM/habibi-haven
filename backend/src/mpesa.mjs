// backend/src/mpesa.mjs — the Daraja M-Pesa STK Push path, written and dark.
//
// What "dark" means precisely: no credential exists on this deployment, so every entry point here is
// unreachable in production and `paymentStatus()` says so rather than pretending. What "written" means:
// the request builder, the timestamp rule, the callback checks and the audit writes are real code with
// real tests — tests/api.mjs feeds them fake secrets and a fake Daraja — so switching payments on is a
// credentials task, not a coding task.
//
// What none of that proves: that this works against Safaricom. Field names and endpoints follow their
// published API, and the first live call will be the first real test. That is why the site is not allowed
// to promise a payment until someone has actually made one. docs/OPEN-QUESTIONS.md §10 holds the
// prerequisites: consumer key/secret, the Business Passkey, a Paybill or Till, an HTTPS callback URL
// Safaricom can reach, and Habibi's agreement to take money this way.

import { insertPaymentStatement, markFailedStatements, markPaidStatements, readPayment } from "./store.mjs";

export const DARAJA_BASES = {
  sandbox: "https://sandbox.safaricom.co.ke",
  live: "https://api.safaricom.co.ke",
};

/** Every one of these is a Worker secret. None may be a plain env var, a file, or a comment. */
export const REQUIRED_SECRETS = [
  "DARAJA_CONSUMER_KEY",
  "DARAJA_CONSUMER_SECRET",
  "DARAJA_SHORT_CODE",
  "DARAJA_PASSKEY",
  "DARAJA_CALLBACK_TOKEN",
  "PUBLIC_BASE_URL",
];

const isText = (v) => typeof v === "string" && v.trim() !== "";

/** Whether this deployment could take money at all, and in which environment. Never throws. */
export function paymentStatus(env) {
  const missing = REQUIRED_SECRETS.filter((key) => !isText(env?.[key]));
  if (missing.length) return { configured: false, mode: "off", missing, code: "payments_not_configured" };
  const mode = env.DARAJA_ENV === "live" ? "live" : "sandbox";
  return {
    configured: true,
    mode,
    missing: [],
    shortCode: env.DARAJA_SHORT_CODE,
    // Paybill takes a per-customer account number; Buy Goods takes none. Guessing wrong shows the
    // customer a failed prompt, so the type is configured rather than inferred from a length.
    transactionType: env.DARAJA_TRANSACTION_TYPE === "CustomerBuyGoodsOnline" ? "CustomerBuyGoodsOnline" : "CustomerPayBillOnline",
    accountRef: isText(env.DARAJA_ACCOUNT_REFERENCE) ? env.DARAJA_ACCOUNT_REFERENCE : env.DARAJA_SHORT_CODE,
  };
}

/* ------------------------------------------------------------ the parts */

/**
 * Daraja expects the timestamp in East African time, and a Worker clock reads UTC.
 *
 * Formatting the UTC parts of `now` sends a stamp three hours stale. The sandbox is relaxed about that
 * and production is not, so the offset is applied as arithmetic instead of trusting a host locale — the
 * same reasoning that keeps site/src/lib/hours.mjs free of `Intl`.
 */
export function nairobiStamp(now = new Date()) {
  const local = new Date(now.getTime() + 180 * 60_000);
  const p = (n) => String(n).padStart(2, "0");
  return (
    `${local.getUTCFullYear()}${p(local.getUTCMonth() + 1)}${p(local.getUTCDate())}` +
    `${p(local.getUTCHours())}${p(local.getUTCMinutes())}${p(local.getUTCSeconds())}`
  );
}

/** base64(shortCode + passkey + timestamp). The passkey is the shared secret and never leaves here. */
export function stkPassword({ shortCode, passkey, stamp }) {
  return btoa(`${shortCode}${passkey}${stamp}`);
}

/**
 * The exact call an STK push is — URLs, headers, body — built rather than performed.
 *
 * Split out because it is the part worth asserting: a wrong field name or an unquoted amount is a
 * rejected request that no screen-facing test could explain. Keeping `fetch` at one call site also means
 * nothing in this module can reach the network without passing the configured-guard first.
 */
export function buildStkRequest({ env, status, phone, amountKes, reference, now = new Date() }) {
  const stamp = nairobiStamp(now);
  const base = DARAJA_BASES[status.mode] ?? DARAJA_BASES.sandbox;
  return {
    tokenUrl: `${base}/oauth/v1/generate?grant_type=client_credentials`,
    tokenHeaders: {
      Authorization: `Basic ${btoa(`${env.DARAJA_CONSUMER_KEY}:${env.DARAJA_CONSUMER_SECRET}`)}`,
      "Content-Type": "application/json",
    },
    pushUrl: `${base}/mpesa/stkpush/v1/processrequest`,
    body: {
      BusinessShortCode: status.shortCode,
      Password: stkPassword({ shortCode: status.shortCode, passkey: env.DARAJA_PASSKEY, stamp }),
      Timestamp: stamp,
      TransactionType: status.transactionType,
      Amount: Math.max(1, Math.round(amountKes)),
      PartyA: phone,
      PartyB: status.shortCode,
      PhoneNumber: phone,
      CallBackURL: `${env.PUBLIC_BASE_URL}/v1/callbacks/mpesa?token=${encodeURIComponent(env.DARAJA_CALLBACK_TOKEN)}`,
      AccountReference: status.accountRef,
      TransactionDesc: `Habibi Haven ${reference}`,
    },
  };
}

/** Flat view of the callback, which nests its result parameters as a key/value array. */
export function readCallback(payload) {
  const cb = payload?.Body?.stkCallback ?? {};
  const params = {};
  for (const p of cb?.ResultParameters?.ResultParameter ?? []) {
    if (p && typeof p.Key === "string") params[p.Key] = p.Value;
  }
  return {
    merchantRequestId: typeof cb.MerchantRequestID === "string" ? cb.MerchantRequestID : null,
    checkoutRequestId: typeof cb.CheckoutRequestID === "string" ? cb.CheckoutRequestID : null,
    resultCode: Number.isInteger(cb.ResultCode) ? cb.ResultCode : null,
    resultDesc: typeof cb.ResultDesc === "string" ? cb.ResultDesc.slice(0, 200) : null,
    amountKes: Number.isFinite(params.Amount) ? params.Amount : null,
    receipt: typeof params.MpesaReceiptNumber === "string" ? params.MpesaReceiptNumber.slice(0, 40) : null,
  };
}

/**
 * Length-checked, byte-XOR compare for the callback token.
 *
 * `===` returns as soon as the first byte differs, which is measurable in principle. Whether anyone can
 * time a cold Worker that way is a fair question; the answer is that this costs one small function and
 * retires the question.
 */
export function tokenMatches(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function darajaError(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

/* -------------------------------------------------------------- the calls */

/**
 * Ask Safaricom to ring the customer's phone, then write what it answered.
 *
 * The throw on an unconfigured deployment is deliberate redundancy: index.mjs already refuses the route,
 * and this file refusing too means the payment path cannot be reached by a future caller that forgot the
 * guard. Nothing here sends a packet unless credentials exist.
 */
export async function initiateStkPush({ env, db, record, now = new Date(), fetchImpl = fetch }) {
  const status = paymentStatus(env);
  if (!status.configured)
    throw darajaError(`M-Pesa is not configured (missing: ${status.missing.join(", ")})`, status.code);
  if (!Number.isInteger(record.subtotalKes) || record.subtotalKes <= 0)
    throw darajaError("a request with no total cannot be paid", "nothing_to_pay");

  const call = buildStkRequest({
    env,
    status,
    phone: record.phone,
    amountKes: record.subtotalKes,
    reference: record.reference,
    now,
  });

  const tokenResponse = await fetchImpl(call.tokenUrl, { method: "GET", headers: call.tokenHeaders });
  if (!tokenResponse.ok) throw darajaError(`Daraja token request failed: HTTP ${tokenResponse.status}`, "token_failed");
  const token = (await tokenResponse.json().catch(() => null))?.access_token;
  if (typeof token !== "string" || !token) throw darajaError("Daraja returned no access token", "token_missing");

  const pushResponse = await fetchImpl(call.pushUrl, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(call.body),
  });
  const push = await pushResponse.json().catch(() => null);

  // Daraja answers HTTP 200 with a non-zero ResultCode for a request it rejected, so the status line is
  // not evidence anything happened. The audit row records whichever it was, including the failure.
  const resultCode = Number.isInteger(push?.ResultCode) ? push.ResultCode : null;
  const checkoutRequestId = typeof push?.CheckoutRequestID === "string" ? push.CheckoutRequestID : null;
  if (!checkoutRequestId)
    throw darajaError(
      `Daraja gave no CheckoutRequestID (ResultCode ${resultCode ?? "?"}: ${push?.ResultDesc ?? "no description"})`,
      "push_rejected",
    );
  const accepted = pushResponse.ok && resultCode === 0;

  await db.batch([
    insertPaymentStatement(db, {
      requestReference: record.reference,
      checkoutRequestId,
      merchantRequestId: typeof push?.MerchantRequestID === "string" ? push.MerchantRequestID : null,
      amountKes: call.body.Amount,
      phone: record.phone,
      state: accepted ? "initiated" : "failed",
      resultCode,
      resultDesc: typeof push?.ResultDesc === "string" ? push.ResultDesc.slice(0, 200) : null,
      initiatedAt: now.toISOString(),
    }),
    db.prepare("UPDATE requests SET payment_state = ? WHERE reference = ?").bind(accepted ? "initiated" : "failed", record.reference),
  ]);

  return { checkoutRequestId, accepted, resultCode, description: call.body.TransactionDesc };
}

/**
 * Safaricom's asynchronous answer to an STK push.
 *
 * Four checks, each answering a different way this could be a lie:
 *   1. the token in the URL. Not authorisation in the cryptographic sense — but the callback URL is the
 *      one thing Daraja lets you shape, and without it any passer-by could POST `ResultCode: 0` at an
 *      open endpoint and mark bills paid;
 *   2. the CheckoutRequestID must name a payment this server actually asked for, so an unknown id is
 *      refused rather than inserted;
 *   3. the amount must equal the total this server wrote down. A "successful" payment for less than the
 *      bill is not a paid bill;
 *   4. a row already verified is not verified twice — Safaricom retries, and receipts are unique.
 *
 * A genuine callback carries no signature over its contents, so (1) plus (3) is the defence: an attacker
 * needs the token to be believed at all, and even holding it cannot turn a partial payment into a settled
 * one.
 */
export async function verifyCallback({ env, db, token, payload, now = new Date() }) {
  const status = paymentStatus(env);
  if (!status.configured) throw darajaError("payments are not configured on this deployment", status.code);
  if (!tokenMatches(token ?? "", env.DARAJA_CALLBACK_TOKEN)) return { accepted: false, reason: "bad_token" };

  const cb = readCallback(payload);
  if (!cb.checkoutRequestId) return { accepted: false, reason: "no_checkout_id" };

  const payment = await readPayment(db, cb.checkoutRequestId);
  if (!payment) return { accepted: false, reason: "unknown_checkout_id" };
  if (payment.state === "verified") return { accepted: true, idempotent: true, receipt: payment.mpesa_receipt };

  if (cb.resultCode !== 0) {
    await db.batch(
      markFailedStatements(db, {
        requestReference: payment.request_reference,
        checkoutRequestId: cb.checkoutRequestId,
        resultCode: cb.resultCode,
        resultDesc: cb.resultDesc,
      }),
    );
    return { accepted: false, reason: "customer_did_not_pay", resultCode: cb.resultCode, resultDesc: cb.resultDesc };
  }

  if (!Number.isInteger(cb.amountKes) || cb.amountKes !== Number(payment.amount_kes))
    return { accepted: false, reason: "amount_mismatch", expectedKes: Number(payment.amount_kes), gotKes: cb.amountKes };
  if (!cb.receipt) return { accepted: false, reason: "no_receipt" };

  // The final check is against the request row rather than the payment row: if the catalog was reseeded
  // and this bill's total moved, the receipt matches the old amount and the money is not for this table.
  const record = await db
    .prepare("SELECT reference, subtotal_kes FROM requests WHERE reference = ?")
    .bind(payment.request_reference)
    .first();
  if (!record || Number(record.subtotal_kes) !== Number(payment.amount_kes))
    return { accepted: false, reason: "bill_moved", expectedKes: record ? Number(record.subtotal_kes) : null };

  await db.batch(
    markPaidStatements(db, {
      requestReference: payment.request_reference,
      checkoutRequestId: cb.checkoutRequestId,
      at: now.toISOString(),
      receipt: cb.receipt,
      resultCode: cb.resultCode,
      resultDesc: cb.resultDesc,
    }),
  );
  return { accepted: true, receipt: cb.receipt, amountKes: cb.amountKes };
}
