// Every limit counted in D1 (src/domain/rate-limit.ts), by its scope: the window it counts in, and how many uses that
// window allows. A scope is a key of this table, so a mistyped one is a type error rather than a new count with no
// limit. A limit that differs by environment, or that a local run may raise (src/config/limits.ts), is read from the
// settings.

import type { Settings } from "../config/settings.ts";
import { CODE_CHECKS } from "./discount-codes.ts";
import { GRIEVANCES_PER_DAY } from "./grievances.ts";
import { INVITE_MISSES_PER_ADDRESS_HOURLY } from "./invites.ts";

/** The window a count runs in: India's day, or India's hour. */
export type Period = "day" | "hour";

export interface RateLimit {
  readonly per: Period;
  /** How many uses a window allows: a figure, or the setting that holds it. */
  readonly limit: number | ((settings: Settings) => number);
}

/** Address suggestions one asker may have in a day, so no one asker can spend the day's geocode ceiling. */
const SUGGESTIONS_PER_DAY = 120;

export const RATE_LIMITS = {
  // The site's booking and waitlist forms (docs/decisions/0011-lead-api.md).
  "booking:ip": { per: "day", limit: (settings) => settings.leadIpDailyLimit },
  "booking:mobile": { per: "day", limit: (settings) => settings.leadMobileDailyLimit },

  // Login codes, and the site's codes, each surface counted apart (docs/decisions/0030-one-time-codes.md).
  "login:code:ip": { per: "hour", limit: (settings) => settings.login.codeIpHourlyLimit },
  "login:code:mobile": { per: "day", limit: (settings) => settings.login.codeMobileDailyLimit },
  "tech:code:ip": { per: "hour", limit: (settings) => settings.login.codeIpHourlyLimit },
  "tech:code:mobile": { per: "day", limit: (settings) => settings.login.codeMobileDailyLimit },
  "form:code:ip": { per: "hour", limit: (settings) => settings.login.codeIpHourlyLimit },
  "form:code:mobile": { per: "day", limit: (settings) => settings.login.codeMobileDailyLimit },

  // The try-on (docs/decisions/0014-try-on-api.md), and its result messages to one number (ADR 0104).
  "tryon:upload:ip": { per: "hour", limit: (settings) => settings.tryon.uploadIpHourlyLimit },
  "tryon:generate:ip": { per: "hour", limit: (settings) => settings.tryon.generateIpHourlyLimit },
  "tryon:claim:mobile": { per: "day", limit: (settings) => settings.tryon.claimMobileDailyLimit },
  "message:result:mobile": { per: "day", limit: (settings) => settings.tryon.resultMessageMobileDailyLimit },

  // What one client may ask of us in a day.
  "grievance:person": { per: "day", limit: GRIEVANCES_PER_DAY },
  "number_change:person": { per: "day", limit: 3 },
  address_suggest: { per: "day", limit: SUGGESTIONS_PER_DAY },
  ops_address_suggest: { per: "day", limit: SUGGESTIONS_PER_DAY },
  // A discount code checked, right or wrong, so none can be found by guessing (docs/decisions/0108-discount-codes.md).
  "discount_code:ip": { per: "hour", limit: CODE_CHECKS.perAddressHourly },
  "discount_code:person": { per: "day", limit: CODE_CHECKS.perNumberDaily },

  // Invites (docs/decisions/0048-referrals.md): codes that are not there, and an open counted once a day per address.
  "invite_miss:ip": { per: "hour", limit: INVITE_MISSES_PER_ADDRESS_HOURLY },
  invite_open: { per: "day", limit: 1 },

  // The apps' error reports: per address, and from every address together.
  "client_error:ip": { per: "hour", limit: 20 },
  "client_error:all": { per: "hour", limit: 300 },

  // The global daily ceilings (src/domain/ceilings.ts), and their one alert a day each.
  "ceiling:upload": { per: "day", limit: (settings) => settings.tryon.uploadDailyCeiling },
  "ceiling:render": { per: "day", limit: (settings) => settings.tryon.renderDailyCeiling },
  "ceiling:result_read": { per: "day", limit: (settings) => settings.tryon.resultReadDailyCeiling },
  "ceiling:login_code": { per: "day", limit: (settings) => settings.login.codeDailyCeiling },
  "ceiling:tech_code": { per: "day", limit: (settings) => settings.login.techCodeDailyCeiling },
  "ceiling:form_code": { per: "day", limit: (settings) => settings.login.codeDailyCeiling },
  "ceiling:geocode": { per: "day", limit: (settings) => settings.geocode.dailyCeiling },
  "alert:ceiling": { per: "day", limit: 1 },
} as const satisfies Readonly<Record<string, RateLimit>>;

export type RateLimitScope = keyof typeof RATE_LIMITS;

/** Counts with no limit of their own, read to raise an alert once they reach a figure. */
export const COUNTERS = {
  login_code_failed: { per: "hour" },
  turnstile_unavailable: { per: "hour" },
} as const satisfies Readonly<Record<string, { readonly per: Period }>>;

export type Counter = keyof typeof COUNTERS;

/** How many uses the scope's window allows under these settings. */
export function limitOf(scope: RateLimitScope, settings: Settings): number {
  const { limit } = RATE_LIMITS[scope] as RateLimit;
  return typeof limit === "number" ? limit : limit(settings);
}
