// backend/src/index.mjs — the whole HTTP surface of the Habibi Haven preview API.
//
// Five routes, each one existing because something on the site would otherwise be a claim the server
// could not keep:
//
//   GET  /health                                 is the D1 binding wired, is the catalog seeded, are
//                                                 payments off? Read by the post-deploy probe, and by
//                                                 nothing on the page.
//   POST /v1/requests                            record a built table or a reservation. Totals come from
//                                                 the server's own price list, never from the body.
//   GET  /v1/requests/:reference                 the guest's receipt, by the reference they were handed.
//                                                 There is no list route: an endpoint that hands back many
//                                                 requests to anyone who asks is a data leak with a nice URL.
//   POST /v1/requests/:reference/payments        M-Pesa STK push. 503 while credentials are absent.
//   POST /v1/callbacks/mpesa                     Safaricom's answer. Same 503, same four checks when on.
//
// What CORS does and does not do here: the allowlist stops a stranger's page from *reading* a response.
// It has never stopped a POST — any browser can send one and ignore the reply — so the routes that write
// are defended by validation, size limits and the two rate limits below, not by the origin header.
//
// Deploy: `npx wrangler deploy` from `backend/`, D1 binding in backend/wrangler.toml. The static site
// stays on Pages; this is its only server-side half.

import { LIMITS, parseRequest } from "./validate.mjs";
import {
  CatalogProblem,
  REFERENCE_ALPHABET,
  REFERENCE_LENGTH,
  insertRequest,
  lastRequestAt,
  makeReference,
  readCatalog,
  readRequest,
} from "./store.mjs";
import { initiateStkPush, paymentStatus, verifyCallback } from "./mpesa.mjs";

const MAX_BODY_CHARS = 16_384; // the largest legitimate table here is a few hundred bytes
// Derived from the alphabet the generator uses, not written out by hand: a pattern typed separately is a
// second copy of that set, and the two drifted — the generator could hand out `HH-J7GSQ5`, with an S that
// this router's ranges did not cover, and the guest's own receipt link answered 400.
const REFERENCE_RE = new RegExp(`^HH-[${REFERENCE_ALPHABET}]{${REFERENCE_LENGTH}}$`, "i");
const MIN_SECONDS_PER_PHONE = 20;
const IP_WINDOW_MS = 60_000;
const IP_WINDOW_LIMIT = 12;

const DEFAULT_ALLOWED_ORIGINS = ["https://habibihavenpreview.pages.dev"];
const PROJECT_SUBDOMAIN = ".habibihavenpreview.pages.dev"; // every direct-upload deployment gets one

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const origin = request.headers.get("origin");
    const method = request.method.toUpperCase();
    const segments = url.pathname.split("/").filter(Boolean).map((s) => s.toLowerCase());

    if (method === "OPTIONS") return cors(new Response(null, { status: 204 }), origin, env);

    try {
      if (method === "GET" && (segments.length === 0 || segments[0] === "health"))
        return cors(json({ ok: true, service: "habibi-haven-api", ...(await health(env)) }), origin, env);

      if (segments[0] === "v1" && segments[1] === "requests" && segments.length === 2) {
        if (method === "POST") return await createRequest({ request, env, now: new Date(), ip: clientIp(request), origin });
        // Not a 404: the path exists and there is deliberately nothing to read there. Saying "no list
        // endpoint" is a truer answer than "no such endpoint", and it is the answer a curious caller should
        // get rather than a guess that they mistyped.
        return cors(json({ code: "bad_route", message: "GET has no answer here: requests are read by their reference, never as a list." }, 405), origin, env);
      }

      if (segments[0] === "v1" && segments[1] === "requests" && segments.length === 3) {
        const reference = segments[2];
        if (method === "GET") return await getOne({ env, reference, origin });
        return cors(json({ code: "bad_route", message: "Record with POST /v1/requests, pay with POST /v1/requests/:reference/payments." }, 405), origin, env);
      }

      if (segments[0] === "v1" && segments[1] === "requests" && segments.length === 4 && segments[3] === "payments") {
        if (method === "POST") return await startPayment({ env, reference: segments[2], origin });
        return cors(json({ code: "bad_route", message: "Ask for a payment with POST." }, 405), origin, env);
      }

      if (segments[0] === "v1" && segments[1] === "callbacks" && segments[2] === "mpesa") {
        if (method === "POST") return await mpesaCallback({ request, env, url, now: new Date(), origin });
        return cors(json({ code: "bad_route", message: "Safaricom posts the callback; nothing else is accepted here." }, 405), origin, env);
      }

      return cors(json({ code: "not_found", message: "No such endpoint." }, 404), origin, env);
    } catch (error) {
      if (error instanceof CatalogProblem)
        return cors(
          json({ code: "catalog_unavailable", message: "The server could not read its own price list, so it will not quote one." }, 503),
          origin,
          env,
        );
      if (error?.code === "payments_not_configured")
        return cors(
          json({ code: error.code, message: "This build can record a request but not take money.", missing: error.missing ?? [] }, 503),
          origin,
          env,
        );
      if (error?.code === "nothing_to_pay" || error?.code === "push_rejected" || error?.code === "token_failed" || error?.code === "token_missing")
        // Daraja said no. The guest's request is still recorded, so this is not a lost booking — say which.
        return cors(json({ code: error.code, message: error.message, requestStillRecorded: true }, 502), origin, env);
      // Never forward an exception message: it can carry a table name, a bound value or a token.
      console.error(`unhandled ${method} ${url.pathname}`, error?.stack ?? error);
      return cors(
        json({ code: "server_error", message: "Something broke on our side. Nothing was recorded — try again, or send it on WhatsApp." }, 500),
        origin,
        env,
      );
    }
  },
};

