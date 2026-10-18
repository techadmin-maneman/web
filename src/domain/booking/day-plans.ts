// Each technician's days as booking by start time plans them (docs/decisions/0210-booking-by-start-time.md): their
// hours, home and leave, and what is already on each day, the visits booked and the holds keeping their time, each
// where it is. Read in one batch for every technician and day a booking looks at.
//
// A stop is where its client's address is pinned, else at its pincode's centre, else nowhere, which the plan reaches
// in the shortest drive. A hold made before holds kept their start starts at its half-slot.

import { isAFitting, tierOf, type VisitType } from "../../config/visit-types.ts";
import { statusIn, VISIT_LIVE } from "../../config/statuses.ts";
import { addDays, indiaInstant, indiaTime, weekdayOf } from "../../lib/india-time.ts";
import type { Pin } from "../../lib/geo.ts";
import { minuteOf, type PlanDay, type Stop } from "../../policy/day-plan.ts";
import { hoursOfCity, type WorkingHours } from "../../policy/start-times.ts";
import { keepingItsTime, ownAtCheckout, ownUnpaid } from "./hold-stages.ts";
import { bookedMinutes } from "./occupancy.ts";
import { loadSlotSchedule } from "./slot-times.ts";
import { heldMinutes } from "../visits/visit-times.ts";

/** A client and the service they are booking, whose own hold already at Checkout is theirs to take again. */
interface OwnCheckout {
  readonly personId: string;
  readonly type: string;
  readonly tier: string;
}

/** What the days are read without: the visit being moved, the hold being checked, and the client's own holds. */
export interface Leaving {
  readonly visitId?: string | null;
  readonly holdId?: string | null;
  readonly ownUnpaidOf?: string | null;
  readonly ownCheckoutOf?: OwnCheckout | null;
}

export interface DayPlans {
  /** The technician's day; null where they do not work it, or are away all of it. */
  day(technicianId: string, date: string): PlanDay | null;
  /** The last lock a hold took on the technician's day; the next hold on it takes the one after. */
  revision(technicianId: string, date: string): number;
}

type Located = { readonly lat: number | null; readonly lng: number | null };
const pinOf = (row: Located): Pin | null =>
  row.lat === null || row.lng === null ? null : { lat: row.lat, lng: row.lng };

/** Where a visit's client is: their current address's pin, else the centre of the pincode it is booked at. */
const VISIT_PLACE = `LEFT JOIN addresses d ON d.person_id = a.person_id AND d.replaced_at IS NULL
  LEFT JOIN serviceable_pincodes sp ON sp.pincode = COALESCE(a.service_pincode, d.pincode)`;
/** Where a hold's client is, as VISIT_PLACE. */
const HOLD_PLACE = `LEFT JOIN addresses d ON d.person_id = h.person_id AND d.replaced_at IS NULL
  LEFT JOIN serviceable_pincodes sp ON sp.pincode = COALESCE(h.pincode, d.pincode)`;
const PIN = "COALESCE(d.lat, sp.centre_lat) AS lat, COALESCE(d.lng, sp.centre_lng) AS lng";

interface VisitRow extends Located {
  readonly technician_id: string;
  readonly type: VisitType | null;
  readonly window_start: string;
  readonly window_end: string | null;
  readonly service_minutes: number | null;
}

interface HoldRow extends Located {
  readonly technician_id: string;
  readonly date: string;
  readonly type: VisitType;
  readonly minutes: number | null;
  readonly start_unit: number;
  readonly starts_at: string | null;
}

interface LeaveRow {
  readonly technician_id: string;
  readonly from_date: string;
  readonly to_date: string;
  readonly from_time: string | null;
  readonly to_time: string | null;
}

function statements(
  db: D1Database,
  ids: string,
  read: { readonly from: string; readonly to: string; readonly now: Date; readonly leaving: Leaving },
) {
  const { from, to, now, leaving } = read;
  const own = leaving.ownCheckoutOf ?? null;
  return [
    db
      .prepare(
        `SELECT technician_id, weekday, starts, ends FROM technician_hours WHERE technician_id IN (SELECT value FROM json_each(?1))`,
      )
      .bind(ids),
    db
      .prepare(
        `SELECT id, home_lat AS lat, home_lng AS lng FROM technicians WHERE id IN (SELECT value FROM json_each(?1))`,
      )
      .bind(ids),
    db
      .prepare(
        `SELECT technician_id, from_date, to_date, from_time, to_time FROM technician_leave
         WHERE cancelled_at IS NULL AND from_date <= ?3 AND to_date >= ?2 AND technician_id IN (SELECT value FROM json_each(?1))`,
      )
      .bind(ids, from, to),
    // A visit is the standard tier's where it names no other (migration 0050).
    db
      .prepare(
        `SELECT a.technician_id, a.type, a.window_start, a.window_end, s.minutes AS service_minutes, ${PIN}
         FROM appointments a
         LEFT JOIN services s ON s.kind = a.type AND s.tier = ${tierOf("a.tier")} ${VISIT_PLACE}
         WHERE a.deleted_at IS NULL AND a.technician_id IN (SELECT value FROM json_each(?1))
           AND ${statusIn("a.status", VISIT_LIVE)} AND a.window_start >= ?2 AND a.window_start < ?3 AND a.id IS NOT ?4`,
      )
      .bind(
        ids,
        indiaInstant(from, "00:00").toISOString(),
        indiaInstant(addDays(to, 1), "00:00").toISOString(),
        leaving.visitId ?? null,
      ),
    db
      .prepare(
        `SELECT h.technician_id, h.date, h.type, h.minutes, h.start_unit, h.starts_at, ${PIN}
         FROM slot_holds h ${HOLD_PLACE}
         WHERE h.date BETWEEN ?2 AND ?3 AND h.technician_id IN (SELECT value FROM json_each(?1))
           AND ${keepingItsTime("h", "?4")} AND h.id IS NOT ?5 AND NOT (?6 IS NOT NULL AND ${ownUnpaid("h", "?6")})
           AND NOT (?7 IS NOT NULL AND ${ownAtCheckout("h", { person: "?7", type: "?8", tier: "?9", now: "?4" })})`,
      )
      .bind(
        ids,
        from,
        to,
        now.toISOString(),
        leaving.holdId ?? null,
        leaving.ownUnpaidOf ?? null,
        own?.personId ?? null,
        own?.type ?? null,
        own?.tier ?? null,
      ),
    db
      .prepare(
        `SELECT technician_id, date, MAX(CAST(substr(claim, 5) AS INTEGER)) AS revision FROM slot_claims
         WHERE claim LIKE 'rev:%' AND date BETWEEN ?2 AND ?3 AND technician_id IN (SELECT value FROM json_each(?1))
         GROUP BY technician_id, date`,
      )
      .bind(ids, from, to),
  ] as const;
}

