// What a city needs before its pincodes are served (ADR 0221), each check with what it counts, so the console can say
// what is missing and where it is put right; and a served pincode paused, taking no new clients for a while, and what
// stopping pincodes would leave behind. Only a city with no active technician stops a launch (setServiceArea); the
// rest are for ops to weigh.

import { indiaDate } from "../../lib/india-time.ts";
import { auditStatement, type AuditActor } from "../platform/audit.ts";

export const READINESS_CHECKS = ["technicians", "fitters", "hours", "homes", "stockroom", "gst", "centres"] as const;
type ReadinessCheck = (typeof READINESS_CHECKS)[number];

export interface Readiness {
  readonly check: ReadinessCheck;
  readonly ready: boolean;
  /** What the check counts: the technicians, those trained to fit, those missing hours or a home pin, and so on. */
  readonly count: number;
}

/** Each check for a city, and the pincodes about to be served in it, in the order the console lists them. */
export async function launchReadiness(db: D1Database, city: string, pincodes: readonly string[]): Promise<Readiness[]> {
  const row = await db
    .prepare(
      `SELECT
         (SELECT COUNT(*) FROM technicians t WHERE t.active = 1 AND t.city = ?1) AS technicians,
         (SELECT COUNT(*) FROM technicians t WHERE t.active = 1 AND t.city = ?1 AND t.fits_trained = 1) AS fitters,
         (SELECT COUNT(*) FROM technicians t WHERE t.active = 1 AND t.city = ?1
            AND NOT EXISTS (SELECT 1 FROM technician_hours h WHERE h.technician_id = t.id)) AS without_hours,
         (SELECT COUNT(*) FROM technicians t WHERE t.active = 1 AND t.city = ?1 AND t.home_lat IS NULL) AS without_home,
         (SELECT COUNT(*) FROM stock_places p WHERE p.kind = 'stockroom' AND p.active = 1 AND p.city = ?1) AS stockrooms,
         (SELECT COUNT(*) FROM cities c JOIN gst_registrations g ON g.state_code = c.state_code WHERE c.name = ?1) AS gst,
         (SELECT COUNT(*) FROM serviceable_pincodes s
            WHERE s.pincode IN (SELECT value FROM json_each(?2)) AND s.centre_lat IS NULL) AS unplaced`,
    )
    .bind(city, JSON.stringify(pincodes))
    .first<{
      technicians: number;
      fitters: number;
      without_hours: number;
      without_home: number;
      stockrooms: number;
      gst: number;
      unplaced: number;
    }>();
  if (row === null) return [];
  return [
    { check: "technicians", ready: row.technicians > 0, count: row.technicians },
    { check: "fitters", ready: row.fitters > 0, count: row.fitters },
    { check: "hours", ready: row.without_hours === 0, count: row.without_hours },
    { check: "homes", ready: row.without_home === 0, count: row.without_home },
    { check: "stockroom", ready: row.stockrooms > 0, count: row.stockrooms },
    { check: "gst", ready: row.gst > 0, count: row.gst },
    { check: "centres", ready: row.unplaced === 0, count: row.unplaced },
  ];
}

/** What stopping these pincodes leaves behind: the visits booked there still to come, which stopping does not cancel. */
export async function stopImpact(
  db: D1Database,
  pincodes: readonly string[],
  now: Date,
): Promise<{ readonly visits: number; readonly clients: number }> {
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS visits, COUNT(DISTINCT a.person_id) AS clients FROM appointments a
       WHERE a.service_pincode IN (SELECT value FROM json_each(?1))
         AND a.status = 'scheduled' AND a.window_start >= ?2`,
    )
    .bind(JSON.stringify(pincodes), now.toISOString())
    .first<{ visits: number; clients: number }>();
  return { visits: row?.visits ?? 0, clients: row?.clients ?? 0 };
}

/** Why pincodes cannot be paused: one we do not serve, or a day not after today. */
export type PauseRefusal =
  { readonly kind: "not_later" } | { readonly kind: "not_served"; readonly pincodes: readonly string[] };

/**
 * Pauses served pincodes until a later day, or takes the pause off with null: new clients are offered no consultation
 * there meanwhile, and nothing booked moves. Each pincode changed is audited with it.
 */
export async function pausePincodes(
  db: D1Database,
  input: {
    readonly pincodes: readonly string[];
    readonly until: string | null;
    readonly actor: AuditActor;
    readonly requestId: string;
    readonly now: Date;
  },
): Promise<{ readonly changed: number } | PauseRefusal> {
  const { until, actor, requestId, now } = input;
  if (until !== null && until <= indiaDate(now)) return { kind: "not_later" };
  const { results } = await db
    .prepare(
      `SELECT pincode, served, paused_until FROM serviceable_pincodes WHERE pincode IN (SELECT value FROM json_each(?1))`,
    )
    .bind(JSON.stringify(input.pincodes))
    .all<{ pincode: string; served: number; paused_until: string | null }>();
  const served = new Set(results.filter((row) => row.served === 1).map((row) => row.pincode));
  const notServed = input.pincodes.filter((pincode) => !served.has(pincode));
  if (notServed.length > 0) return { kind: "not_served", pincodes: notServed };
  const changing = results.filter((row) => row.paused_until !== until);
  if (changing.length === 0) return { changed: 0 };
  await db.batch(
    changing.flatMap((row) => [
      db.prepare("UPDATE serviceable_pincodes SET paused_until = ?2 WHERE pincode = ?1").bind(row.pincode, until),
      auditStatement(
        db,
        {
          surface: "ops",
          actor,
          action: until === null ? "pincode.resume" : "pincode.pause",
          subject: { kind: "pincode", id: row.pincode },
          requestId,
          detail: { from: row.paused_until ?? "", to: until ?? "" },
        },
        now,
      ),
    ]),
  );
  return { changed: changing.length };
}
