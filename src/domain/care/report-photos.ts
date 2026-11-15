// The photographs a client sends with a report (docs/decisions/0258-the-issue-log.md): up to three a report, each a JPEG
// kept in the client photos bucket under the client, with a note for Care in the report's chat that it came; and what
// Care's console reads of them.

import { inspectImage } from "../../lib/image-bytes.ts";
import { PROBLEM_PHOTOS_MAX, reportReference } from "../../policy/problems.ts";
import { putCounted } from "../platform/storage-meter.ts";

/** Where a client's report photographs are kept, which erasure deletes with them. */
export const reportPhotosOf = (personId: string): string => `reports/${personId}/`;

const keyOf = (personId: string, reportId: string, n: number) =>
  `${reportPhotosOf(personId)}${reportId}/${String(n)}.jpg`;

export type PhotoAdded = { readonly n: number } | "full" | "not_a_jpeg";

/** Keeps the photograph as the report's next, and tells Care in its chat; full at three, refused if no JPEG. */
export async function addReportPhoto(
  db: D1Database,
  bucket: R2Bucket,
  photo: {
    readonly personId: string;
    readonly report: { readonly id: string; readonly number: number };
    readonly bytes: Uint8Array;
    readonly at: Date;
  },
): Promise<PhotoAdded> {
  if (inspectImage(photo.bytes)?.type !== "image/jpeg") return "not_a_jpeg";
  const held = await db
    .prepare("SELECT COUNT(*) AS n FROM client_report_photos WHERE report_id = ?1")
    .bind(photo.report.id)
    .first<number>("n");
  const n = (held ?? 0) + 1;
  if (n > PROBLEM_PHOTOS_MAX) return "full";
  const key = keyOf(photo.personId, photo.report.id, n);
  await putCounted({ db, bucket, key, bytes: photo.bytes, contentType: "image/jpeg" });
  const at = photo.at.toISOString();
  const note = `${reportReference(photo.report.number)}: photo ${String(n)} of ${String(PROBLEM_PHOTOS_MAX)} came.`;
  await db.batch([
    db
      .prepare(
        `INSERT INTO client_report_photos (report_id, n, object_key, bytes, created_at) VALUES (?1, ?2, ?3, ?4, ?5)
         ON CONFLICT DO NOTHING`,
      )
      .bind(photo.report.id, n, key, photo.bytes.byteLength, at),
    db
      .prepare(
        `INSERT INTO chat_messages (id, conversation_id, direction, author, text, sent_at, created_at)
         SELECT ?1, conversation_id, 'note', 'system', ?3, ?4, ?4 FROM client_reports
          WHERE id = ?2 AND conversation_id IS NOT NULL`,
      )
      .bind(crypto.randomUUID(), photo.report.id, note, at),
  ]);
  return { n };
}

export interface ReportPhoto {
  readonly report_id: string;
  readonly reference: string;
  readonly n: number;
  readonly at: string;
}

/** The photographs of every report a Care chat holds, oldest report first. */
export async function photosOfChat(db: D1Database, conversationId: string): Promise<ReportPhoto[]> {
  const { results } = await db
    .prepare(
      `SELECT p.report_id, r.number, p.n, p.created_at FROM client_reports r
         JOIN client_report_photos p ON p.report_id = r.id
        WHERE r.conversation_id = ?1
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

/** One photograph of a report the chat holds; null for any other. */
export async function reportPhotoFile(
  db: D1Database,
  bucket: R2Bucket,
  asked: { readonly conversationId: string; readonly reportId: string; readonly n: number },
): Promise<R2ObjectBody | null> {
  const key = await db
    .prepare(
      `SELECT p.object_key FROM client_report_photos p JOIN client_reports r ON r.id = p.report_id
        WHERE p.report_id = ?1 AND p.n = ?2 AND r.conversation_id = ?3`,
    )
    .bind(asked.reportId, asked.n, asked.conversationId)
    .first<string>("object_key");
  return key === null ? null : bucket.get(key);
}