/** Each technician's days from `from` to `to`, India's dates, with the city's working hours for those without their own. */
export async function loadDayPlans(input: {
  readonly db: D1Database;
  readonly technicianIds: readonly string[];
  readonly from: string;
  readonly to: string;
  readonly now: Date;
  readonly hours: WorkingHours;
  readonly leaving?: Leaving;
}): Promise<DayPlans> {
  const { db, from, to, now } = input;
  const ids = JSON.stringify(input.technicianIds);
  const [[weeks, homes, leave, visits, holds, revisions], schedule] = await Promise.all([
    db.batch([...statements(db, ids, { from, to, now, leaving: input.leaving ?? {} })]),
    loadSlotSchedule(db),
  ]);
  const stops = new Map<string, Stop[]>();
  const add = (technicianId: string, date: string, stop: Stop) => {
    const key = `${technicianId}/${date}`;
    stops.set(key, [...(stops.get(key) ?? []), stop]);
  };
  for (const visit of (visits?.results ?? []) as VisitRow[]) {
    const { date, time } = schedule.at(visit.window_start);
    const start = minuteOf(time);
    add(visit.technician_id, date, {
      start,
      end: start + bookedMinutes(visit),
      pin: pinOf(visit),
      fit: isAFitting(visit.type),
    });
  }
  for (const hold of (holds?.results ?? []) as HoldRow[]) {
    const time =
      hold.starts_at === null
        ? schedule.on(hold.date).unitStarts[hold.start_unit]
        : indiaTime(new Date(hold.starts_at));
    const start = minuteOf(time ?? "09:00");
    add(hold.technician_id, hold.date, {
      start,
      end: start + heldMinutes(hold),
      pin: pinOf(hold),
      fit: isAFitting(hold.type),
    });
  }
  return plansOf({
    weeks: (weeks?.results ?? []) as WorkingDayRow[],
    homes: (homes?.results ?? []) as ({ id: string } & Located)[],
    leave: (leave?.results ?? []) as LeaveRow[],
    revisions: (revisions?.results ?? []) as { technician_id: string; date: string; revision: number }[],
    stops,
    hours: input.hours,
  });
}

interface WorkingDayRow {
  readonly technician_id: string;
  readonly weekday: number;
  readonly starts: string;
  readonly ends: string;
}

function plansOf(read: {
  weeks: readonly WorkingDayRow[];
  homes: readonly ({ id: string } & Located)[];
  leave: readonly LeaveRow[];
  revisions: readonly { technician_id: string; date: string; revision: number }[];
  stops: ReadonlyMap<string, Stop[]>;
  hours: WorkingHours;
}): DayPlans {
  const city = hoursOfCity(read.hours);
  const homes = new Map(read.homes.map((home) => [home.id, pinOf(home)]));
  const hoursOn = (technicianId: string, date: string): { starts: string; ends: string } | null => {
    const own = read.weeks.filter((day) => day.technician_id === technicianId);
    if (own.length === 0) return city;
    return own.find((day) => day.weekday === weekdayOf(date)) ?? null;
  };
  return {
    day(technicianId, date) {
      const hours = hoursOn(technicianId, date);
      if (hours === null) return null;
      const leave = read.leave.filter(
        (period) => period.technician_id === technicianId && period.from_date <= date && period.to_date >= date,
      );
      if (leave.some((period) => period.from_time === null || period.to_time === null)) return null;
      return {
        opens: minuteOf(hours.starts),
        closes: minuteOf(hours.ends),
        home: homes.get(technicianId) ?? null,
        stops: read.stops.get(`${technicianId}/${date}`) ?? [],
        away: leave.map((period) => ({
          from: minuteOf(period.from_time ?? "00:00"),
          to: minuteOf(period.to_time ?? "00:00"),
        })),
      };
    },
    revision(technicianId, date) {
      return read.revisions.find((row) => row.technician_id === technicianId && row.date === date)?.revision ?? 0;
    },
  };
}
