// How often one number or one address may ask for something, and how many login codes go out in a day. The same in
// every environment, so constants rather than Worker vars: mm-api is at the Workers Free plan's 64 vars and secrets
// (docs/decisions/0009-stay-inside-cloudflare-free-tier.md, rule 6). The daily ceilings that differ by environment,
// and the try-on result's retention, are still vars.
//
// A local run may raise one with a var of the same name, as the browser tests do (playwright.config.ts). The startup
// guard refuses such a var anywhere else.

export const FIXED_LIMITS = {
  // Login codes (docs/decisions/0030-one-time-codes.md): per number a day, per address an hour, and in all a day.
  // Technicians' codes have a day's ceiling of their own, so client traffic never stops a technician signing in.
  OTP_MOBILE_DAILY_LIMIT: 5,
  OTP_IP_HOURLY_LIMIT: 10,
  OTP_DAILY_CEILING: 300,
  OTP_TECH_DAILY_CEILING: 100,
  // Leads and bookings from the site (docs/decisions/0011-lead-api.md): per number and per address, a day.
  LEAD_MOBILE_DAILY_LIMIT: 5,
  LEAD_IP_DAILY_LIMIT: 20,
  // The try-on (docs/decisions/0014-try-on-api.md): per address an hour, and per number a day.
  TRYON_UPLOAD_IP_HOURLY_LIMIT: 5,
  TRYON_GENERATE_IP_HOURLY_LIMIT: 5,
  TRYON_CLAIM_MOBILE_DAILY_LIMIT: 3,
  RESULT_MESSAGE_MOBILE_DAILY_LIMIT: 3,
} as const;

export type FixedLimit = keyof typeof FIXED_LIMITS;
