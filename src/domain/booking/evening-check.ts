// Google's word on tomorrow before it is fixed (docs/decisions/0290-allotted-the-evening-before.md). After the
// evening's re-plan on the estimate, each technician's day is driven on Google, leg by leg. Where a leg has too little
// room and a draft is on it, that technician is ruled out of that draft and the day is re-planned once more; what
// still has too little room is fixed as it stands, so the reminders still name who is coming, and ops are told the
// drive, to shift a visit or call the client.

import { ALERT_WORDS } from "../../config/alert-words.ts";
import type { Settings } from "../../config/settings.ts";
import { timeOf } from "../../policy/day-plan.ts";
import type { Alert } from "../../providers/alerts.ts";
import type { Point, RoutesProvider } from "../../providers/routes/index.ts";
import type { AlertOnce } from "../platform/alerts.ts";
import type { OpsInputs } from "../platform/ops-settings.ts";
import { driveThrough } from "../platform/road-drives.ts";
import { readDay, replanDay, startOf, type CityDay } from "./replan-day.ts";

/** What the check asks Google through, and tells ops by. */
export interface EveningCheck {
  readonly routes: RoutesProvider | null;
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

/** Each drive on the city's days that Google's traffic leaves too little room for; none where Google is off. */
async function shortsOf(db: D1Database, check: EveningCheck, day: CityDay, input: Input): Promise<Short[]> {
  const { routes } = check;
  if (routes === null) return [];
  const shorts: Short[] = [];
  for (const [technicianId, plan] of day.days) {
    // Only the stops with a pin can be driven; a home not set starts the day at its first.
    const stops = [...plan.stops].sort((a, b) => a.start - b.start).filter((stop) => stop.pin !== null);
    const points: Point[] = [...(plan.home === null ? [] : [plan.home]), ...stops.flatMap((stop) => stop.pin ?? [])];
    if (stops.length === 0 || points.length < 2) continue;
    const answer = await driveThrough(
      db,
      { routes, alert: check.alert },
      {
        points,
        at: { now: input.now, settings: check.settings },
      },
    );
    if (!answer.ok) continue;
    const fromHome = plan.home === null ? 0 : 1;
    answer.legs.forEach((leg, index) => {
      const to = stops[index + 1 - fromHome];
      const from = index - fromHome < 0 ? undefined : stops[index - fromHome];
      if (to === undefined) return;
      const readyAt = from === undefined ? plan.opens : from.end + input.inputs.bookingRules.wrap_up;
      const needs = Math.ceil(leg.seconds / 60) + input.inputs.driveEstimate.parking;
      if (needs <= to.start - readyAt) return;
      shorts.push({
        technicianId,
        to: to.start,
        short: needs - (to.start - readyAt),
        draftId:
          draftAt(day, technicianId, to.start) ?? (from === undefined ? null : draftAt(day, technicianId, from.start)),
      });
    });
  }
  return shorts;
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
    const again = await readDay(db, input);
    shorts = again === null ? [] : await shortsOf(db, check, again, input);
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