/* --------------------------------------------------------------- handlers */

async function health(env) {
  let catalog = { items: 0, dataStamp: null, hoursOfRecord: null };
  let catalogError = null;
  try {
    const c = await readCatalog(env.DB);
    catalog = { items: c.items.size, dataStamp: c.dataStamp, hoursOfRecord: { open: c.hours.open, close: c.hours.close } };
  } catch (error) {
    if (!(error instanceof CatalogProblem)) throw error;
    catalogError = error.message;
  }
  const payments = paymentStatus(env);
  return {
    ok: catalogError === null,
    catalog,
    catalogError,
    payments: { configured: payments.configured, mode: payments.mode, missing: payments.missing },
  };
}

async function createRequest({ request, env, now, ip, origin }) {
  const input = await readJson(request, origin, env);
  if (input.response) return input.response;

  const catalog = await readCatalog(env.DB);
  const parsed = parseRequest(input.body, { items: catalog.items, hours: catalog.hours, now });
  if (!parsed.ok) return cors(json({ code: "invalid", message: "Some of that needs fixing.", errors: parsed.errors }, 422), origin, env);

  const value = parsed.value;

  // Two limits, because they stop two different things. The in-memory one is per-isolate and best effort:
  // it cannot be trusted to be global, and it is offered as a speed bump rather than as a defence. The
  // database one is the real answer — the same phone cannot record twice inside MIN_SECONDS_PER_PHONE no
  // matter which isolate or region the request landed on.
  const blocked = throttle(ip, now);
  if (blocked)
    return cors(json({ code: "slow_down", message: "Too many at once. Wait a minute.", retry_after_seconds: blocked.retryAfter }, 429), origin, env);

  const previous = await lastRequestAt(env.DB, value.phone);
  if (previous) {
    const ago = (now.getTime() - Date.parse(previous)) / 1000;
    if (Number.isFinite(ago) && ago >= 0 && ago < MIN_SECONDS_PER_PHONE) {
      const wait = Math.ceil(MIN_SECONDS_PER_PHONE - ago);
      return cors(json({ code: "slow_down", message: `You just sent one of these. Give it ${wait} seconds.`, retry_after_seconds: wait }, 429), origin, env);
    }
  }

  const createdAt = now.toISOString();
  let written = await insertRequest(env.DB, value, { reference: makeReference(), createdAt });
  // A repeated reference is possible in the way that any random draw is possible; the UNIQUE constraint
  // rolled the whole batch back, so the honest fix is a second draw rather than a second opinion.
  if (!written) written = await insertRequest(env.DB, value, { reference: makeReference(), createdAt });
  if (!written) return cors(json({ code: "not_recorded", message: "Nothing was saved. Try again, or send it on WhatsApp." }, 500), origin, env);

  return cors(
    json(
      {
        ok: true,
        reference: written.reference,
        kind: value.kind,
        recordedAt: createdAt,
        currency: "KES",
        totalKes: value.subtotal,
        itemCount: value.itemCount,
        lineCount: value.lineCount,
        party: value.party,
        visitAt: value.visitAt ?? null,
        whenLabel: value.whenLabel ?? null,
        unavailableCount: value.unavailableCount,
        lines: value.rows.map((row) => ({
          itemId: row.id,
          name: row.name,
          option: row.option ?? null,
          unitKes: row.unit,
          qty: row.qty,
          amountKes: row.amount,
          available: row.available,
        })),
        // The page's number and ours are both kept, and the gap is told to the guest in the confirmation
        // rather than buried: the price list moves, and nobody should find out at the table.
        priceDrift: value.priceDelta === null ? null : { claimedKes: value.claimed, serverKes: value.subtotal, deltaKes: value.priceDelta },
        hoursOfRecord: { open: catalog.hours.open, close: catalog.hours.close },
        payments: paymentResponse(env),
        limits: { partyMax: LIMITS.partyMax, qtyMax: LIMITS.qtyMax, linesMax: LIMITS.linesMax, horizonDays: LIMITS.horizonDays },
      },
      201,
    ),
    origin,
    env,
  );
}

