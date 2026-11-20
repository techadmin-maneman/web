// How a client found us, for the growth figures (docs/decisions/0288-attribution-and-conversions.md, which amends
// 0148). Each touch has a channel by what it carried, in this order: a friend's or a partner's code, a society's code,
// a paid click, the campaign tags, the page it came from, the channel a call was put under, how it reached us (a chat
// or a call), and Direct when nothing tells. A client's channel is their first touch's, unless a code reached us before
// their first consultation was booked. What a client told us is kept apart (./heard-from.ts) and never counts here.
// A campaign's city is the first word of its name, or none for a name that starts with "national".

import { slugOf } from "../lib/slug.ts";

/** The channels, in the order the figures list them, each with its group: the names the dashboards are built on. */
export const CHANNELS = [
  { code: "google_ads", channel: "Google Ads", group: "Paid" },
  { code: "meta_ads", channel: "Meta Ads", group: "Paid" },
  { code: "referral", channel: "Referral", group: "Referral" },
  { code: "organic_search", channel: "Organic search", group: "Organic" },
  { code: "direct", channel: "Direct", group: "Direct" },
  { code: "partner", channel: "Offline and partners", group: "Offline" },
  { code: "society", channel: "Society activations", group: "Offline" },
  { code: "organic_social", channel: "Organic social", group: "Organic" },
  { code: "referral_site", channel: "Other sites", group: "Organic" },
  { code: "whatsapp", channel: "WhatsApp", group: "Direct" },
  { code: "phone", channel: "Phone", group: "Direct" },
] as const;

export type Channel = (typeof CHANNELS)[number]["channel"];

export type ChannelCode = (typeof CHANNELS)[number]["code"];

export const CHANNEL_CODES = CHANNELS.map((each) => each.code) as [ChannelCode, ...ChannelCode[]];

/** The channel's name as the figures show it; Direct for a code we do not have. */
export const channelNamed = (code: string | null): Channel =>
  CHANNELS.find((each) => each.code === code)?.channel ?? "Direct";

/** What spend may be put under: every channel, Google's and Meta's included, so the figures read only our own rows. */
export const SPEND_CHANNELS = CHANNEL_CODES;

export type SpendChannel = ChannelCode;

/** What a call can be put under while no tracking number says it: the channels a caller can come from. */
export const DECLARED_CHANNELS = [
  "google_ads",
  "meta_ads",
  "referral",
  "partner",
  "society",
  "organic_search",
  "organic_social",
  "direct",
] as const satisfies readonly ChannelCode[];

export type DeclaredChannel = (typeof DECLARED_CHANNELS)[number];

/** What one touch carried, as `touches` keeps it. */
export interface Touch {
  readonly utmSource: string | null;
  readonly utmMedium: string | null;
  readonly gclid: string | null;
  readonly gbraid: string | null;
  readonly wbraid: string | null;
  readonly fbclid: string | null;
  /** Meta's click ID on a chat begun from a click-to-WhatsApp ad: always paid. */
  readonly ctwaClid: string | null;
  readonly referrer: string | null;
  /** The code the touch carried, where it was one of ours. */
  readonly code: TouchCode | null;
  /** The channel a call was put under, by ops now and by a tracking number later. */
  readonly declared: ChannelCode | null;
  readonly via: TouchVia;
}

/** A code of ours a touch can carry: a friend's invite, a partner's code, a society's. */
export type TouchCode = "friend" | "partner" | "society";

/** How a touch reached us. */
export type TouchVia = "site" | "whatsapp" | "call";

const SEARCH = ["google", "bing", "duckduckgo", "yahoo", "ecosia"];
const SOCIAL = ["facebook", "instagram", "fb", "ig", "meta", "youtube", "linkedin", "twitter", "x", "t.co", "whatsapp"];
const META = ["facebook", "instagram", "fb", "ig", "meta"];
const PAID = ["cpc", "ppc", "paid", "paid_social", "paidsocial", "paid-social", "display", "cpm"];
/** Hosts that are not another site sending the visitor: our own, and the payment page a client comes back from. */
const NOT_A_REFERRER = ["maneman.in", "razorpay.com"];

