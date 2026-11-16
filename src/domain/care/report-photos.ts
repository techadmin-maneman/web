// The photographs a client sends with a report (docs/decisions/0258-the-issue-log.md): up to three a report, each a JPEG
// kept in the client photos bucket under the client, with a note for Care in the chat on the client's number that it
// came; and what Care's console reads of them.

import { inspectImage } from "../../lib/image-bytes.ts";
import { PROBLEM_PHOTOS_MAX, reportReference } from "../../policy/problems.ts";
import { deleteCounted, putCounted } from "../platform/storage-meter.ts";
import { giveCarePerson } from "./care-people.ts";
import { chatOpened } from "./chat-opened.ts";

/** Where a client's report photographs are kept, which erasure deletes with them. */
export const reportPhotosOf = (personId: string): string => `reports/${personId}/`;

const keyOf = (personId: string, reportId: string) =>
  `${reportPhotosOf(personId)}${reportId}/${crypto.randomUUID()}.jpg`;

export type PhotoAdded = { readonly n: number } | "full" | "not_a_jpeg";

/**
 * Keeps the photograph as the report's next and tells Care in the chat on the client's number, which it opens as the
 * client's words from the app do, Care's reply clock running from it; full at three, refused if no JPEG. The file is
 * kept under a key of its own first, then takes its number in one statement, so two sent at once are numbered apart,
 * and one past the three is deleted again.
 */
export async function addReportPhoto(
  db: D1Database,
  bucket: R2Bucket,
  photo: {
    readonly personId: string;
    readonly report: { readonly id: string; readonly number: number; readonly mobile_e164: string };
    readonly bytes: Uint8Array;
    readonly at: Date;
  },
): Promise<PhotoAdded> {
  if (inspectImage(photo.bytes)?.type !== "image/jpeg") return "not_a_jpeg";
  const key = keyOf(photo.personId, photo.report.id);
  await putCounted({ db, bucket, key, bytes: photo.bytes, contentType: "image/jpeg" });
  const at = photo.at.toISOString();
  const taken = await db
    .prepare(
      `INSERT INTO client_report_photos (report_id, n, object_key, bytes, created_at)
       SELECT ?1, COALESCE(MAX(n), 0) + 1, ?2, ?3, ?4 FROM client_report_photos WHERE report_id = ?1
       HAVING COALESCE(MAX(n), 0) < ?5
       RETURNING n`,
    )
    .bind(photo.report.id, key, photo.bytes.byteLength, at, PROBLEM_PHOTOS_MAX)
    .first<number>("n");
  if (taken === null) {
    await deleteCounted(db, bucket, [key]);
    return "full";
  }
  const note = `${reportReference(photo.report.number)}: photo ${String(taken)} of ${String(PROBLEM_PHOTOS_MAX)} came.`;
  // A chat on a number the client has just changed to may not be there yet: the photograph makes it.
  await db.batch([
    chatOpened(db, photo.report.mobile_e164, at),
    db
      .prepare(
        `INSERT INTO chat_messages (id, conversation_id, direction, author, text, sent_at, created_at)
         SELECT ?1, id, 'note', 'system', ?3, ?4, ?4 FROM conversations WHERE mobile_e164 = ?2`,
      )
      .bind(crypto.randomUUID(), photo.report.mobile_e164, note, at),
  ]);
  await giveCarePerson(db, photo.personId, photo.at);
  return { n: taken };
}

export interface ReportPhoto {
  readonly report_id: string;
  readonly reference: string;
  readonly n: number;
  readonly at: string;
}

/** The photographs of the reports of the client a Care chat is with, on the number they hold now; oldest first. */
export async function photosOfChat(db: D1Database, conversationId: string): Promise<ReportPhoto[]> {
  const { results } = await db
    .prepare(
      `SELECT p.report_id, r.number, p.n, p.created_at FROM client_reports r
         JOIN client_report_photos p ON p.report_id = r.id
        WHERE r.person_id IN (SELECT pe.id FROM people pe JOIN conversations c ON c.mobile_e164 = pe.mobile_e164
                                 WHERE c.id = ?1)
        ORDER BY r.number, p.n`,
    )
    .bind(conversationId)
    .all<{ report_id: string; number: number; n: number; created_at: string }>();
  return results.map((row) => ({
    report_id: row.report_id,
    reference: reportReference(row.number),
    n: row.n,
    at: row.created_at,
  }));
}

/** Where one photograph of a report of the client the chat is with is kept, and whose it is; null for any other. */
export async function reportPhotoOf(
  db: D1Database,
  asked: { readonly conversationId: string; readonly reportId: string; readonly n: number },
): Promise<{ readonly key: string; readonly personId: string } | null> {
  const row = await db
    .prepare(
      `SELECT p.object_key, r.person_id FROM client_report_photos p JOIN client_reports r ON r.id = p.report_id
        WHERE p.report_id = ?1 AND p.n = ?2 AND r.person_id IN (SELECT pe.id FROM people pe JOIN conversations c ON c.mobile_e164 = pe.mobile_e164
                                 WHERE c.id = ?3)`,
    )
    .bind(asked.reportId, asked.n, asked.conversationId)
    .first<{ object_key: string; person_id: string }>();
  return row === null ? null : { key: row.object_key, personId: row.person_id };
}
