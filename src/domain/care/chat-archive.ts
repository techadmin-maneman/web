// A client's Care thread, closed and quiet for a year, has its messages moved out of D1 into the backups bucket, one
// file for the thread under archive/chats/ (docs/decisions/0207-closed-chats-archived.md). The thread itself stays, and
// says where its file is; its page, the client's data export and an erasure read or delete the file as they do the
// rows. A thread written to again keeps its new messages in D1 until it is quiet a year more, when the file is written
// again with them.
//
// The file is written before the rows go, and the rows go only if the thread is as it was read, so a run cut short or a
// message arriving meanwhile loses nothing: the next run writes the file again, the messages merged by their IDs.
// Like the photographs, the file is the platform's own and never leaves the account, so it is not encrypted beyond R2's
// own encryption at rest, as the weekly backups are for the owner to take away.

import { z } from "zod";
import { ARCHIVED_THREADS_PER_RUN, CHAT_ARCHIVE_MONTHS, monthsBefore } from "../../policy/retention.ts";

const ArchivedMessage = z.object({
  id: z.string(),
  direction: z.enum(["in", "out", "note"]),
  author: z.string(),
  text: z.string().nullable(),
  provider_message_id: z.string().nullable(),
  sent_at: z.string(),
  created_at: z.string(),
  delivery: z.enum(["sent", "failed"]).nullable(),
  failure: z.string().nullable(),
});
type ArchivedMessage = z.infer<typeof ArchivedMessage>;

const ArchiveFile = z.object({ conversation_id: z.string(), messages: z.array(ArchivedMessage) });

/** Where a thread's file is: one a thread, so writing it again replaces it. */
export const chatArchiveKey = (conversationId: string): string => `archive/chats/${conversationId}.json`;

/** The messages a thread's file holds, oldest first; none for a thread never archived, or a file gone. */
export async function archivedMessages(bucket: R2Bucket, key: string | null): Promise<ArchivedMessage[]> {
  if (key === null) return [];
  const file = await bucket.get(key);
  if (file === null) return [];
  return ArchiveFile.parse(await file.json()).messages;
}

/** Two sets of a thread's messages as one, by their IDs, the later set's copy of each kept; oldest first. */
function mergedMessages(
  earlier: readonly ArchivedMessage[],
  later: readonly ArchivedMessage[],
): ArchivedMessage[] {
  const byId = new Map([...earlier, ...later].map((message) => [message.id, message]));
  return [...byId.values()].sort(
    (one, other) => one.sent_at.localeCompare(other.sent_at) || one.id.localeCompare(other.id),
  );
}

interface QuietThread {
  readonly id: string;
  readonly last_message_at: string;
  readonly archive_key: string | null;
}

/** The cron's archive job: up to a run's worth of the threads quiet a year, the oldest first. How many it moved. */
export async function archiveQuietThreads(
  db: D1Database,
  bucket: R2Bucket,
  now: Date,
  limit = ARCHIVED_THREADS_PER_RUN,
): Promise<number> {
  const { results } = await db
    .prepare(
      `SELECT id, last_message_at, archive_key FROM conversations INDEXED BY conversations_to_archive
       WHERE state = 'closed' AND person_id IS NOT NULL AND (archived_through IS NULL OR archived_through <> last_message_at)
         AND last_message_at < ?1
       ORDER BY last_message_at LIMIT ?2`,
    )
    .bind(monthsBefore(now, CHAT_ARCHIVE_MONTHS), limit)
    .all<QuietThread>();
  let moved = 0;
  for (const thread of results) if (await archiveThread(db, bucket, thread)) moved += 1;
  return moved;
}

/** One thread's messages written to its file, then let go from D1 if the thread is still as it was read. */
async function archiveThread(db: D1Database, bucket: R2Bucket, thread: QuietThread): Promise<boolean> {
  const { results: rows } = await db
    .prepare(
      `SELECT id, direction, author, text, provider_message_id, sent_at, created_at, delivery, failure
       FROM chat_messages WHERE conversation_id = ?1 ORDER BY sent_at`,
    )
    .bind(thread.id)
    .all<ArchivedMessage>();
  const messages = mergedMessages(await archivedMessages(bucket, thread.archive_key), rows);
  const key = chatArchiveKey(thread.id);
  await writeFile(bucket, key, thread.id, messages);
  const [marked] = await db.batch([
    db
      .prepare(
        `UPDATE conversations SET archive_key = ?2, archived_messages = ?3, archived_through = last_message_at
         WHERE id = ?1 AND state = 'closed' AND last_message_at = ?4`,
      )
      .bind(thread.id, key, messages.length, thread.last_message_at),
    db
      .prepare(
        `DELETE FROM chat_messages WHERE id IN (SELECT value FROM json_each(?1))
           AND EXISTS (SELECT 1 FROM conversations WHERE id = ?2 AND archive_key = ?3 AND archived_through = ?4)`,
      )
      .bind(JSON.stringify(rows.map((row) => row.id)), thread.id, key, thread.last_message_at),
  ]);
  // A client erased while their thread was read keeps no words of theirs in the file the erasure did not see.
  if (messages.some((message) => message.text !== null) && (await isErased(db, thread.id))) {
    await writeFile(
      bucket,
      key,
      thread.id,
      messages.map((message) => ({ ...message, text: null })),
    );
  }
  return marked?.meta.changes === 1;
}

async function writeFile(
  bucket: R2Bucket,
  key: string,
  conversationId: string,
  messages: readonly ArchivedMessage[],
): Promise<void> {
  await bucket.put(key, JSON.stringify({ conversation_id: conversationId, messages }), {
    httpMetadata: { contentType: "application/json" },
  });
}

async function isErased(db: D1Database, conversationId: string): Promise<boolean> {
  const row = await db
    .prepare(
      "SELECT 1 AS erased FROM conversations c JOIN people p ON p.id = c.person_id WHERE c.id = ?1 AND p.erased_at IS NOT NULL",
    )
    .bind(conversationId)
    .first<{ erased: number }>();
  return row !== null;
}

/**
 * An erased client's archived threads: each file deleted, under the key it has whether or not the thread names it, so
 * one written by a run cut short goes too; then the threads say they have none.
 */
export async function deleteArchivedChats(db: D1Database, bucket: R2Bucket, personId: string): Promise<void> {
  const { results } = await db
    .prepare("SELECT id FROM conversations WHERE person_id = ?1")
    .bind(personId)
    .all<{ id: string }>();
  if (results.length === 0) return;
  await bucket.delete(results.map((thread) => chatArchiveKey(thread.id)));
  await db
    .prepare("UPDATE conversations SET archive_key = NULL, archived_messages = 0 WHERE person_id = ?1")
    .bind(personId)
    .run();
}