async function getOne({ env, reference, origin }) {
  const shaped = shapedReference(reference, origin, env);
  if (shaped) return shaped;
  const found = await readRequest(env.DB, reference.toUpperCase());
  if (!found) return cors(json({ code: "not_found", message: "We have no request with that reference." }, 404), origin, env);

  const record = found.record;
  return cors(
    json({
      ok: true,
      reference: record.reference,
      kind: record.kind,
      status: record.status,
      recordedAt: record.created_at,
      currency: "KES",
      totalKes: record.subtotal_kes,
      itemCount: record.item_count,
      lineCount: record.line_count,
      party: record.party_size,
      visitAt: record.visit_at,
      whenLabel: record.when_label,
      notes: record.notes,
      unavailableCount: record.unavailable_count,
      claimedKes: record.claimed_subtotal_kes,
      priceDeltaKes: record.price_delta_kes,
      paymentState: record.payment_state,
      lines: found.lines.map((line) => ({
        itemId: line.item_id,
        name: line.item_name,
        option: line.option_label,
        unitKes: line.unit_kes,
        qty: line.qty,
        amountKes: line.amount_kes,
        available: Number(line.available) !== 0,
      })),
      payments: paymentResponse(env),
    }),
    origin,
    env,
  );
}

async function startPayment({ env, reference, origin }) {
  const status = paymentStatus(env);
  if (!status.configured)
    return cors(json({ code: status.code, message: "This build records requests; it cannot take money yet.", missing: status.missing }, 503), origin, env);
  const shaped = shapedReference(reference, origin, env);
  if (shaped) return shaped;

  const row = await env.DB
    .prepare("SELECT reference, contact_phone, subtotal_kes, payment_state FROM requests WHERE reference = ?")
    .bind(reference.toUpperCase())
    .first();
  if (!row) return cors(json({ code: "not_found", message: "We have no request with that reference." }, 404), origin, env);
  if (row.payment_state !== "none")
    return cors(json({ code: "payment_already", message: "That request already has a payment on it.", state: row.payment_state }, 409), origin, env);

  const result = await initiateStkPush({
    env,
    db: env.DB,
    record: { reference: row.reference, phone: row.contact_phone, subtotalKes: row.subtotal_kes },
  });
  return cors(json({ ok: true, code: "stk_initiated", ...result, payments: paymentResponse(env) }, 202), origin, env);
}

