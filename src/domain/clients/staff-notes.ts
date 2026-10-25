// Staff's short notes on a client, at the top of their page in the console: what to bear in mind, in a line or two
// ("prefers mornings", "sensitive scalp"). A change is a new note written in the place of the one before, and a note
// taken off is marked so, so what was written, by whom and when stays; the page shows those still on. Audited by the
// client's and the note's IDs, never a word of it.

import { auditStatementIfWritten, auditStatementWhen, type AuditEntry } from "../platform/audit.ts";
import type { Rows } from "../../lib/rows.ts";

export type StaffNote = Pick<Rows["staff_notes"], "id" | "body" | "written_by" | "written_at">;

type Audit = Omit<AuditEntry, "action" | "subject" | "detail">;

/** The notes still on, newest first. */
export async function notesOf(db: D1Database, personId: string): Promise<StaffNote[]> {
  const { results } = await db
    .prepare(
      `SELECT id, body, written_by, written_at FROM staff_notes
       WHERE person_id = ?1 AND taken_off_at IS NULL ORDER BY written_at DESC, rowid DESC`,
    )
    .bind(personId)
    .all<StaffNote>();
  return results;
}

/**
 * A new note, or one in the place of `replaces`, which is taken off as it is written. "moved" when `replaces` is no
 * longer on: another member of staff changed or took it off since it was read, so nothing is written.
 */
export async function writeNote(
  db: D1Database,
  input: {
    readonly personId: string;
    readonly body: string;
    readonly staff: string;
    readonly replaces: string | null;
    readonly now: Date;
    readonly audit: Audit;
  },
): Promise<"written" | "moved"> {
  const id = crypto.randomUUID();
  const { personId, replaces, now } = input;
  const at = now.toISOString();
  const entry = {
    ...input.audit,
    action: "staff_note.write" as const,
    subject: { kind: "person", id: personId },
    detail: { note: id, replaces },
  };
  const [written] = await db.batch([
    db
      .prepare(
        `INSERT INTO staff_notes (id, person_id, body, written_by, written_at, replaces)
         SELECT ?1, ?2, ?3, ?4, ?5, ?6
         WHERE ?6 IS NULL OR EXISTS (SELECT 1 FROM staff_notes WHERE id = ?6 AND person_id = ?2 AND taken_off_at IS NULL)`,
      )
      .bind(id, personId, input.body, input.staff, at, replaces),
    db
      .prepare(
        `UPDATE staff_notes SET taken_off_at = ?2, taken_off_by = ?3
         WHERE id = ?1 AND taken_off_at IS NULL AND EXISTS (SELECT 1 FROM staff_notes WHERE id = ?4)`,
      )
      .bind(replaces, at, input.staff, id),
    auditStatementIfWritten(db, entry, now, { table: "staff_notes", id }),
  ]);
  return (written?.meta.changes ?? 0) > 0 ? "written" : "moved";
}

/** The note taken off the client's page; one already off stays as it was. */
export async function takeOffNote(
  db: D1Database,
  input: {
    readonly personId: string;
    readonly noteId: string;
    readonly staff: string;
    readonly now: Date;
    readonly audit: Audit;
  },
): Promise<void> {
  const { personId, noteId, now } = input;
  const at = now.toISOString();
  const entry = {
    ...input.audit,
    action: "staff_note.take_off" as const,
    subject: { kind: "person", id: personId },
    detail: { note: noteId },
  };
  await db.batch([
    db
      .prepare(
        `UPDATE staff_notes SET taken_off_at = ?3, taken_off_by = ?4
         WHERE id = ?1 AND person_id = ?2 AND taken_off_at IS NULL`,
      )
      .bind(noteId, personId, at, input.staff),
    auditStatementWhen(db, entry, now, {
      sql: "EXISTS (SELECT 1 FROM staff_notes WHERE id = ?10 AND taken_off_at = ?11 AND taken_off_by = ?12)",
      binds: [noteId, at, input.staff],
    }),
  ]);
}
