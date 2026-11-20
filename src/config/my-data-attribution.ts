// The readable copy's parts for how a client reached us and found us, and what Google and Meta were told
// (./my-data.ts; docs/decisions/0288-attribution-and-conversions.md).

import { day, money, text, time, words, type Part } from "./my-data-fields.ts";

const LEADS_PART: Part = {
  title: "How you reached us",
  fields: {
    source: words("Through"),
    city: text("City"),
    loss_extent: words("Hair loss"),
    first_choice_window: words("Window you asked for"),
    proposed_visit_date: day("Day you asked for"),
    referrer: text("Page you came from"),
    landing_path: text("Page you landed on"),
    utm_source: text("Campaign source"),
    utm_medium: text("Campaign medium"),
    utm_campaign: text("Campaign"),
    utm_content: text("Campaign content"),
    gclid: text("Google ad click"),
    fbclid: text("Facebook ad click"),
    found_us: words("How you told us you found us"),
    created_at: time("When"),
  },
};

const TOUCHES_PART: Part = {
  title: "Each time you reached us",
  fields: {
    at: time("When"),
    via: words("Through"),
    channel: words("Channel"),
    utm_source: text("Campaign source"),
    utm_medium: text("Campaign medium"),
    utm_campaign: text("Campaign"),
    utm_content: text("Campaign content"),
    utm_term: text("Campaign search words"),
    gclid: text("Google ad click"),
    gbraid: text("Google ad click on an iPhone app"),
    wbraid: text("Google ad click on an iPhone"),
    fbclid: text("Facebook or Instagram click"),
    fbc: text("Meta's click cookie"),
    fbp: text("Meta's browser cookie"),
    ctwa_clid: text("WhatsApp ad click"),
    ad_source_id: text("WhatsApp ad"),
    ad_source_url: text("WhatsApp ad's page"),
    referrer: text("Page you came from"),
    landing_path: text("Page you landed on"),
    invite_code: text("Invite code"),
    code_kind: words("Code"),
    declared_channel: words("Where you said you came from, on a call"),
    declared_by: words("Noted by"),
    ad_consent: words("Your answer about cookies"),
    ad_notice: text("What you were told of our ads"),
    user_agent: text("Your browser"),
    client_ip: text("Your network address"),
    visitor_id: text("Your browser's code"),
  },
};

const ATTRIBUTION_PART: Part = {
  title: "How you found us",
  fields: {
    attributed_channel: words("Channel"),
    last_touch_channel: words("Latest channel"),
    settled_at: time("Settled when your first consultation was booked"),
    heard_from: words("What you told us"),
    heard_from_other: text("In your words"),
    heard_from_at: time("Told us"),
    sharing_stopped_at: time("Stopped sharing with Google and Meta"),
  },
};

const AD_SENDS_PART: Part = {
  title: "What Google and Meta were told",
  fields: {
    event: words("What happened"),
    occurred_at: time("When"),
    value_paise: money("Amount before GST"),
    attributed_channel: words("Channel"),
    last_touch_channel: words("Latest channel"),
    source_url: text("Page"),
    meta_state: words("Meta"),
    meta_sent_at: time("Sent to Meta"),
    google_state: words("Google"),
    google_sent_at: time("Sent to Google"),
    created_at: time("Recorded"),
  },
};

const BROWSERS_PART: Part = {
  title: "Your browsers",
  fields: {
    ref: text("Reference in your WhatsApp messages"),
    created_at: time("First seen"),
    seen_at: time("Last seen"),
  },
};

/** Each, by the export's part it fills, in the order the copy shows them. */
export const ATTRIBUTION_PARTS = {
  leads: LEADS_PART,
  touches: TOUCHES_PART,
  attribution: ATTRIBUTION_PART,
  ad_sends: AD_SENDS_PART,
  browsers: BROWSERS_PART,
};