async function mpesaCallback({ request, env, url, now, origin }) {
  const status = paymentStatus(env);
  if (!status.configured) return cors(json({ code: status.code, message: "No payment endpoint is open on this build." }, 503), origin, env);

  const input = await readJson(request, origin, env);
  if (input.response) return input.response;

  const result = await verifyCallback({ env, db: env.DB, token: url.searchParams.get("token"), payload: input.body, now });
  if (!result.accepted) console.warn("mpesa callback refused", { reason: result.reason, code: result.resultCode ?? null });

  // Daraja expects HTTP 200 with this envelope or it retries a notification it considers unanswered —
  // including one we refused. The verdict therefore lives in our audit trail and our logs, not in the
  // status code we hand back to Safaricom.
  return cors(json({ ResultCode: 0, ResultDesc: "Accepted" }), origin, env);
}

/**
 * What the site is allowed to promise about money.
 *
 * `available: false` comes from the server rather than from the page so that the promise cannot outlive
 * the deployment: if payments are ever switched on here, every confirmation screen changes its wording on
 * the next build, and no copy edit is what keeps the claim true.
 */
function paymentResponse(env) {
  const status = paymentStatus(env);
  return {
    available: false,
    state: "none",
    configured: status.configured,
    mode: status.mode,
    code: status.configured ? "not_yet_enabled" : status.code,
    message: status.configured
      ? "M-Pesa is configured on this deployment but not offered to guests yet."
      : "This build can record a request but cannot take money.",
  };
}

/* ------------------------------------------------------------------ input */

async function readJson(request, origin, env) {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json"))
    return { response: cors(json({ code: "bad_content_type", message: "Send application/json." }, 415), origin, env) };
  const text = await request.text();
  if (text.length > MAX_BODY_CHARS)
    return { response: cors(json({ code: "too_large", message: "That request is bigger than this endpoint takes." }, 413), origin, env) };
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    return { response: cors(json({ code: "bad_json", message: "That is not JSON." }, 400), origin, env) };
  }
  return { body };
}

function shapedReference(reference, origin, env) {
  if (REFERENCE_RE.test(reference ?? "")) return null;
  return cors(json({ code: "bad_reference", message: "A reference looks like HH-4KQ7MR." }, 400), origin, env);
}

function clientIp(request) {
  return request.headers.get("cf-connecting-ip") ?? "unknown";
}

const buckets = new Map();
function throttle(ip, now) {
  const ms = now.getTime();
  if (buckets.size > 4096) for (const [key, value] of buckets) if (value.until <= ms) buckets.delete(key);
  const entry = buckets.get(ip);
  if (!entry || entry.until <= ms) {
    buckets.set(ip, { count: 1, until: ms + IP_WINDOW_MS });
    return null;
  }
  entry.count += 1;
  if (entry.count > IP_WINDOW_LIMIT) return { retryAfter: Math.max(1, Math.ceil((entry.until - ms) / 1000)) };
  return null;
}

/* ----------------------------------------------------------------- output */

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      // no-store on every response. A receipt served out of a shared cache to the next guest is the worst
      // possible outcome of a caching default nobody chose on purpose.
      "Cache-Control": "no-store, max-age=0",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

function allowedOrigin(origin, env) {
  if (typeof origin !== "string" || !origin) return null; // same-origin, curl, Safaricom: nothing to allow
  let parsed;
  try {
    parsed = new URL(origin);
  } catch {
    return null;
  }
  const explicit = String(env.ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const list = [...DEFAULT_ALLOWED_ORIGINS, ...explicit];
  const isLocal = (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1") && parsed.protocol === "http:";
  const isProject = parsed.hostname.endsWith(PROJECT_SUBDOMAIN);
  return list.includes(origin) || isLocal || isProject ? origin : null;
}

function cors(response, origin, env) {
  const allowed = allowedOrigin(origin, env);
  if (!allowed) return response;
  const headers = new Headers(response.headers);
  headers.set("Access-Control-Allow-Origin", allowed);
  headers.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  headers.set("Access-Control-Allow-Headers", "Content-Type");
  headers.set("Access-Control-Max-Age", "600");
  headers.set("Vary", "Origin");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}
