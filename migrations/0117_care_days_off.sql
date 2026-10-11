-- When each of the Care team is off (docs/decisions/0134-care-cover.md): their weekly days off and their leave. On a
-- day a Care person is off, the member on with the fewest clients covers their chats.

-- 0 Sunday to 6 Saturday, as India's calendar counts them.
CREATE TABLE care_weekly_off (
  email TEXT NOT NULL,
  weekday INTEGER NOT NULL CHECK (weekday BETWEEN 0 AND 6),
  set_by TEXT NOT NULL,
  set_at TEXT NOT NULL,
  PRIMARY KEY (email, weekday)
);

-- Inclusive, both of them: a single day's leave has the same date twice.
CREATE TABLE care_leave (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  from_date TEXT NOT NULL,
  to_date TEXT NOT NULL,
  set_by TEXT NOT NULL,
  set_at TEXT NOT NULL,
  CHECK (to_date >= from_date)
);

CREATE INDEX care_leave_by_end ON care_leave (to_date);
