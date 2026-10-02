// A client's note on a visit to come (docs/prompts/phase2-backend.md, "Booking":
// POST /appointments/:id/note; docs/decisions/0074-hand-offs-and-messages.md).
// It is kept on the visit, the latest in place of any before it, and the
// technician reads it on the client's card, which opens the day before
// (src/domain/tech-jobs.ts). A visit already under way still takes one; one
// closed, cancelled or gone does not.
//
// It is also written to the visit's appointment in FSM, for ops, by the
// fsm-sync queue (docs/decisions/0099-the-clients-note-in-fsm.md).

/** A note, not a letter: what the technician needs at the door. */
export const CLIENT_NOTE_MAX_CHARS = 500;

/** The alert that the note did not reach FSM, told once and cleared by a later note that does. */
export const clientNoteAlertKey = (visitId: string): string => `client_note_fsm:${visitId}`;

export type NoteSaved =
  | { readonly kind: "saved"; readonly note: string; readonly notedAt: string }
  | { readonly kind: "not_found" }
  | { readonly kind: "closed" };

/** Keeps the client's note on their visit; not found for anyone else's, closed for one no longer to come. */
export async function saveClientNote(
  db: D1Database,
  input: { personId: string; visitId: string; note: string; now: Date },
): Promise<NoteSaved> {
  const visit = await db
    .prepare("SELECT status FROM appointments WHERE id = ?1 AND person_id = ?2 AND deleted_at IS NULL")
    .bind(input.visitId, input.personId)
    .first<{ status: string }>();
  if (visit === null) return { kind: "not_found" };
  const at = input.now.toISOString();
  const saved = await db
    .prepare(
      `UPDATE appointments SET client_note = ?3, client_note_at = ?4
       WHERE id = ?1 AND person_id = ?2 AND status IN ('scheduled', 'dispatched', 'in_progress')`,
    )
    .bind(input.visitId, input.personId, input.note, at)
    .run();
  if (saved.meta.changes === 0) return { kind: "closed" };
  return { kind: "saved", note: input.note, notedAt: at };
}
