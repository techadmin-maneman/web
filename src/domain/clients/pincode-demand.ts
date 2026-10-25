// Demand for pincodes we do not serve yet, and how recent launches have gone
// (docs/decisions/0224-demand-and-the-next-to-open.md): each lookup of one on the site counted for its day,
// with nobody's data; the pincodes to open next, by those waiting and those who looked; and the pincodes launched in
// the last thirty days, with how many were told and what has been booked there since.

import { addDays, indiaDate } from "../../lib/india-time.ts";
import { waitingByPincode } from "../booking/waitlist.ts";

/** How far back lookups count towards the next to open, and how far back a launch is recent. */
const LOOKED_DAYS = 90;
const RECENT_DAYS = 30;

/** Counts a lookup of a pincode we do not serve, for its day in India. */
export async function countLookup(db: D1Database, pincode: string, now: Date): Promise<void> {
  await db
    .prepare(
      `INSERT INTO pincode_demand (pincode, day, checks) VALUES (?1, ?2, 1)
       ON CONFLICT (pincode, day) DO UPDATE SET checks = checks + 1`,
    )
    .bind(pincode, indiaDate(now))
    .run();
}

export interface NextPincode {
  readonly pincode: string;
  /** Where we hold it, its city and area; else India Post's district and state; else nothing known. */
  readonly city: string | null;
  readonly area: string | null;
  readonly district: string | null;
  readonly state: string | null;
  readonly waiting: number;
  /** Lookups in the last ninety days. */
  readonly looked: number;
}

/** The pincodes not served, most waiting first, then most looked up, up to `most`. */
export async function nextToOpen(db: D1Database, now: Date, most: number): Promise<NextPincode[]> {
  const since = addDays(indiaDate(now), -LOOKED_DAYS);
  const [waiting, { results: looked }] = await Promise.all([
    waitingByPincode(db),
    db
      .prepare("SELECT pincode, SUM(checks) AS looked FROM pincode_demand WHERE day >= ?1 GROUP BY pincode")
      .bind(since)
      .all<{ pincode: string; looked: number }>(),
  ]);
  const lookedBy = new Map(looked.map((row) => [row.pincode, row.looked]));
  const pincodes = [...new Set([...waiting.keys(), ...lookedBy.keys()])];
  if (pincodes.length === 0) return [];
  const { results: places } = await db
    .prepare(
      `SELECT v.value AS pincode, s.city, s.area, s.served, d.district, d.state
       FROM json_each(?1) v
       LEFT JOIN serviceable_pincodes s ON s.pincode = v.value
       LEFT JOIN pincode_directory d ON d.pincode = v.value`,
    )
    .bind(JSON.stringify(pincodes))
    .all<{
      pincode: string;
      city: string | null;
      area: string | null;
      served: number | null;
      district: string | null;
      state: string | null;
    }>();
  return places
    .filter((place) => place.served !== 1)
    .map((place) => ({
      pincode: place.pincode,
      city: place.city,
      area: place.area,
      district: place.district,
      state: place.state,
      waiting: waiting.get(place.pincode)?.waiting ?? 0,
      looked: lookedBy.get(place.pincode) ?? 0,
    }))
    .toSorted((a, b) => b.waiting - a.waiting || b.looked - a.looked || a.pincode.localeCompare(b.pincode))
    .slice(0, most);
}

export interface RecentLaunch {
  readonly pincode: string;
  readonly area: string;
  readonly city: string;
  /** India's date it went live. */
  readonly launched_on: string;
  /** Those waiting who were told it went live. */
  readonly told: number;
  /** Visits booked there since, cancelled ones left out. */
  readonly booked: number;
}

/** The pincodes served from a day in the last thirty, newest first, with who was told and what has been booked. */
export async function recentLaunches(db: D1Database, now: Date): Promise<RecentLaunch[]> {
  const since = new Date(now.getTime() - RECENT_DAYS * 86_400_000).toISOString();
  const { results } = await db
    .prepare(
      `SELECT s.pincode, s.area, s.city, s.launched_at,
         (SELECT COUNT(*) FROM waitlist_entries w WHERE w.pincode = s.pincode AND w.alerted_at >= s.launched_at) AS told,
         (SELECT COUNT(*) FROM appointments a
            WHERE a.service_pincode = s.pincode AND a.status <> 'cancelled' AND a.deleted_at IS NULL
              AND COALESCE(a.first_seen_at, a.synced_at) >= s.launched_at) AS booked
       FROM serviceable_pincodes s
       WHERE s.served = 1 AND s.launched_at >= ?1
       ORDER BY s.launched_at DESC, s.pincode`,
    )
    .bind(since)
    .all<{ pincode: string; area: string; city: string; launched_at: string; told: number; booked: number }>();
  return results.map((row) => ({
    pincode: row.pincode,
    area: row.area,
    city: row.city,
    launched_on: indiaDate(new Date(row.launched_at)),
    told: row.told,
    booked: row.booked,
  }));
}
