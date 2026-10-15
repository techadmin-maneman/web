// Where a client stands, as the retention figures count it (docs/decisions/0151-retention-figures.md): active while
// their last first fit, service or replacement is within the service cadence and the grace the At-risk client task
// gives (src/policy/next-visit.ts); lapsed after that; lost once lapsed for the days ops set in Settings · Rules.

import { addDays } from "../lib/india-time.ts";

/** Days lapsed before a client counts as lost, until ops set another. */
export const LOST_AFTER_DAYS = 90;

export type Standing = "active" | "lapsed" | "lost";

export interface StandingDays {
  /** From a fitting to the next service's due day. */
  readonly cadence: number;
  /** After the due day, before a client counts as lapsed. */
  readonly grace: number;
  /** Lapsed for this long, a client counts as lost. */
  readonly lostAfter: number;
}

/** The latest day a client's last first fit, service or replacement may have been done on for them to be lost today. */
export const lostIfDoneBy = (today: string, days: StandingDays): string =>
  addDays(today, -(days.cadence + days.grace + 1 + days.lostAfter));

/** How a client stands on a day, by the day of their last first fit, service or replacement on or before it. */
export function standingOn(day: string, lastFitting: string, days: StandingDays): Standing {
  const lapses = addDays(lastFitting, days.cadence + days.grace + 1);
  if (day < lapses) return "active";
  return day < addDays(lapses, days.lostAfter) ? "lapsed" : "lost";
}
