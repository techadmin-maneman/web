-- Migration number: 0026
-- Field operations (docs/prompts/phase2-backend.md, "Data model additions",
-- "Field operations"; the plan's P2-M4). These tables hold what FSM has no
-- place for: the phones technicians work from, their check-ins, the evidence
-- behind a no-show, the offline queue's events, a job's consumables, and the
-- moves ops make on the board. Everything FSM does hold is still written to
-- FSM, so none of these is a second source of truth (ADR 0032).
--
-- P2-M4's seventh table, slot_claims, already exists (migration 0016): the
-- clash check and self-serve booking share it (ADR 0034).
--
-- The prompt's list also has two tables we already hold, and this migration
-- alters neither. addresses has lat, lng and geocoded_at since migration 0008.
-- technicians is still to gain the zone FSM calls a territory; it waits on the
-- territories being set there (docs/open-points.md, item 12), and nothing here
-- reads it, so it comes with the code that does.
--
-- The milestone itself waits on Zoho's licensing answer
-- (docs/decisions/fsm-licensing.md; docs/open-points.md, item 15). The schema
-- and the rules in src/policy/ do not, and land first. Only new tables, so the
-- code already deployed is unaffected.

-- The phones technicians work from: "His sessions are bound to a device and can
-- be revoked by ops. Revoking also wipes the device's cached jobs on its next
-- contact" (src/policy/technician-login.ts). A device that has been revoked
-- learns it the next time it calls, and says when it dropped its cached jobs.
-- The session it binds to is the one ADR 0029 defines; revoking is an ops
-- action, so it is audited like the rest of them (ADR 0031).
CREATE TABLE technician_devices (
  id TEXT PRIMARY KEY,
  technician_id TEXT NOT NULL REFERENCES technicians (id),
  -- The app's own ID for the phone, kept in its storage. Never a hardware serial.
  device_id TEXT NOT NULL,
  -- The session it logged in with (migration 0007); NULL once that session ended.
  session_id TEXT REFERENCES sessions (id),
  -- What the browser said it was at login, e.g. "Chrome on Android".
  label TEXT,
  created_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  revoked_at TEXT,
  -- The Access identity of the ops user who revoked it (ADR 0031).
  revoked_by TEXT,
  -- When the device confirmed it had dropped its cached jobs.
  wiped_at TEXT,
  -- One row per phone per technician; a fresh login reuses it.
  UNIQUE (technician_id, device_id)
);

CREATE INDEX technician_devices_by_session ON technician_devices (session_id);

-- "I have arrived records the time and the device's position, and passes only
-- within config CHECKIN_RADIUS_M (200 m) of the address" (src/policy/check-in.ts).
-- A row is written whether the check-in passed or not, with the distance measured
-- and the radius in force, "so the value can be tuned from real data". The 200 m
-- is a placeholder the owner must rule (docs/open-points.md, item 46). The
-- address's coordinates come from the geocoder chosen in item 26; without them
-- there is nothing to measure against.
CREATE TABLE checkins (
  id TEXT PRIMARY KEY,
  appointment_id TEXT NOT NULL REFERENCES appointments (id),
  technician_id TEXT NOT NULL REFERENCES technicians (id),
  -- The address measured against (migration 0008 holds its lat and lng).
  address_id TEXT REFERENCES addresses (id),
  at TEXT NOT NULL,
  -- Where the phone said it was.
  lat REAL NOT NULL,
  lng REAL NOT NULL,
  -- What the phone claimed of its own fix, in metres; NULL where it said nothing.
  accuracy_m REAL,
  distance_m INTEGER NOT NULL CHECK (distance_m >= 0),
  radius_m INTEGER NOT NULL CHECK (radius_m > 0),
  passed INTEGER NOT NULL CHECK (passed IN (0, 1)),
  created_at TEXT NOT NULL
);

CREATE INDEX checkins_by_appointment ON checkins (appointment_id, at);

-- The evidence ops rule a no-show on: "Ops then receive three facts: check-in
-- time, distance, and the delivery receipt of the day-before or arrival WhatsApp
-- to the client" (src/policy/no-show.ts). "The charge is applied by ops from the
-- evidence, never automatically", so a case opens undecided and stays that way
-- until a person rules on it. The wait each case runs is a placeholder of 15
-- minutes for every visit type (docs/open-points.md, item 47), which is why the
-- wait's start and end are stored rather than computed from the visit type.
CREATE TABLE no_show_cases (
  id TEXT PRIMARY KEY,
  -- The check-in the wait ran from; one case per check-in.
  checkin_id TEXT NOT NULL UNIQUE REFERENCES checkins (id),
  appointment_id TEXT NOT NULL REFERENCES appointments (id),
  wait_started_at TEXT NOT NULL,
  -- When "Close as no-show" becomes possible, and when the technician used it.
  wait_ends_at TEXT NOT NULL,
  closed_at TEXT,
  -- The third fact: the WhatsApp ops read the receipt of, and what the BSP reported.
  message_id TEXT REFERENCES outbound_messages (id),
  message_delivered_at TEXT,
  -- Charged under the 24-hour policy (src/policy/moving-a-visit.ts), or waived.
  decision TEXT NOT NULL DEFAULT 'undecided' CHECK (decision IN ('undecided', 'charged', 'waived')),
  -- The Access identity of the ops user who ruled (ADR 0031).
  decided_by TEXT,
  decided_at TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX no_show_cases_by_decision ON no_show_cases (decision, created_at);

-- The technician app's offline queue: writes are "queued on the device with a
-- client-generated ID, and sent in order when the phone is back online. The
-- server makes each write idempotent on that ID before passing it to FSM." The
-- ID is unique per job, so a replayed event lands once. A job FSM changed
-- underneath is rejected as superseded, and nothing is merged silently.
CREATE TABLE job_events (
  id TEXT PRIMARY KEY,
  appointment_id TEXT NOT NULL REFERENCES appointments (id),
  -- The device's own ID for the event: what the replay is made idempotent on.
  event_id TEXT NOT NULL,
  technician_id TEXT NOT NULL REFERENCES technicians (id),
  device_id TEXT REFERENCES technician_devices (id),
  -- The in-job steps, in the order they are taken (src/policy/in-job-steps.ts).
  kind TEXT NOT NULL CHECK (
    kind IN ('check_in', 'start', 'before_photos', 'checklist', 'consumables', 'piece', 'after_photos', 'outcome')
  ),
  -- The event's own fields, as JSON, as the device sent them.
  body TEXT NOT NULL,
  -- The phone's clock, kept as evidence; ours, which orders the queue.
  occurred_at TEXT NOT NULL,
  received_at TEXT NOT NULL,
  -- FSM is written first, and the mirror only after FSM accepts (ADR 0032).
  fsm_write_state TEXT NOT NULL DEFAULT 'pending' CHECK (fsm_write_state IN ('pending', 'written', 'rejected')),
  -- No personal data: FSM's status and message only.
  fsm_error TEXT,
  -- Set when FSM had changed underneath, say ops reassigned the job while the
  -- phone was offline. The technician is shown what changed; the write is refused.
  superseded INTEGER NOT NULL CHECK (superseded IN (0, 1)) DEFAULT 0,
  updated_at TEXT NOT NULL,
  -- A replayed event lands once.
  UNIQUE (appointment_id, event_id)
);

CREATE INDEX job_events_unwritten ON job_events (fsm_write_state, received_at);

-- "Consumables used, with quantities" (src/policy/in-job-steps.ts), step 3 of a
-- job. FSM's job sheet is the record; this is what the technician entered, kept
-- so the write can be replayed and so ops can count stock. The item list is
-- FSM's catalogue once the job-sheet template exists (docs/open-points.md, item
-- 13), so until then the name is kept as the technician entered it.
CREATE TABLE consumables_used (
  id TEXT PRIMARY KEY,
  appointment_id TEXT NOT NULL REFERENCES appointments (id),
  -- The event that carried it, so a replay updates the same rows.
  job_event_id TEXT NOT NULL REFERENCES job_events (id),
  -- FSM's part, once the catalogue has it (migration 0011).
  fsm_item_id TEXT REFERENCES fsm_items (fsm_id),
  name TEXT NOT NULL,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  created_at TEXT NOT NULL,
  UNIQUE (job_event_id, name)
);

CREATE INDEX consumables_used_by_appointment ON consumables_used (appointment_id);

-- Every move ops make on the dispatch board, the Ops console's board A, each
-- with "a reason from the design's list" (src/policy/dispatch.ts): where the job
-- was and where it went, who moved it, what FSM said, and the message telling
-- the client his new window. The client "is never charged for a move ops make",
-- so no amount belongs here. A move is refused before it is written if it would
-- clash (ADR 0034); the windows it moves between are ADR 0035's.
CREATE TABLE dispatch_moves (
  id TEXT PRIMARY KEY,
  appointment_id TEXT NOT NULL REFERENCES appointments (id),
  -- A reassignment changes the technician, a reschedule the time; a move may do both.
  was_technician_id TEXT REFERENCES technicians (id),
  now_technician_id TEXT REFERENCES technicians (id),
  was_start TEXT,
  now_start TEXT,
  reason TEXT NOT NULL CHECK (
    reason IN ('technician_unavailable', 'client_asked', 'zone_rebalance', 'skill_needed', 'running_over')
  ),
  -- The Access identity of the ops user who moved it (ADR 0031).
  actor TEXT NOT NULL,
  fsm_write_state TEXT NOT NULL DEFAULT 'pending' CHECK (fsm_write_state IN ('pending', 'written', 'rejected')),
  -- No personal data: FSM's status and message only.
  fsm_error TEXT,
  message_id TEXT REFERENCES outbound_messages (id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX dispatch_moves_by_appointment ON dispatch_moves (appointment_id, created_at);
