-- Migration number: 0021
-- Referral and waitlist (docs/decisions/0048-referrals.md): the pincodes we
-- serve, each client's referral code, who came through whose invite, the
-- append-only credit ledger (docs/decisions/0033-credit-ledger.md), and the
-- waitlist. Only new tables, so the code already deployed is unaffected.

-- One row per pincode, loaded from data/pincodes by scripts/import-pincodes.ts.
CREATE TABLE serviceable_pincodes (
  pincode TEXT PRIMARY KEY,
  -- The area a client would recognise ("Saket"), and the city.
  area TEXT NOT NULL,
  city TEXT NOT NULL,
  served INTEGER NOT NULL DEFAULT 0 CHECK (served IN (0, 1)),
  -- When a technician started coming, or will start.
  launched_at TEXT
);

-- A client's code: random, never from their mobile number. The card is the
-- house sample until they upload their own; each upload or revoke is a new
-- version, since WhatsApp caches a preview by its URL.
CREATE TABLE referral_codes (
  code TEXT PRIMARY KEY,
  person_id TEXT NOT NULL UNIQUE REFERENCES people (id),
  card_state TEXT NOT NULL DEFAULT 'house' CHECK (card_state IN ('house', 'personal')),
  card_version INTEGER NOT NULL DEFAULT 1,
  card_key TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- A person who came through an invite: once, whoever's invite they used first.
CREATE TABLE referral_attributions (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL REFERENCES referral_codes (code),
  referred_person_id TEXT NOT NULL UNIQUE REFERENCES people (id),
  first_touch_at TEXT NOT NULL,
  -- How they came: a consultation booked, or a place on the waitlist.
  via TEXT NOT NULL CHECK (via IN ('consultation', 'waitlist')),
  pincode TEXT,
  consultation_appointment_id TEXT REFERENCES appointments (id),
  first_fit_appointment_id TEXT REFERENCES appointments (id),
  -- pending: not fitted yet; held: waiting for ops' review; approved and granted; rejected; expired: the invite
  -- lapsed, so a consultation but no credits; clawed_back: the first fit was refunded under the guarantee.
  grant_state TEXT NOT NULL DEFAULT 'pending'
    CHECK (grant_state IN ('pending', 'held', 'approved', 'rejected', 'granted', 'expired', 'clawed_back')),
  -- Why a grant was held: a JSON list of the fraud rules it met.
  fraud_signals TEXT,
  review_reason TEXT,
  reviewed_by TEXT,
  reviewed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX referral_attributions_by_code ON referral_attributions (code, created_at);

-- Service-visit credits, entry by entry; a balance is always summed, never kept. A grant adds visits with an
-- expiry; each redeem, restore, expire or clawback names the grant it draws on, so credits are spent oldest
-- grant first and each keeps its own expiry. An adjust is ops' correction.
CREATE TABLE credit_ledger (
  id TEXT PRIMARY KEY,
  person_id TEXT NOT NULL REFERENCES people (id),
  kind TEXT NOT NULL CHECK (kind IN ('grant', 'redeem', 'restore', 'expire', 'clawback', 'adjust')),
  -- Signed: a grant or a restore adds, the others take away.
  visits INTEGER NOT NULL,
  grant_id TEXT REFERENCES credit_ledger (id),
  -- Where it came from: a referral attribution, an appointment, ops, or the pre-January import.
  source_kind TEXT NOT NULL CHECK (source_kind IN ('referral', 'appointment', 'ops', 'import')),
  source_id TEXT NOT NULL,
  expires_at TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX credit_ledger_by_person ON credit_ledger (person_id, created_at);
CREATE INDEX credit_ledger_by_grant ON credit_ledger (grant_id);
-- A source grants a person once, and an appointment redeems or restores a credit once.
CREATE UNIQUE INDEX credit_ledger_one_grant ON credit_ledger (person_id, source_kind, source_id) WHERE kind = 'grant';
CREATE UNIQUE INDEX credit_ledger_one_use ON credit_ledger (source_id, kind) WHERE kind IN ('redeem', 'restore');

CREATE TRIGGER credit_ledger_no_update BEFORE UPDATE ON credit_ledger
BEGIN
  SELECT RAISE(ABORT, 'credit_ledger is append-only');
END;

CREATE TRIGGER credit_ledger_no_delete BEFORE DELETE ON credit_ledger
BEGIN
  SELECT RAISE(ABORT, 'credit_ledger is append-only');
END;

-- Someone waiting for us to reach their pincode.
CREATE TABLE waitlist_entries (
  id TEXT PRIMARY KEY,
  pincode TEXT NOT NULL,
  person_id TEXT NOT NULL REFERENCES people (id),
  referral_code TEXT REFERENCES referral_codes (code),
  contact_consent_at TEXT NOT NULL,
  -- Whether they asked to be told when we launch there, and when we told them.
  launch_alert INTEGER NOT NULL DEFAULT 0 CHECK (launch_alert IN (0, 1)),
  alerted_at TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (pincode, person_id)
);

CREATE INDEX waitlist_entries_by_pincode ON waitlist_entries (pincode, created_at);
