// A launch by its ID, and the cron's run of those due (ADR 0221): on its day a launch's pincodes are served through
// setServiceArea, as the console's own serve does, so those waiting are told once. One the cron cannot serve, as when
// no technician works in the city by then, waits, saying why. Apart from ./pincode-launches.ts so the cron reads no list.

import { indiaDate } from "../../lib/india-time.ts";
import type { LaunchAlert } from "../booking/waitlist.ts";
import type { AuditActor } from "../platform/audit.ts";
import { setServiceArea } from "./service-area.ts";

export interface PincodeLaunch {
  readonly id: string;
  readonly city: string;
  /** India's date the pincodes are served from. */
  readonly go_live_on: string;
  readonly state: "scheduled" | "live" | "cancelled";
  readonly pincodes: { pincode: string; area: string }[];
  readonly created_by: string;
  readonly created_at: string;
  readonly live_at: string | null;
  /** How many of those waiting it told, once live. */
  readonly alerted: number | null;
  readonly cancelled_at: string | null;
  /** Why the cron has not served it on its day: the refusal setServiceArea gave. */
  readonly held_because: string | null;
}

export type LaunchRow = Omit<PincodeLaunch, "pincodes"> & { pincodes: string };

export const LAUNCH_SELECT = `SELECT l.id, l.city, l.go_live_on, l.state, l.created_by, l.created_at, l.live_at, l.alerted,
       l.cancelled_at, l.held_because,
       json_group_array(json_object('pincode', p.pincode, 'area', s.area)) AS pincodes
     FROM pincode_launches l
     JOIN pincode_launch_pincodes p ON p.launch_id = l.id
     JOIN serviceable_pincodes s ON s.pincode = p.pincode`;

export const launchOf = (row: LaunchRow): PincodeLaunch => ({
  ...row,
  pincodes: (JSON.parse(row.pincodes) as PincodeLaunch["pincodes"]).toSorted((a, b) =>
    a.pincode.localeCompare(b.pincode),
  ),
});

export async function pincodeLaunch(db: D1Database, id: string): Promise<PincodeLaunch | null> {
  const row = await db.prepare(`${LAUNCH_SELECT} WHERE l.id = ?1 GROUP BY l.id`).bind(id).first<LaunchRow>();
  return row === null ? null : launchOf(row);
}

const CRON: AuditActor = { kind: "system", id: "launches" };

/** One launch on its day: what it served and told, or why it waits. */
async function goLive(db: D1Database, launch: PincodeLaunch, now: Date): Promise<readonly LaunchAlert[]> {
  const { results } = await db
    .prepare(
      `SELECT s.pincode FROM pincode_launch_pincodes p JOIN serviceable_pincodes s ON s.pincode = p.pincode
       WHERE p.launch_id = ?1 AND s.served = 0`,
    )
    .bind(launch.id)
    .all<{ pincode: string }>();
  // A pincode ops served by hand before the day was launched then.
  const result =
    results.length === 0
      ? { changed: [], served: 0, alerts: [] }
      : await setServiceArea(db, {
          changes: results.map(({ pincode }) => ({ pincode, served: true, launch_on: launch.go_live_on })),
          actor: CRON,
          requestId: `launch-${launch.id}`,
          now,
        });
  if ("kind" in result) {
    const why = "pincodes" in result ? `${result.kind}: ${result.pincodes.join(" ")}` : result.kind;
    await db.prepare("UPDATE pincode_launches SET held_because = ?2 WHERE id = ?1").bind(launch.id, why).run();
    return [];
  }
  await db
    .prepare(
      `UPDATE pincode_launches SET state = 'live', live_at = ?2, alerted = ?3, held_because = NULL
       WHERE id = ?1 AND state = 'scheduled'`,
    )
    .bind(launch.id, now.toISOString(), result.alerts.length)
    .run();
  return result.alerts;
}

/**
 * The launches due by today, in India, served in the order they were due: the alerts to queue, and those held back
 * with the reason each now gives. The cron's (src/scheduled/cron.ts).
 */
export async function runDueLaunches(
  db: D1Database,
  now: Date,
): Promise<{ readonly alerts: readonly LaunchAlert[]; readonly held: readonly PincodeLaunch[] }> {
  const { results } = await db
    .prepare(
      `SELECT id FROM pincode_launches WHERE state = 'scheduled' AND go_live_on <= ?1 ORDER BY go_live_on, created_at`,
    )
    .bind(indiaDate(now))
    .all<{ id: string }>();
  const alerts: LaunchAlert[] = [];
  const held: PincodeLaunch[] = [];
  for (const { id } of results) {
    const launch = await pincodeLaunch(db, id);
    if (launch === null) continue;
    const told = await goLive(db, launch, now);
    alerts.push(...told);
    const after = await pincodeLaunch(db, id);
    if (after?.state === "scheduled") held.push(after);
  }
  return { alerts, held };
}
