-- 20261116_0001_init.sql — the shape of the server side, applied by `wrangler d1 migrations apply DB`.
--
-- This file is the schema. tests/api.mjs executes this exact text against real SQLite (`node:sqlite`),
-- so there is one copy of the truth and it is proven on a laptop before it is ever deployed. There is no
-- second "readable" schema file, because a second file is a second thing to keep in step.
--
-- Four tables, and each exists for one reason:
--
--   prices        the money the server is allowed to quote. Seeded from the same content build that
--                 writes site/src/data/menu.json, so the site and the API cannot disagree about a price
--                 without the build failing first. A quote taken from the browser is not a quote.
--   settings      the facts the server has to enforce but must not re-type (today: the hours of record).
--                 Data at deploy time, not constants in code — the same argument the menu rests on.
--   requests      one row per guest request; request_lines is its bill. `reference` is what the guest is
--                 given and quotes back on WhatsApp, and it is the only handle to a row — there is
--                 deliberately no endpoint that lists rows (backend/src/index.mjs).
--   payments      the M-Pesa audit trail. Empty until Daraja credentials exist: the code path is written
--                 and unit-tested against a mocked Daraja, and nothing here has been exercised.
--
-- Children point at `reference`, not at the integer id. The reference is generated before the write and
-- is already UNIQUE and NOT NULL, so a header and its lines are staged in one pass and committed in one
-- batch. With an id-valued foreign key the lines could not be staged until the header had been written,
-- which is how a bill ends up with no header, or a header with no bill.

CREATE TABLE IF NOT EXISTS prices (
  item_id     TEXT    NOT NULL PRIMARY KEY,
  name        TEXT    NOT NULL,
  unit_kes    INTEGER NOT NULL CHECK (unit_kes >= 0),
  available   INTEGER NOT NULL DEFAULT 1 CHECK (available IN (0, 1)),
  updated_at  TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  key         TEXT    NOT NULL PRIMARY KEY,
  value       TEXT    NOT NULL,
  updated_at  TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS requests (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  reference             TEXT    NOT NULL UNIQUE,
  kind                  TEXT    NOT NULL CHECK (kind IN ('table', 'reservation')),
  status                TEXT    NOT NULL DEFAULT 'recorded' CHECK (status IN ('recorded', 'cancelled')),
  party_size            INTEGER CHECK (party_size BETWEEN 1 AND 30),
  visit_at              TEXT,
  when_label            TEXT,
  contact_name          TEXT    NOT NULL,
  contact_phone         TEXT    NOT NULL,
  notes                 TEXT,
  subtotal_kes          INTEGER NOT NULL CHECK (subtotal_kes >= 0),
  line_count            INTEGER NOT NULL CHECK (line_count >= 0),
  item_count            INTEGER NOT NULL CHECK (item_count >= 0),
  unavailable_count     INTEGER NOT NULL DEFAULT 0,
  claimed_subtotal_kes  INTEGER,
  price_delta_kes       INTEGER,
  source_url            TEXT,
  payment_state         TEXT    NOT NULL DEFAULT 'none' CHECK (payment_state IN ('none', 'initiated', 'verified', 'failed')),
  created_at            TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS request_lines (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  request_reference TEXT    NOT NULL REFERENCES requests (reference),
  item_id           TEXT    NOT NULL,
  item_name         TEXT    NOT NULL,
  option_label      TEXT,
  unit_kes          INTEGER NOT NULL CHECK (unit_kes >= 0),
  qty               INTEGER NOT NULL CHECK (qty >= 1),
  amount_kes        INTEGER NOT NULL CHECK (amount_kes >= 0),
  available         INTEGER NOT NULL DEFAULT 1 CHECK (available IN (0, 1))
);

CREATE TABLE IF NOT EXISTS payments (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  request_reference    TEXT    NOT NULL REFERENCES requests (reference),
  checkout_request_id  TEXT    NOT NULL UNIQUE,
  merchant_request_id  TEXT,
  mpesa_receipt        TEXT,
  amount_kes           INTEGER NOT NULL CHECK (amount_kes >= 0),
  phone                TEXT    NOT NULL,
  state                TEXT    NOT NULL CHECK (state IN ('initiated', 'succeeded', 'failed', 'verified')),
  result_code          INTEGER,
  result_desc          TEXT,
  initiated_at         TEXT    NOT NULL,
  verified_at          TEXT,
  callback_digest      TEXT
);

-- The reads that are not by primary key: a guest looking up their own reference, and the abuse backstop
-- that asks when this phone last asked.
CREATE INDEX IF NOT EXISTS requests_phone_recent ON requests (contact_phone, created_at);
CREATE INDEX IF NOT EXISTS requests_recent ON requests (created_at DESC);
CREATE INDEX IF NOT EXISTS lines_of_request ON request_lines (request_reference);
