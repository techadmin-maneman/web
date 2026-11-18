// Google's word on the drives either side of a start a client chose (docs/decisions/0210-booking-by-start-time.md),
// where the routes provider is on. Every start offered is planned on the free estimate; before one is held, Google
// drives the road from the stop before it, or from home, and on to the stop after, and the start is held only where
// both drives, and the time to park, still fit. Where Google cannot answer, the day's ceiling is spent, or a stop has
// no pin, the estimate stands; where Google refuses, ops are told why.

import { minuteOf, type PlanDay, type PlanRules } from "../../policy/day-plan.ts";
import type { Pin } from "../../lib/geo.ts";
import type { Alert } from "../../providers/alerts.ts";
import type { RoutesProvider } from "../../providers/routes/index.ts";
import type { Settings } from "../../config/settings.ts";
import { driveThrough } from "../platform/road-drives.ts";
import { driveMinutes } from "../../policy/drive-estimate.ts";

/** What Google is asked through, from the route's caller. */
export interface DriveCheck {
  readonly routes: RoutesProvider;
  readonly alert: Alert;
  readonly settings: Settings;
  /** Google refused, in its own words: ops are told, once, until it answers again. */
  readonly refused: (detail: string) => Promise<void>;
  /** Google answered: an alert about its refusing closes. */
  readonly answered: () => Promise<void>;
  /**
   * A start Google's drive leaves no room for: the leg, Google's minutes and the estimate's for it, both with parking,
   * which tunes the estimate the starts are offered on; and how far past the gap the start left it runs.
   */
  readonly tooTight?: (short: TooTight) => void;
}

/** A leg Google's drive leaves no room for, in minutes. */
export interface TooTight {
  readonly leg: "before" | "after";
  /** Google's drive, with the time to park. */
  readonly google_minutes: number;
  /** The estimate's for the same leg at the hour it sets off, with the time to park (src/policy/drive-estimate.ts). */
  readonly estimate_minutes: number;
  /** How far past the gap the start left the drive runs. */
  readonly past_gap_minutes: number;
}

const minutesOf = (seconds: number): number => Math.ceil(seconds / 60);

/** The hour of the day `minute` falls in. */
const hourOf = (minute: number): number => Math.floor(minute / 60) % 24;

/** Whether Google's drives leave room for a visit of `minutes` at `time` on the day; true where nothing can be checked. */
export async function drivesFit(
  db: D1Database,
  check: DriveCheck,
  plan: { readonly day: PlanDay; readonly rules: PlanRules; readonly now: Date },
  visit: { readonly time: string; readonly minutes: number; readonly pin: Pin | null },
): Promise<boolean> {
  const { day, rules } = plan;
  const wrap = rules.booking.wrap_up;
  const start = minuteOf(visit.time);
  const end = start + visit.minutes;
  const stops = [...day.stops].sort((a, b) => a.start - b.start);
  const before = stops.filter((stop) => stop.start < start).at(-1);
  const after = stops.find((stop) => stop.start >= end);
  const from = before === undefined ? day.home : before.pin;
  const to = after?.pin ?? null;
  if (visit.pin === null || (from === null && to === null)) return true;
  const points = [...(from === null ? [] : [from]), visit.pin, ...(to === null ? [] : [to])];
  const answer = await driveThrough(db, check, { points, at: { now: plan.now, settings: check.settings } });
  if (!answer.ok) {
    if (answer.detail.startsWith("HTTP 4")) await check.refused(answer.detail);
    return true;
  }
  await check.answered();
  const parking = rules.drive.parking;
  const [first, second] = answer.legs;
  if (from !== null && first !== undefined) {
    const readyFrom = before === undefined ? day.opens : before.end + wrap;
    const google = minutesOf(first.seconds) + parking;
    if (readyFrom + google > start) {
      check.tooTight?.({
        leg: "before",
        google_minutes: google,
        // At the hour the start was offered on: the stop's end, or the day's opening from home (src/policy/day-plan.ts).
        estimate_minutes: driveMinutes(
          from,
          visit.pin,
          hourOf(before === undefined ? day.opens : before.end),
          rules.drive,
        ),
        past_gap_minutes: readyFrom + google - start,
      });
      return false;
    }
  }
  const leaving = from === null ? first : second;
  if (after !== undefined && to !== null && leaving !== undefined) {
    const google = minutesOf(leaving.seconds) + parking;
    if (end + wrap + google > after.start) {
      check.tooTight?.({
        leg: "after",
        google_minutes: google,
        estimate_minutes: driveMinutes(visit.pin, to, hourOf(end + wrap), rules.drive),
        past_gap_minutes: end + wrap + google - after.start,
      });
      return false;
    }
  }
  return true;
}
