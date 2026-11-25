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
    heardFrom: "How they heard of us",
    sharing: "Google and Meta",
  },
  /** "Google Ads · gurgaon-search · 12 Nov" */
  touch: (channel: string, campaign: string | null, day: string) =>
    campaign === null ? `${channel} · ${day}` : `${channel} · ${campaign} · ${day}`,
  /** "Society activation: Green Valley Towers" */
  link: (name: string) => `Link: ${name}`,
  notAsked: "Not asked yet",
  other: "In their words",
  sharing: "Shared, hashed",
  stopped: (day: string) => `Stopped ${day}`,
  stopping: {
    open: "Stop sharing",
    label: (name: string) => `Stop sharing ${name}’s details with Google and Meta`,
    warning: (name: string) => `Stop sharing ${name}’s details with Google and Meta? This cannot be undone.`,
    confirm: "Stop sharing",
    sending: "Stopping…",
  },
  none: "Nothing recorded of how they found us.",
  call: {
    open: "Add a client",
    name: "Name",
    mobile: "Mobile number",
    /** Their city until they give an address (docs/decisions/0307-the-people-rulings.md). */
    pincode: "Pincode (optional)",
    channel: "How they heard of us",
    choose: "Choose",
    save: "Add client",
    saving: "Saving…",
    /** Their channels, as ops pick them on a call: the codes are src/policy/channels.ts's. */
    channels: {
      google_ads: "A Google ad",
      meta_ads: "An Instagram or Facebook ad",
      referral: "A friend",
      partner: "A salon or partner",
      society: "A society event",
      organic_search: "Searched online",
      business_profile: "Found us on Google Maps",
      organic_social: "Social media",
      direct: "Already knew us",
    },
    /** What Save lead waits for, said beneath it. */
    missing: {
      name: "Type their name.",
      mobile: "Type their ten-digit mobile.",
      pincode: "Check the pincode, or leave it blank.",
      channel: "Pick how they heard of us.",
    },
    saved: "Client added.",
    known: "They are a client already: the call is on their record.",
    open_client: "Open their record",
  },
  errors: {
    heard_from_other: "Type what they said.",
    name: "Type their name.",
    mobile: "Type a ten-digit Indian mobile number.",
    pincode: "Check the pincode.",
    invalid_request: "Check the fields marked.",
    not_found: changed("Not found."),
    not_permitted: NOT_PERMITTED,
    offline: OFFLINE,
    unconfirmed: UNCONFIRMED,
    unknown: FAILED,
  },
};
