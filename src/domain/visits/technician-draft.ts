// The writes that settle who takes a visit (docs/decisions/0290-allotted-the-evening-before.md), here with every other
// write to a visit: fixing the drafts the evening's lock reaches, and giving a draft to another technician.

/**
 * Fixes every draft before `after`: those before `tomorrow`, and tomorrow's where `came`, the cities whose reminder
 * hour has come (src/domain/cities/city-rules.ts), holds, its parameters numbered from ?3.
 */
export function fixingDrafts(
  db: D1Database,
  where: {
    readonly tomorrow: string;
    readonly after: string;
    readonly came: { readonly sql: string; readonly values: readonly unknown[] } | null;
  },
): D1PreparedStatement {
  return db
    .prepare(
      `UPDATE appointments SET technician_draft = 0
       WHERE technician_draft = 1 AND window_start < ?2
         AND (window_start < ?1 OR ${where.came === null ? "0" : where.came.sql})`,
    )
    .bind(where.tomorrow, where.after, ...(where.came?.values ?? []));
}

/** Gives a draft to another technician, while it is still a draft. */
export function reallottingDraft(
  db: D1Database,
  move: { readonly visitId: string; readonly technicianId: string; readonly at: string },
): D1PreparedStatement {
  return db
    .prepare("UPDATE appointments SET technician_id = ?2, synced_at = ?3 WHERE id = ?1 AND technician_draft = 1")
    .bind(move.visitId, move.technicianId, move.at);
}
