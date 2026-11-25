-- Migration number: 0241
-- The unanswered-lead alert (docs/decisions/0323-the-unanswered-lead-alert.md): the phones that take Care's pushes, by
-- push address and whose, three at most each; and the leads' waits already pushed, kept a week. New tables: the Worker
-- already deployed reads and writes neither.

CREATE TABLE staff_push_subscriptions (
  endpoint TEXT PRIMARY KEY,
  email TEXT NOT NULL REFERENCES staff (email),
  subscribed_at TEXT NOT NULL
);

CREATE INDEX staff_push_subscriptions_by_email ON staff_push_subscriptions (email, subscribed_at);

-- "<conversation>:<first message>": one push for each wait.
CREATE TABLE lead_alert_pushes (
  lead TEXT PRIMARY KEY,
  pushed_at TEXT NOT NULL
);

CREATE INDEX lead_alert_pushes_by_time ON lead_alert_pushes (pushed_at);
