-- Migration number: 0222
-- What an erasure leaves Customer Care to do by hand (docs/decisions/0066-erasure-all-or-nothing.md): the CRM record's
-- history and its copy in the recycle bin, which the API cannot reach. A row an erasure, written in its batch, listed
-- on Tasks and gone once Care close it, so the table holds only those still open. New: the deployed Worker uses none.

CREATE TABLE erasure_follow_ups (
  -- The person erased, whose own row keeps only their ID and the day.
  person_id TEXT PRIMARY KEY REFERENCES people (id),
  -- When they were erased, which the task waits from.
  erased_at TEXT NOT NULL
);

-- backfill: none. An erasure before this migration was followed up under the runbook's steps then.
