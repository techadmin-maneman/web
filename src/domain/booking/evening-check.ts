// Google's word on tomorrow before it is fixed (docs/decisions/0290-allotted-the-evening-before.md). After the
// evening's re-plan on the estimate, each drive on each technician's day is asked of Google, on the traffic expected
// when it sets off. Where a drive has too little room and a draft is at either end of it, that technician is ruled out
// of that draft and the day is re-planned once more; what still has too little room is fixed as it stands, so the
// reminders still name who is coming, and ops are told the drive, to shift a visit or call the client.

import { ALERT_WORDS } from "../../config/alert-words.ts";
import type { Settings } from "../../config/settings.ts";
import type { CallBudget } from "../../lib/call-budget.ts";
import { indiaInstant } from "../../lib/india-time.ts";
import { timeOf, type PlanDay } from "../../policy/day-plan.ts";
import { atPace, driveMinutes } from "../../policy/drive-estimate.ts";
import type { Alert } from "../../providers/alerts.ts";
import type { RoutesProvider } from "../../providers/routes/index.ts";
import type { AlertOnce } from "../platform/alerts.ts";
import type { OpsInputs } from "../platform/ops-settings.ts";
import { driveThrough, keptDriveThrough } from "../platform/road-drives.ts";
import { startOf } from "./draft-moves.ts";
import { readDay, readWholeDay, replanDay, type CityDay } from "./replan-day.ts";

/**
 * The drives one city's check may ask Google for: each takes a few of the 1,000 calls an invocation may make
 * (docs/decisions/0112-workers-paid.md). A drive past them stands on the estimate.
 */
export const EVENING_DRIVES = 60;

/** What the check asks Google through, and tells ops by. */
export interface EveningCheck {
  readonly routes: RoutesProvider | null;
  /** The run's drives left to ask, of EVENING_DRIVES. */
  readonly drives: CallBudget;
  readonly alert: Alert;
  readonly alertOnce: AlertOnce;
  readonly settings: Settings;
}

interface Input {
  readonly city: string;
  readonly date: string;
  readonly now: Date;
  readonly inputs: OpsInputs;
}

/** A drive on a technician's day too long for the room before the visit it goes to, in minutes. */
interface Short {
  readonly technicianId: string;
  /** The start of the visit the drive goes to. */
  readonly to: number;
  readonly short: number;
  /** The draft at either end of the drive, which another technician might take; null where neither is one. */
  readonly draftId: string | null;
}

const draftAt = (day: CityDay, technicianId: string, start: number): string | null =>
  day.rows.find((row) => row.technician_id === technicianId && startOf(row) === start)?.id ?? null;

/**
 * Each drive on the city's days that Google's traffic, as it is expected when the drive sets off, leaves too little
 * room for; none where Google is off. A drive between visits sets off once the visit before is wrapped up; the day's
 * first, from home, as late as the estimate lets it.
 */
async function shortsOf(
  db: D1Database,
  check: EveningCheck,
  day: CityDay,
  input: Input & { readonly only?: ReadonlySet<string> },
): Promise<Short[]> {
  const { routes } = check;
  if (routes === null) return [];
  const { bookingRules, driveEstimate } = input.inputs;
  const shorts: Short[] = [];
  for (const [technicianId, plan] of day.days) {
    if (input.only !== undefined && !input.only.has(technicianId)) continue;
    // Only the stops with a pin can be driven; a home not set starts the day at its first.
    const stops = [...plan.stops].sort((a, b) => a.start - b.start).filter((stop) => stop.pin !== null);
    for (const [index, to] of stops.entries()) {
      const from = index === 0 ? null : (stops[index - 1] ?? null);
      const setsOff = from === null ? plan.home : from.pin;
      if (setsOff === null || to.pin === null) continue;
      const readyAt = from === null ? plan.opens : from.end + bookingRules.wrap_up;
      const hour = Math.floor(to.start / 60);
      const estimate = atPace(
        driveMinutes(setsOff, to.pin, hour, driveEstimate),
        plan.pace?.[hour] ?? 100,
        driveEstimate,
      );
      const leaves = from === null ? Math.max(plan.opens, to.start - estimate) : readyAt;
      const drive = { points: [setsOff, to.pin], departing: { departAt: indiaInstant(input.date, timeOf(leaves)) } };
      // A drive Google answered already costs nothing; only a new one takes from the run's drives.
      const kept = await keptDriveThrough(drive.points, drive.departing);
      if (kept === null && !check.drives.spend(1)) return shorts;
      const answer =
        kept ??
        (await driveThrough(
          db,
          { routes, alert: check.alert },
          { ...drive, at: { now: input.now, settings: check.settings } },
        ));
      const leg = answer.ok ? answer.legs[0] : undefined;
      if (leg === undefined) continue;
      const needs = Math.ceil(leg.seconds / 60) + driveEstimate.parking;
      if (needs <= to.start - readyAt) continue;
      shorts.push({
        technicianId,
        to: to.start,
        short: needs - (to.start - readyAt),
        draftId:
          draftAt(day, technicianId, to.start) ?? (from === null ? null : draftAt(day, technicianId, from.start)),
      });
    }
  }
  return shorts;
}

/** Whether a technician's day has the same stops, each at the same start and pin, as before; a day gone has not. */
function sameStops(was: PlanDay | undefined, now: PlanDay | undefined): boolean {
  if (was === undefined || now === undefined) return false;
  const key = (day: PlanDay) =>
    [...day.stops]
      .sort((a, b) => a.start - b.start)
      .map((stop) => `${String(stop.start)}@${String(stop.pin?.lat)},${String(stop.pin?.lng)}`)
      .join("|");
  return key(was) === key(now);
}

/**
 * Tomorrow in a city re-planned on the estimate, checked on Google, re-planned once more without the technicians whose
 * drive left no room, and ops told of each drive still too long.
 */
export async function eveningCheck(db: D1Database, check: EveningCheck, input: Input): Promise<void> {
  await replanDay(db, input);
  const first = await readDay(db, input);
  if (first === null) return;
  let shorts = await shortsOf(db, check, first, input);
  const ruledOut = new Map<string, Set<string>>();
  for (const { draftId, technicianId } of shorts) {
    if (draftId !== null) ruledOut.set(draftId, (ruledOut.get(draftId) ?? new Set()).add(technicianId));
  }
  if (ruledOut.size > 0) {
    await replanDay(db, { ...input, ruledOut });
    // Read even with no draft left, fixed or gone meanwhile: only the days that changed are driven again, and the rest
    // keep what Google said of them.
    const again = await readWholeDay(db, input);
    const ids = new Set([...first.days.keys(), ...again.days.keys()]);
    const changed = new Set([...ids].filter((id) => !sameStops(first.days.get(id), again.days.get(id))));
    shorts = [
      ...shorts.filter((short) => !changed.has(short.technicianId)),
      ...(await shortsOf(db, check, again, { ...input, only: changed })),
    ];
  }
  for (const short of shorts) {
    const named = await db
      .prepare("SELECT name FROM technicians WHERE id = ?1")
      .bind(short.technicianId)
      .first<{ name: string }>();
    await check.alertOnce({
      key: `leg_short:${short.technicianId}:${input.date}:${timeOf(short.to)}`,
      message: ALERT_WORDS.leg_short({
        technician: named?.name ?? short.technicianId,
        day: input.date,
        to: timeOf(short.to),
        short: short.short,
      }),
      link: "/dispatch",
    });
  }
}
