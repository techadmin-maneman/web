// Launches ops schedule (migration 0197, ADR 0221): pincodes of one city served from a day still to come, listed,
// scheduled and cancelled here; ./launch-runs.ts serves them on the day. Each change is audited in the batch that
// makes it.

import { indiaDate } from "../../lib/india-time.ts";
import { auditStatement, type AuditActor } from "../platform/audit.ts";
import { LAUNCH_SELECT, launchOf, pincodeLaunch, type LaunchRow, type PincodeLaunch } from "./launch-runs.ts";

/** Every launch: those scheduled, soonest first, then the rest, newest first. */
export async function pincodeLaunches(db: D1Database): Promise<PincodeLaunch[]> {
  const { results } = await db
    .prepare(
      `${LAUNCH_SELECT} GROUP BY l.id
       ORDER BY l.state = 'scheduled' DESC, CASE WHEN l.state = 'scheduled' THEN l.go_live_on END, l.created_at DESC`,
    )
    .all<LaunchRow>();
  return results.map(launchOf);
}

/** Why a launch cannot be scheduled: its day is not after today, or these pincodes cannot go in it. */
export type ScheduleRefusal =
  | { readonly kind: "not_later" }
  | { readonly kind: "unknown" | "elsewhere" | "served" | "scheduled"; readonly pincodes: readonly string[] };

interface Written {
  readonly actor: AuditActor;
  readonly requestId: string;
  readonly now: Date;
}

/** Why these pincodes cannot be launched in this city on a later day; null where they can. */
async function scheduleRefusal(
  db: D1Database,
  input: { readonly city: string; readonly pincodes: readonly string[] },
): Promise<ScheduleRefusal | null> {
  const { results } = await db
    .prepare(
      `SELECT s.pincode, s.city, s.served,
         EXISTS (SELECT 1 FROM pincode_launch_pincodes p JOIN pincode_launches l ON l.id = p.launch_id
                 WHERE p.pincode = s.pincode AND l.state = 'scheduled') AS scheduled
       FROM serviceable_pincodes s WHERE s.pincode IN (SELECT value FROM json_each(?1))`,
    )
    .bind(JSON.stringify(input.pincodes))
    .all<{ pincode: string; city: string; served: number; scheduled: number }>();
  const held = new Map(results.map((row) => [row.pincode, row]));
  const unknown = input.pincodes.filter((pincode) => !held.has(pincode));
  if (unknown.length > 0) return { kind: "unknown", pincodes: unknown };
  const failing = (test: (row: (typeof results)[number]) => boolean) => results.filter(test).map((row) => row.pincode);
  const elsewhere = failing((row) => row.city !== input.city);
  if (elsewhere.length > 0) return { kind: "elsewhere", pincodes: elsewhere };
  const served = failing((row) => row.served === 1);
  if (served.length > 0) return { kind: "served", pincodes: served };
  const scheduled = failing((row) => row.scheduled === 1);
  return scheduled.length > 0 ? { kind: "scheduled", pincodes: scheduled } : null;
}

/**
 * Schedules pincodes of one city, held and not served, to be served from a later day. A pincode is in one scheduled
 * launch at most; serving one today is the table's own step, which says who it messages first.
 */
export async function scheduleLaunch(
  db: D1Database,
  input: Written & { readonly city: string; readonly pincodes: readonly string[]; readonly goLiveOn: string },
): Promise<PincodeLaunch | ScheduleRefusal> {
  const { city, goLiveOn, actor, requestId, now } = input;
  const pincodes = [...new Set(input.pincodes)];
  if (goLiveOn <= indiaDate(now)) return { kind: "not_later" };
  const refused = await scheduleRefusal(db, { city, pincodes });
  if (refused !== null) return refused;

  const id = crypto.randomUUID();
  await db.batch([
    db
      .prepare(
        `INSERT INTO pincode_launches (id, city, go_live_on, state, created_by, created_at)
         VALUES (?1, ?2, ?3, 'scheduled', ?4, ?5)`,
      )
      .bind(id, city, goLiveOn, actor.id, now.toISOString()),
    ...pincodes.map((pincode) =>
      db.prepare("INSERT INTO pincode_launch_pincodes (launch_id, pincode) VALUES (?1, ?2)").bind(id, pincode),
    ),
    auditStatement(
      db,
      {
        surface: "ops",
        actor,
        action: "launch.schedule",
        subject: { kind: "launch", id },
        requestId,
        detail: { city, go_live_on: goLiveOn, pincodes: pincodes.join(" ") },
      },
      now,
    ),
  ]);
  return (await pincodeLaunch(db, id)) ?? { kind: "unknown", pincodes };
}

/** Cancels a launch still scheduled; its pincodes stay as they are, unserved. */
export async function cancelLaunch(
  db: D1Database,
  input: Written & { readonly id: string },
): Promise<PincodeLaunch | "not_found" | "not_scheduled"> {
  const { id, actor, requestId, now } = input;
  const launch = await pincodeLaunch(db, id);
  if (launch === null) return "not_found";
  if (launch.state !== "scheduled") return "not_scheduled";
  await db.batch([
    db
      .prepare(
        `UPDATE pincode_launches SET state = 'cancelled', cancelled_by = ?2, cancelled_at = ?3
         WHERE id = ?1 AND state = 'scheduled'`,
      )
      .bind(id, actor.id, now.toISOString()),
    auditStatement(
      db,
      { surface: "ops", actor, action: "launch.cancel", subject: { kind: "launch", id }, requestId },
      now,
    ),
  ]);
  return (await pincodeLaunch(db, id)) ?? "not_found";
}
