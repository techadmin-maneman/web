// How a client found us, on their page, and a lead taken on a call (docs/decisions/0288-attribution-and-conversions.md).
// No design draws them; every word here is ours.

import { changed, FAILED, NOT_PERMITTED, OFFLINE, UNCONFIRMED } from "./common.ts";

export const foundUs = {
  title: "How they found us",
  rows: {
    channel: "Channel",
    lastTouch: "Last touch",
    firstTouch: "First touch",
    touches: "Visits, chats and calls",
    heardFrom: "They told us",
    sharing: "Google and Meta",
  },
  /** "Google Ads · gurgaon-search · 12 Nov" */
  touch: (channel: string, campaign: string | null, day: string) =>
    campaign === null ? `${channel} · ${day}` : `${channel} · ${campaign} · ${day}`,
  via: { site: "the site", whatsapp: "WhatsApp", call: "a call" },
  /** "Society activation: Green Valley Towers" */
  link: (name: string) => `Link: ${name}`,
  notAsked: "Not asked yet",
  ask: "Record",
  change: "Change",
  heardFrom: "What they said",
  other: "In their words",
  save: "Save",
  saving: "Saving…",
  sharing: "Shared, hashed",
  stopped: (day: string) => `Stopped ${day}`,
  stopping: {
    open: "Stop sharing",
    label: (name: string) => `Stop sharing ${name}'s details with Google and Meta`,
    warning: (name: string) => `Stop sharing ${name}'s details with Google and Meta? This cannot be undone.`,
    confirm: "Stop sharing",
    sending: "Stopping…",
  },
  none: "Nothing recorded of how they found us.",
  call: {
    open: "Lead from a call",
    name: "Their name",
    mobile: "Their mobile",
    channel: "Where they came from",
    choose: "Choose",
    save: "Save lead",
    saving: "Saving…",
    /** Their channels, as ops pick them on a call: the codes are src/policy/channels.ts's. */
    channels: {
      google_ads: "A Google ad",
      meta_ads: "An Instagram or Facebook ad",
      referral: "A friend",
      partner: "A salon or partner",
      society: "A society event",
      organic_search: "Searched online",
      organic_social: "Social media",
      direct: "Already knew us",
    },
    saved: "Lead saved.",
    known: "They are a client already: the call is on their record.",
    open_client: "Open their record",
  },
  errors: {
    heard_from_other: "Type what they said.",
    name: "Type their name.",
    mobile: "Type a ten-digit Indian mobile number.",
    invalid_request: "Check the fields marked.",
    not_found: changed("Not found."),
    not_permitted: NOT_PERMITTED,
    offline: OFFLINE,
    unconfirmed: UNCONFIRMED,
    unknown: FAILED,
  },
};
