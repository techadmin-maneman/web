// How a lead found us, for the growth figures (docs/decisions/0148-the-channel-rule.md). A client keeps the channel of
// their first lead for life. A lead is a friend's referral or a partner's when the client came through one before it;
// otherwise its click ID, its campaign tags and the page it came from decide. A campaign's city is the first word of its
// name, or none for a name that starts with "national".

import { slugOf } from "../lib/slug.ts";

/** The channels, in the order the figures list them, each with its group: the names the dashboards are built on. */
export const CHANNELS = [
  { channel: "Google Ads", group: "Paid" },
  { channel: "Meta Ads", group: "Paid" },
  { channel: "Referral", group: "Referral" },
  { channel: "Organic search", group: "Organic" },
  { channel: "Direct", group: "Direct" },
  { channel: "Offline and partners", group: "Offline" },
  { channel: "Organic social", group: "Organic" },
] as const;

export type Channel = (typeof CHANNELS)[number]["channel"];

export interface LeadTouch {
  readonly utmSource: string | null;
  readonly utmMedium: string | null;
  readonly gclid: string | null;
  readonly fbclid: string | null;
  readonly referrer: string | null;
  /** A friend's invite, or a partner's code, the client came through before this lead. */
  readonly referredBefore: boolean;
  readonly partnerBefore: boolean;
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
