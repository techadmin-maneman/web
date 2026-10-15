// The national daily ceilings, in the Rules table of ./ops-settings.ts (src/domain/platform/ceilings.ts): ops raise
// one from the console on a busy day, with no release, and are told at 80% of it. Until they set them, each
// environment's own figures stand, as its config gives them (ceilingsIn, ./rate-limits.ts), and the console shows
// those. The per-number and per-address limits stay fixed: they
// are the guard against abuse, and a ceiling only what the whole country may use.

import { CEILINGS, type Ceiling } from "./daily-ceilings.ts";
import type { OpsSetting } from "./ops-settings.ts";

/**
 * The most each may be raised to: the try-on's within R2's monthly budget (scripts/lib/usage-budget.ts), the address
 * lookups within Google's free calls (GEOCODE_CEILING_MAX), the drive times and day maps within Google's free 70,000 a
 * month, and the codes at a figure no real day reaches short of a flood of them.
 */
const MOST: Readonly<Record<Ceiling, number>> = {
  upload: 1000,
  render: 500,
  result_read: 10_000,
  login_code: 5000,
  tech_code: 1000,
  form_code: 5000,
  geocode: 1800,
  route: 2000,
  route_map: 600,
};

/** Production's figures, as wrangler.jsonc and src/config/limits.ts give them (test/node/policy/ceilings.test.ts). */
export const PRODUCTION_CEILINGS: Readonly<Record<Ceiling, number>> = {
  upload: 80,
  render: 40,
  result_read: 800,
  login_code: 300,
  tech_code: 100,
  form_code: 300,
  geocode: 200,
  route: 1000,
  route_map: 300,
};

export const CEILING_SETTINGS = [
  {
    name: "daily_ceilings",
    title: "Daily ceilings",
    note: "The most the whole country may use in a day, past which each answers “busy” until midnight. Raise one before a launch or a campaign; ops are told at 80%.",
    unit: "a day",
    min: 0,
    max: Math.max(...Object.values(MOST)),
    keys: CEILINGS,
    bounds: Object.fromEntries(CEILINGS.map((ceiling) => [ceiling, { min: 0, max: MOST[ceiling] }])),
    fallback: PRODUCTION_CEILINGS,
  },
] as const satisfies readonly OpsSetting[];
