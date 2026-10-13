// The message a recall sends each client who wears its lot (./recalls.ts queues it), as the messaging queue sends it.

import { firstNameOf } from "../../lib/names.ts";
import type { Composed } from "../messages/visit-message-text.ts";

/**
 * What a queued recall notice says: the client's first name. Not sent once the recall is closed, or once every piece
 * of theirs in it has its replacement booked.
 */
export async function composeRecallNotice(db: D1Database, recallId: string, personId: string): Promise<Composed> {
  const row = await db
    .prepare(
      `SELECT pe.name FROM recalls r JOIN recall_pieces rp ON rp.recall_id = r.id JOIN pieces p ON p.id = rp.piece_id
       JOIN people pe ON pe.id = p.person_id
       WHERE r.id = ?1 AND p.person_id = ?2 AND r.closed_at IS NULL AND p.replacement_booked = 0
         AND pe.erased_at IS NULL LIMIT 1`,
    )
    .bind(recallId, personId)
    .first<{ name: string }>();
  if (row === null) return { skip: "the recall is closed, or its replacement is booked" };
  return { template: "recall_notice_v1", params: [firstNameOf(row.name)] };
}
