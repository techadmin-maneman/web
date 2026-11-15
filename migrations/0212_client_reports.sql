-- Migration number: 0212
-- The issue log (docs/decisions/0258-the-issue-log.md): each report a client files from the app, with its number, its
-- category, the visit it is about and the Care chat it went into; and the photographs sent with it. New tables: the
-- Worker already deployed reads and writes none of it.

CREATE TABLE client_reports (
  id TEXT PRIMARY KEY,
  -- Shown as MM-ISS-0032: one more than the last report's.
  number INTEGER NOT NULL UNIQUE,
  person_id TEXT NOT NULL REFERENCES people (id),
  category TEXT NOT NULL CHECK (
    category IN (
      'fit_guarantee', 'edges_lifting', 'itching', 'colour', 'shedding', 'fit_comfort', 'visit', 'payment', 'other'
    )
  ),
  visit_id TEXT REFERENCES appointments (id),
  -- The first fit a report on the fit (guarantee) claims, where it came inside that fit's guarantee
  -- (docs/decisions/0256-fit-guarantee-setting.md); NULL for any other report.
  claim_visit_id TEXT REFERENCES appointments (id),
  -- The client's words; NULL once they are erased.
  text TEXT CHECK (text IS NULL OR length(text) <= 1000),
  conversation_id TEXT REFERENCES conversations (id),
  created_at TEXT NOT NULL,
  -- When Care closed its chat after it, when the client marked it sorted, and when they last reopened it.
  closed_at TEXT,
  sorted_at TEXT,
  reopened_at TEXT
);

CREATE INDEX client_reports_by_person ON client_reports (person_id, created_at);
-- Care's close settles the reports its chat holds open (src/domain/care/replies.ts).
CREATE INDEX client_reports_by_conversation ON client_reports (conversation_id);
-- The Tasks queue of fit guarantee claims reads these (src/domain/ops/task-queues.ts).
CREATE INDEX client_reports_claims ON client_reports (claim_visit_id) WHERE claim_visit_id IS NOT NULL;

-- Up to three photographs a report, each an object in the client photos bucket.
CREATE TABLE client_report_photos (
  report_id TEXT NOT NULL REFERENCES client_reports (id),
  n INTEGER NOT NULL CHECK (n BETWEEN 1 AND 3),
  object_key TEXT NOT NULL,
  bytes INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (report_id, n)
);

-- backfill: none. A report filed before this migration stays in its Care chat as it was.
