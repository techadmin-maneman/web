// The chat a client's words open (docs/decisions/0129-the-care-inbox.md): a message from them on WhatsApp, and a
// report, an update or a photograph from the app.

/**
 * The author of the client's words written in the app, a report, an update or a reopening, beside "client" for their
 * WhatsApp messages: Care's reply clock counts both, WhatsApp's reply window only the latter.
 */
export const FROM_APP = "app";

/**
 * The chat on a number opened by the client's words at `at`, or open again: Care's reply clock runs from them.
 * WhatsApp's reply window is read from their WhatsApp messages alone (./replies.ts).
 */
export const chatOpened = (db: D1Database, mobileE164: string, at: string): D1PreparedStatement =>
  db
    .prepare(
      `INSERT INTO conversations (id, person_id, mobile_e164, state, opened_at, last_message_at, last_inbound_at,
         created_at, updated_at)
       VALUES (?1, (SELECT id FROM people WHERE mobile_e164 = ?2 AND erased_at IS NULL), ?2, 'open', ?3, ?3, ?3, ?3, ?3)
       ON CONFLICT (mobile_e164) DO UPDATE SET
         person_id = COALESCE(conversations.person_id, excluded.person_id),
         state = 'open',
         opened_at = CASE WHEN conversations.state = 'closed' THEN excluded.opened_at ELSE conversations.opened_at END,
         closed_at = NULL,
         closed_by = NULL,
         last_message_at = MAX(conversations.last_message_at, excluded.last_message_at),
         last_inbound_at = excluded.last_inbound_at,
         updated_at = excluded.updated_at`,
    )
    .bind(crypto.randomUUID(), mobileE164, at);
