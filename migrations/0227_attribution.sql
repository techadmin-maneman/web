-- Migration number: 0227
-- contract: docs/decisions/0288-attribution-and-conversions.md
-- Visitors, touches, each person's first and last touch, conversions for Google and Meta, and campaign links; spend
-- gains a day, a source and a link; leads.source gains 'phone', swapped in place as 0120 did, keeping name and answers.
-- backfill: under 5,000 leads on either database, × 6 with its indexes: about 30,000 writes.

CREATE TABLE visitors (
  -- The site's visitor cookie's value.
  id TEXT PRIMARY KEY,
  -- The reference a WhatsApp message from this visitor ends with (src/config/ref-tokens.ts).
  ref TEXT NOT NULL UNIQUE,
  -- Once a number they gave, or a chat their reference opened, names them.
  person_id TEXT REFERENCES people (id),
  created_at TEXT NOT NULL,
  -- Their latest touch: a visitor never named is deleted 13 months after it.
  seen_at TEXT NOT NULL
);

CREATE INDEX visitors_by_person ON visitors (person_id) WHERE person_id IS NOT NULL;
CREATE INDEX visitors_unnamed_by_seen ON visitors (seen_at) WHERE person_id IS NULL;

CREATE TABLE campaign_links (
  id TEXT PRIMARY KEY,
  -- society: an activation at a society, /s/<slug>; offer: a link for an ad, a post or a newsletter, /o/<slug>.
  kind TEXT NOT NULL CHECK (kind IN ('society', 'offer')),
  slug TEXT NOT NULL UNIQUE CHECK (length(slug) BETWEEN 1 AND 40),
  -- The code the link carries; a society's is short enough to read out.
  code TEXT NOT NULL UNIQUE,
  -- The society's name, or the offer's.
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  utm_source TEXT NOT NULL,
  utm_medium TEXT NOT NULL,
  utm_campaign TEXT NOT NULL,
  city TEXT REFERENCES cities (name),
  -- A society's pincode: its discount holds only for an address in it.
  pincode TEXT,
  -- A society activation's day, in India.
  held_date TEXT,
  -- One of Finance's codes, taken off the first fit of anyone who came through the link.
  discount_code_id TEXT REFERENCES discount_codes (id),
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  -- Retired: the link sends visitors to /book with nothing, and no new touch carries it.
  retired_by TEXT,
  retired_at TEXT
);

CREATE INDEX campaign_links_by_discount_code ON campaign_links (discount_code_id) WHERE discount_code_id IS NOT NULL;

CREATE TABLE touches (
  id TEXT PRIMARY KEY,
  at TEXT NOT NULL,
  -- How it reached us: a page of the site, a WhatsApp chat, a call ops took.
  via TEXT NOT NULL CHECK (via IN ('site', 'whatsapp', 'call')),
  visitor_id TEXT REFERENCES visitors (id),
  person_id TEXT REFERENCES people (id),
  -- A chat's number while no person has it: the touch becomes theirs once Care save or link the chat.
  mobile_e164 TEXT,
  utm_source TEXT,
  utm_medium TEXT,
  utm_campaign TEXT,
  utm_content TEXT,
  utm_term TEXT,
  gclid TEXT,
  gbraid TEXT,
  wbraid TEXT,
  fbclid TEXT,
  -- Meta's cookies as the browser had them, or the click cookie built from fbclid.
  fbc TEXT,
  fbp TEXT,
  -- A click-to-WhatsApp ad's click ID, ad and post, from the chat's first message.
  ctwa_clid TEXT,
  ad_source_id TEXT,
  ad_source_url TEXT,
  referrer TEXT,
  landing_path TEXT,
  -- A friend's or a partner's code (?ref, /r/:code), as it was given.
  invite_code TEXT,
  -- The code of ours it carried, where it was one: a friend's, a partner's or a society's.
  code_kind TEXT CHECK (code_kind IN ('friend', 'partner', 'society')),
  link_id TEXT REFERENCES campaign_links (id),
  -- What a call was put under, and by whom: ops now, a tracking number later.
  declared_channel TEXT,
  declared_by TEXT CHECK (declared_by IN ('ops', 'number')),
  -- The touch's channel by the rule (src/policy/channels.ts).
  channel TEXT NOT NULL,
  -- 1 where a campaign put something in it: only such a touch moves the last touch.
  campaign_signal INTEGER NOT NULL CHECK (campaign_signal IN (0, 1)),
  -- The visitor's answer to the site's cookie bar: null while unanswered. Denied sends Meta neither cookie nor address.
  ad_consent TEXT CHECK (ad_consent IN ('granted', 'denied')),
  -- For Meta's match only, never shown; cleared 90 days on.
  user_agent TEXT,
  client_ip TEXT
);

CREATE INDEX touches_by_person ON touches (person_id, at) WHERE person_id IS NOT NULL;
CREATE INDEX touches_by_visitor ON touches (visitor_id, at) WHERE visitor_id IS NOT NULL;
CREATE INDEX touches_unclaimed_by_mobile ON touches (mobile_e164) WHERE person_id IS NULL AND mobile_e164 IS NOT NULL;
CREATE INDEX touches_by_link ON touches (link_id) WHERE link_id IS NOT NULL;
CREATE INDEX touches_with_address ON touches (at) WHERE client_ip IS NOT NULL OR user_agent IS NOT NULL;

