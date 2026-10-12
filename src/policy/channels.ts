// How a lead found us, for the growth figures (docs/decisions/0148-the-channel-rule.md). A client keeps the channel of
// their first lead for life. A lead is a friend's referral or a partner's when the client came through one before it;
// a lead Care saved from a chat, what the client told them; otherwise its click ID, its campaign tags and the page it
// came from decide. A campaign's city is the first word of its name, or none for a name that starts with "national".

import { slugOf } from "../lib/slug.ts";

/** The channels, in the order the figures list them, each with its group: the names the dashboards are built on. */
export const CHANNELS = [
  { code: "google_ads", channel: "Google Ads", group: "Paid" },
  { code: "meta_ads", channel: "Meta Ads", group: "Paid" },
  { code: "referral", channel: "Referral", group: "Referral" },
  { code: "organic_search", channel: "Organic search", group: "Organic" },
  { code: "direct", channel: "Direct", group: "Direct" },
  { code: "partner", channel: "Offline and partners", group: "Offline" },
  { code: "organic_social", channel: "Organic social", group: "Organic" },
] as const;

export type Channel = (typeof CHANNELS)[number]["channel"];

/** A channel as a lead stores it, where the client told Care how they found us. */
export type ChannelCode = (typeof CHANNELS)[number]["code"];

export const CHANNEL_CODES = CHANNELS.map((each) => each.code) as [ChannelCode, ...ChannelCode[]];

/** What offline spend may be put under: every channel but the two whose spend Zoho reads from their ad accounts. */
export const SPEND_CHANNELS = [
  "partner",
  "referral",
  "organic_social",
  "organic_search",
  "direct",
] as const satisfies readonly ChannelCode[];

export type SpendChannel = (typeof SPEND_CHANNELS)[number];

export interface LeadTouch {
  readonly utmSource: string | null;
  readonly utmMedium: string | null;
  readonly gclid: string | null;
  readonly fbclid: string | null;
  readonly referrer: string | null;
  /** A friend's invite, or a partner's code, the client came through before this lead. */
  readonly referredBefore: boolean;
  readonly partnerBefore: boolean;
  /** What the client told Care, for a lead saved from a chat; null where the site's tags tell. */
  readonly foundUs: string | null;
}

const SEARCH = ["google", "bing", "duckduckgo", "yahoo", "ecosia"];
const SOCIAL = ["facebook", "instagram", "fb", "ig", "meta", "youtube", "linkedin", "twitter", "x", "t.co", "whatsapp"];
const META = ["facebook", "instagram", "fb", "ig", "meta"];
const PAID = ["cpc", "ppc", "paid", "paid_social", "paidsocial", "paid-social", "display", "cpm"];

const lower = (text: string | null) => (text ?? "").trim().toLowerCase();

/** The site a referrer is, by its host: "www.google.co.in" is google. */
function siteOf(referrer: string | null): string {
  try {
    return referrer === null ? "" : new URL(referrer).hostname.replace(/^(www|m|l|lm)\./, "");
  } catch {
    return "";
  }
}

const isOneOf = (names: readonly string[], value: string) =>
  names.some((name) => value === name || value.startsWith(`${name}.`));

export function channelOf(touch: LeadTouch): Channel {
  if (touch.referredBefore) return "Referral";
  if (touch.partnerBefore) return "Offline and partners";
  const told = CHANNELS.find((each) => each.code === touch.foundUs);
  if (told !== undefined) return told.channel;
  const source = lower(touch.utmSource);
  const paid = PAID.includes(lower(touch.utmMedium));
  if (touch.gclid !== null || (paid && source === "google")) return "Google Ads";
  if (paid && META.includes(source)) return "Meta Ads";
  const site = siteOf(touch.referrer);
  if (SEARCH.includes(source) || isOneOf(SEARCH, site)) return "Organic search";
  if (touch.fbclid !== null || SOCIAL.includes(source) || isOneOf(SOCIAL, site)) return "Organic social";
  return "Direct";
}

/** A campaign's city by the naming rule: the city its name starts with, or null for "national" or any other. */
export function campaignCity(campaign: string, cities: readonly string[]): string | null {
  const name = slugOf(campaign, 200);
  return cities.find((city) => name === slugOf(city, 100) || name.startsWith(`${slugOf(city, 100)}_`)) ?? null;
}
