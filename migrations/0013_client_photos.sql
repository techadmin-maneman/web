-- Migration number: 0013
-- A client's photographs: five angles before a visit and five after
-- (docs/decisions/0032-fsm-mirror.md). The images are in the client-photos
-- bucket, which has no lifecycle rule: a photograph is deleted only on
-- purpose, and audited. Only new tables, so the code already deployed is
-- unaffected.

CREATE TABLE photo_sets (
  id TEXT PRIMARY KEY,
  appointment_id TEXT NOT NULL REFERENCES appointments (id),
  phase TEXT NOT NULL CHECK (phase IN ('before', 'after')),
  created_at TEXT NOT NULL,
  UNIQUE (appointment_id, phase)
);

CREATE TABLE photos (
  id TEXT PRIMARY KEY,
  photo_set_id TEXT NOT NULL REFERENCES photo_sets (id),
  angle TEXT NOT NULL CHECK (angle IN ('front', 'top', 'left', 'right', 'hair')),
  r2_key TEXT NOT NULL UNIQUE,
  content_type TEXT NOT NULL CHECK (content_type IN ('image/jpeg', 'image/png')),
  bytes INTEGER NOT NULL,
  -- NULL when the image's header does not say.
  width INTEGER,
  height INTEGER,
  taken_at TEXT NOT NULL,
  -- The FSM attachment it came from, while photographs are taken in FSM's own app.
  fsm_attachment_id TEXT UNIQUE,
  created_at TEXT NOT NULL,
  UNIQUE (photo_set_id, angle)
);