CREATE TABLE person_attribution (
  person_id TEXT PRIMARY KEY REFERENCES people (id),
  -- Empty, with both channels, for a person no touch names yet, whose answer below is kept all the same.
  first_touch_id TEXT REFERENCES touches (id),
  last_touch_id TEXT REFERENCES touches (id),
  -- The client's channel: the first touch's, or a code's that came before booking (src/policy/channels.ts).
  attributed_channel TEXT,
  last_touch_channel TEXT,
  -- When the first consultation was booked: the channel no longer moves after it.
  settled_at TEXT,
  -- What the client told ops (src/policy/heard-from.ts), apart from the channel, and ops' own words for "other".
  heard_from TEXT,
  heard_from_other TEXT,
  heard_from_by TEXT,
  heard_from_at TEXT,
  -- The client asked that nothing more of theirs go to Google or Meta: when, and the member of staff who recorded it.
  sharing_stopped_at TEXT,
  sharing_stopped_by TEXT,
  updated_at TEXT NOT NULL
);

CREATE INDEX person_attribution_by_first_touch ON person_attribution (first_touch_id);
CREATE INDEX person_attribution_by_last_touch ON person_attribution (last_touch_id);

CREATE TABLE conversions (
  -- The ID each platform is sent, the browser's copy's own where there is one, so Meta counts the two once.
  event_id TEXT PRIMARY KEY,
  event TEXT NOT NULL CHECK (event IN ('lead_submit', 'consult_booked', 'consult_done', 'first_fit_paid', 'service_paid')),
  -- The lead, the visit or the payment it is.
  subject_id TEXT NOT NULL,
  person_id TEXT NOT NULL REFERENCES people (id),
  occurred_at TEXT NOT NULL,
  -- A payment's amount before GST, less nothing refunded: what the platforms are told it was worth.
  value_paise INTEGER,
  -- The client's channels when it happened.
  attributed_channel TEXT NOT NULL,
  last_touch_channel TEXT NOT NULL,
  -- The page a lead was left on, which Meta asks of a website's event.
  source_url TEXT,
  -- Each platform's send: waiting, sent, given up after its tries, or not for it (with why).
  meta_state TEXT NOT NULL CHECK (meta_state IN ('pending', 'sent', 'failed', 'skipped')),
  meta_tries INTEGER NOT NULL DEFAULT 0,
  meta_next_at TEXT,
  meta_error TEXT,
  meta_sent_at TEXT,
  google_state TEXT NOT NULL CHECK (google_state IN ('pending', 'sent', 'failed', 'skipped')),
  google_tries INTEGER NOT NULL DEFAULT 0,
  google_next_at TEXT,
  google_error TEXT,
  google_sent_at TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (event, subject_id)
);

CREATE INDEX conversions_meta_due ON conversions (meta_next_at) WHERE meta_state = 'pending';
CREATE INDEX conversions_google_due ON conversions (google_next_at) WHERE google_state = 'pending';
CREATE INDEX conversions_by_event ON conversions (event, occurred_at);
CREATE INDEX conversions_by_person ON conversions (person_id);

-- The day spent, where the entry came from, and the link and cost line a society's spend was on.
ALTER TABLE spend_entries ADD COLUMN spent_date TEXT;
ALTER TABLE spend_entries ADD COLUMN source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'csv', 'link', 'api'));
ALTER TABLE spend_entries ADD COLUMN link_id TEXT REFERENCES campaign_links (id);
ALTER TABLE spend_entries ADD COLUMN cost_line TEXT CHECK (cost_line IN ('stall', 'staff', 'collateral', 'other'));
-- The CSV a row came in with, so one file is never taken twice.
ALTER TABLE spend_entries ADD COLUMN import_id TEXT;

CREATE INDEX spend_entries_by_day ON spend_entries (spent_date) WHERE removed_at IS NULL AND spent_date IS NOT NULL;
CREATE INDEX spend_entries_by_link ON spend_entries (link_id) WHERE link_id IS NOT NULL;

-- The touch a lead was made by; empty on a lead from before, which the cron gives one (src/domain/attribution/backfill.ts).
ALTER TABLE leads ADD COLUMN touch_id TEXT REFERENCES touches (id);
-- The version of the line /book's first step shows on Google and Meta (src/config/notices.ts, AD_NOTICE), as the page
-- that made the lead showed it; its time is the lead's own.
ALTER TABLE leads ADD COLUMN ad_notice TEXT;

CREATE INDEX leads_without_touch ON leads (created_at) WHERE touch_id IS NULL;
-- So a touch let go is checked against the leads that name it without reading them all.
CREATE INDEX leads_by_touch ON leads (touch_id) WHERE touch_id IS NOT NULL;

DROP INDEX leads_fsm_unqueued;

ALTER TABLE leads ADD COLUMN source_next TEXT CHECK (source_next IN ('form', 'waitlist', 'tryon', 'whatsapp', 'phone'));

-- backfill: leads × 6 (the swap's three statements on a table with five indexes).
UPDATE leads SET source_next = source;

ALTER TABLE leads DROP COLUMN source;

ALTER TABLE leads RENAME COLUMN source_next TO source;

CREATE INDEX leads_fsm_unqueued ON leads (created_at)
  WHERE fsm_queued_at IS NULL AND fsm_request_id IS NULL AND source = 'form' AND first_choice_window IS NOT NULL;
