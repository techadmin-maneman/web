-- Migration number: 0003
-- The try-on path: one job per render, the sessions that let a person see
-- their results without a second gate, and the WhatsApp messages that carry a
-- result. Only new tables, so the code already deployed is unaffected.
--
-- Times are ISO-8601 UTC strings. No image bytes are stored here; the photo
-- and the result live in R2 under the keys below.

CREATE TABLE tryon_jobs (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  -- The photo in the UPLOADS bucket. A second look reuses its first look's key.
  upload_key TEXT NOT NULL,
  uploaded_at TEXT,
  upload_deleted_at TEXT,
  -- The first look of this photo, for a second or later look; NULL otherwise.
  parent_job_id TEXT REFERENCES tryon_jobs (id),

  -- Chosen at generate.
  stage TEXT CHECK (stage IN ('crown', 'receding', 'advanced')),
  preset TEXT,
  hair_color TEXT CHECK (hair_color IN ('black', 'brown', 'lightBrown', 'grey', 'silver', 'white', 'unknown')),
  endpoint TEXT CHECK (endpoint IN ('pro', 'premium')),
  -- The colour sent to the provider, and why: 'as_detected', or the UNKNOWN_COLOR_ROUTE taken.
  provider_color TEXT,
  color_route TEXT CHECK (color_route IN ('as_detected', 'premium_original', 'pro_black')),

  state TEXT NOT NULL CHECK (state IN
    ('awaiting_upload', 'queued', 'rendering', 'downloading', 'ready', 'failed', 'expired')),

  -- The render. submit_started_at is claimed before submitting, so a job is never submitted (and billed) twice.
  submit_started_at TEXT,
  submit_attempts INTEGER NOT NULL DEFAULT 0,
  submitted_at TEXT,
  provider_task_id TEXT,
  -- Kept before downloading: the image is billed on generation, and this URL is the only way back to it for 24 hours.
  provider_result_url TEXT,
  provider_result_expires_at TEXT,
  download_attempts INTEGER NOT NULL DEFAULT 0,
  download_attempted_at TEXT,
  result_key TEXT,
  failure_code TEXT CHECK (failure_code IN ('photo_unreadable', 'photo_invalid_file', 'render_failed', 'busy')),
  -- The provider's error, with the API key scrubbed out. Never shown to the customer.
  provider_error_detail TEXT,
  latency_ms INTEGER,

  -- Who, once the gate is passed (or the session that asked for a second look).
  person_id TEXT REFERENCES people (id),
  lead_id TEXT REFERENCES leads (id),
  session_id TEXT,
  claimed_at TEXT,
  -- When the result is deleted: 30 days after it is ready.
  expires_at TEXT,

  -- The photo consent, given before the upload. Copied into consents at claim.
  photo_consent_version TEXT NOT NULL,
  photo_consent_at TEXT NOT NULL,
  ip_hash TEXT NOT NULL,
  request_id TEXT NOT NULL
);

CREATE INDEX tryon_jobs_by_state ON tryon_jobs (state, created_at);
CREATE INDEX tryon_jobs_by_upload ON tryon_jobs (upload_key);
CREATE INDEX tryon_jobs_by_session ON tryon_jobs (session_id);

-- Set by the gate, as the HttpOnly cookie mm_tryon. It lets the person see
-- their results and ask for more looks without passing the gate again.
CREATE TABLE tryon_sessions (
  id TEXT PRIMARY KEY,
  person_id TEXT NOT NULL REFERENCES people (id),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

-- One WhatsApp message each. 'waiting' until the result is ready, then
-- 'queued' for the messaging consumer.
CREATE TABLE outbound_messages (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  person_id TEXT NOT NULL REFERENCES people (id),
  kind TEXT NOT NULL CHECK (kind IN ('tryon_result')),
  -- The try-on job whose result this message carries.
  subject_id TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('waiting', 'queued', 'sent', 'failed', 'skipped')),
  queued_at TEXT,
  -- Claimed before each send, so two overlapping consumer runs cannot both send it.
  sending_at TEXT,
  provider_message_id TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  -- No personal data: a provider status and code only.
  last_error TEXT,
  sent_at TEXT
);

CREATE INDEX outbound_messages_by_state ON outbound_messages (state, queued_at);
CREATE INDEX outbound_messages_by_subject ON outbound_messages (subject_id);
