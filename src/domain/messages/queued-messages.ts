// A message queued to a person: the row the messaging consumer sends from, about the record it names.

import type { MessageKind } from "../../config/message-kinds.ts";
import { insertRow } from "../../lib/sql.ts";

interface QueuedMessage {
  readonly id: string;
  readonly personId: string;
  readonly kind: MessageKind;
  /** What the message is about: its table's name for it, and its ID. */
  readonly subject: { readonly kind: string; readonly id: string };
  readonly at: string;
}

export function queueMessage(db: D1Database, message: QueuedMessage): D1PreparedStatement {
  return insertRow(db, "outbound_messages", {
    id: message.id,
    created_at: message.at,
    person_id: message.personId,
    kind: message.kind,
    subject_kind: message.subject.kind,
    subject_id: message.subject.id,
    state: "queued",
    queued_at: message.at,
  });
}

/**
 * Messages sent before `before`, the oldest first, at most `limit` of them, deleted, unless a no-show or a move holds
 * one as its evidence (src/policy/retention.ts).
 */
export function expiredMessagesStatement(db: D1Database, before: string, limit: number): D1PreparedStatement {
  return db
    .prepare(
      `DELETE FROM outbound_messages WHERE id IN (
         SELECT m.id FROM outbound_messages m INDEXED BY outbound_messages_by_created WHERE m.created_at < ?1
           AND NOT EXISTS (SELECT 1 FROM no_show_cases n WHERE n.message_id = m.id)
           AND NOT EXISTS (SELECT 1 FROM dispatch_moves d WHERE d.message_id = m.id)
         ORDER BY m.created_at LIMIT ?2)`,
    )
    .bind(before, limit);
}