const lower = (text: string | null) => (text ?? "").trim().toLowerCase();

/** The site a referrer is, by its host: "www.google.co.in" is google.co.in. */
function siteOf(referrer: string | null): string {
  try {
    return referrer === null ? "" : new URL(referrer).hostname.replace(/^(www|m|l|lm)\./, "");
  } catch {
    return "";
  }
}

const isOneOf = (names: readonly string[], value: string) =>
  names.some((name) => value === name || value.startsWith(`${name}.`));

const isWithin = (hosts: readonly string[], value: string) =>
  hosts.some((host) => value === host || value.endsWith(`.${host}`));

const CODE_CHANNEL = { friend: "referral", partner: "partner", society: "society" } as const;

/** What the campaign tags say, or null where they say nothing we read. */
function tagged(source: string, medium: string): ChannelCode | null {
  const paid = PAID.includes(medium);
  if (paid && source === "google") return "google_ads";
  if (paid && META.includes(source)) return "meta_ads";
  if (medium === "offline") return source === "society" ? "society" : "partner";
  if (SEARCH.includes(source)) return "organic_search";
  if (SOCIAL.includes(source)) return "organic_social";
  return null;
}

/** What the page before says: a search engine, a social site, another site, or nothing. */
function referred(referrer: string | null): ChannelCode | null {
  const site = siteOf(referrer);
  if (site === "" || isWithin(NOT_A_REFERRER, site)) return null;
  if (isOneOf(SEARCH, site)) return "organic_search";
  if (isOneOf(SOCIAL, site)) return "organic_social";
  return "referral_site";
}

/** A touch's channel, by the first thing in it that tells. */
export function touchChannel(touch: Touch): ChannelCode {
  if (touch.code !== null) return CODE_CHANNEL[touch.code];
  if (touch.gclid !== null || touch.gbraid !== null || touch.wbraid !== null) return "google_ads";
  if (touch.ctwaClid !== null) return "meta_ads";
  const fromTags = tagged(lower(touch.utmSource), lower(touch.utmMedium));
  if (fromTags !== null) return fromTags;
  // Meta adds its click ID to unpaid links too, so on its own it says only that a social site sent them.
  if (touch.fbclid !== null) return "organic_social";
  const fromPage = referred(touch.referrer);
  if (fromPage !== null) return fromPage;
  if (touch.declared !== null) return touch.declared;
  if (touch.via === "whatsapp") return "whatsapp";
  if (touch.via === "call") return "phone";
  return "direct";
}

/** Whether a touch carried anything a campaign put there: the last touch moves only for one that did. */
export function carriesCampaign(touch: Touch & { readonly utmCampaign: string | null }): boolean {
  return [
    touch.code,
    touch.gclid,
    touch.gbraid,
    touch.wbraid,
    touch.fbclid,
    touch.ctwaClid,
    touch.utmSource,
    touch.utmMedium,
    touch.utmCampaign,
    touch.declared,
  ].some((value) => value !== null);
}

/**
 * A client's channel: their first touch's, unless a code reached us before their first consultation was booked, in
 * which case the code's, a friend's before a partner's before a society's.
 */
export function clientChannel(firstTouch: ChannelCode, codesBeforeBooking: ReadonlySet<TouchCode>): ChannelCode {
  for (const code of ["friend", "partner", "society"] as const) {
    if (codesBeforeBooking.has(code)) return CODE_CHANNEL[code];
  }
  return firstTouch;
}

/** A campaign's city by the naming rule: the city its name starts with, or null for "national" or any other. */
export function campaignCity(campaign: string, cities: readonly string[]): string | null {
  const name = slugOf(campaign, 200);
  return cities.find((city) => name === slugOf(city, 100) || name.startsWith(`${slugOf(city, 100)}_`)) ?? null;
}
