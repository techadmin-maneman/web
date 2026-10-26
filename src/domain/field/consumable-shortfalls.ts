// A job's consumables short of what its service expects, kept with the technician's reason for ops' task (migration
// 0198; src/policy/consumable-shortfall.ts). Written each time the step lands, a replay or a correction too: a step
// that is short replaces the visit's row, one that is not takes an open row away.

import type { ShortReason, Shortfall } from "../../policy/consumable-shortfall.ts";

export async function keepShortfall(
  db: D1Database,
  input: {
    readonly appointmentId: string;
    readonly technicianId: string;
    readonly shortfall: Shortfall;
    readonly reason: ShortReason | null;
    readonly now: Date;
  },
): Promise<void> {
  const { appointmentId, technicianId, shortfall, reason, now } = input;
  if (reason === null || (shortfall.short.length === 0 && !shortfall.nothing)) {
    await db
      .prepare("DELETE FROM consumable_shortfalls WHERE appointment_id = ?1 AND settled_at IS NULL")
      .bind(appointmentId)
      .run();
    return;
  }
  await db
    .prepare(
      `INSERT INTO consumable_shortfalls (appointment_id, technician_id, reason, short, recorded_at)
       VALUES (?1, ?2, ?3, ?4, ?5)
       ON CONFLICT (appointment_id) DO UPDATE SET technician_id = excluded.technician_id, reason = excluded.reason,
         short = excluded.short`,
    )
    .bind(appointmentId, technicianId, reason, JSON.stringify(shortfall.short), now.toISOString())
    .run();
}
