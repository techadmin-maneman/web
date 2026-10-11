-- Referral channels: partners who send us clients on their own code, a salon, a clinic, a gym or a creator
-- (docs/decisions/0123-partner-referral-channels.md). A partner is not a client, so its code and the people who came
-- through it live beside the clients' invites (referral_codes, referral_attributions), which other tables point at and
-- so cannot be rebuilt to hold them. A person comes through one invite only, a client's or a partner's, whichever
-- they used first: the code that writes an attribution checks both tables.

CREATE TABLE referral_channels (
  id TEXT PRIMARY KEY,
  -- As the invite page names it: "Recommended by Looks Salon".
  name TEXT NOT NULL UNIQUE,
  -- In capitals, of the letters and digits none reads as another, as a client's code is; never one a client has.
  code TEXT NOT NULL UNIQUE,
  -- What the friend gets once fitted: service visits, and how many days they last.
  friend_visits INTEGER NOT NULL CHECK (friend_visits BETWEEN 0 AND 12),
  valid_days INTEGER NOT NULL CHECK (valid_days BETWEEN 30 AND 1095),
  -- What the partner earns for each friend fitted, in paise; 0 for none.
  commission INTEGER NOT NULL CHECK (commission >= 0),
  -- Paused: nobody new comes through it, and its code reads as one we do not have.
  paused_at TEXT,
  -- The invite page opened, once a day for each address, as a client's code counts its opens.
  opens INTEGER NOT NULL DEFAULT 0,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  changed_by TEXT,
  changed_at TEXT
);

CREATE TABLE channel_attributions (
  id TEXT PRIMARY KEY,
  channel_id TEXT NOT NULL REFERENCES referral_channels (id),
  referred_person_id TEXT NOT NULL UNIQUE REFERENCES people (id),
  first_touch_at TEXT NOT NULL,
  via TEXT NOT NULL CHECK (via IN ('consultation', 'waitlist')),
  pincode TEXT,
  first_fit_appointment_id TEXT REFERENCES appointments (id),
  -- pending: not fitted yet; granted: the friend's visits given and the commission earned; expired: held on a
  -- waitlist past the invite's life; clawed_back: the first fit was refunded under the guarantee.
  grant_state TEXT NOT NULL DEFAULT 'pending' CHECK (grant_state IN ('pending', 'granted', 'expired', 'clawed_back')),
  -- The reward in force when the friend was fitted, kept with it.
  friend_visits INTEGER,
  valid_days INTEGER,
  commission INTEGER,
  granted_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX channel_attributions_by_channel ON channel_attributions (channel_id, grant_state);
