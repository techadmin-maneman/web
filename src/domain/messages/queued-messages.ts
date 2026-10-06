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
