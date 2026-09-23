-- Migration number: 0027
-- What P2-M4 needs beyond migration 0026: the pieces tab's mirror, the two
-- columns on technicians the dispatch board and the technician login read, and
-- the technician a one-time code belongs to
-- (docs/prompts/phase2-backend.md, "Data model additions"; the plan's P2-M4).
--
-- A piece is an asset in FSM, and FSM stays its record: the table below is the
-- mirror the pieces tab and the label lookup read, written from FSM's assets
-- and never edited on its own (ADR 0032). Only new tables and new columns, so
-- the code already deployed is unaffected.

-- "For each piece: code, base, fitted date, supplier lot, replacement due date,
-- and failure with reason, all from FSM assets."
CREATE TABLE pieces (
  id TEXT PRIMARY KEY,
  fsm_id TEXT NOT NULL UNIQUE,
  person_id TEXT REFERENCES people (id),
  -- FSM's Asset_Number: the label on the piece, e.g. MM-STD-4417-B. The format
  -- is a placeholder until the owner sets it (docs/open-points.md, item 25).
  piece_code TEXT NOT NULL,
  -- The base the piece is built on, from the part item FSM's asset names.
  base TEXT,
  supplier_lot TEXT,
  fitted_at TEXT,
  -- fitted_at plus the base's cycle (src/config/pieces.ts); NULL until it is fitted.
  replacement_due_at TEXT,
  -- The visit it was fitted on, where we wrote it ourselves.
  appointment_id TEXT REFERENCES appointments (id),
  failed_at TEXT,
  -- From the job sheet once its template exists (docs/open-points.md, item 13).
  failure_reason TEXT,
  synced_at TEXT NOT NULL,
  -- Set when FSM no longer has the asset.
  deleted_at TEXT
);

CREATE INDEX pieces_by_person ON pieces (person_id, fitted_at);
CREATE INDEX pieces_by_code ON pieces (piece_code);

-- The zone migration 0026 left for the code that reads it: the dispatch board
-- groups technicians by it, and FSM calls it a territory. NULL until each
-- technician has one there (docs/open-points.md, item 12).
ALTER TABLE technicians ADD COLUMN zone TEXT;

-- "Mobile number plus a one-time code, the same flow as clients but a separate
-- role" (src/policy/technician-login.ts). The number comes from the technician's
-- FSM user, which is also what makes him "an active field technician": nobody
-- logs in whom FSM does not list. NULL for a user with no number on his FSM
-- record, who then cannot log in (docs/open-points.md, item 12).
ALTER TABLE technicians ADD COLUMN mobile_e164 TEXT;

CREATE INDEX technicians_by_mobile ON technicians (mobile_e164);

-- A technician's login code. The challenge is otherwise the client's
-- (migration 0007): same table, same lifetime, same five wrong attempts.
--
-- Two columns, not one. technician_login says whose login the row belongs to,
-- and each login reads only its own rows; technician_id says which technician,
-- and is NULL for a number FSM does not list, exactly as person_id is NULL for
-- a number with no booking. Without the first column a challenge for an
-- unrecognised number could not be told from a client's, and the answer for a
-- number FSM lists would differ from the answer for one it does not.
ALTER TABLE otp_challenges ADD COLUMN technician_login INTEGER NOT NULL DEFAULT 0 CHECK (technician_login IN (0, 1));

ALTER TABLE otp_challenges ADD COLUMN technician_id TEXT REFERENCES technicians (id);
