// Answering in the Care inbox (docs/decisions/0130-replies-from-the-care-inbox.md): a reply in the team's own words,
// sent from our number and kept in the thread whether it went or not; a note only staff see; and a thread closed
// with what it was about. Each is audited by the thread's ID, never its words.

import type { MessagingSettings } from "../../config/settings.ts";
import { isMessageHeldBack } from "../../policy/staging-test-records.ts";
import type { MessagingProvider, SendResult } from "../../providers/messaging/index.ts";
import { auditStatement, type AuditActor } from "../ops/audit.ts";

/** What a chat was about, as Care close it. */
export const CLOSE_REASONS = [
  "booking",
  "move_or_cancel",
  "fit_problem",
  "aftercare",
  "billing",
  "sign_in",
  "try_on",
  "data_request",
  "other",
] as const;
export type CloseReason = (typeof CLOSE_REASONS)[number];

interface Change {
  readonly conversationId: string;
  readonly actor: AuditActor;
  readonly requestId: string;
  readonly now: Date;
}

/** The thread's number and whether its client is a test record, or why nothing can be sent to it. */
async function numberOf(
  db: D1Database,
  conversationId: string,
): Promise<{ readonly to: string; readonly testRecord: boolean } | "not_found" | "erased"> {
  const row = await db
    .prepare(
      `SELECT c.mobile_e164, COALESCE(p.test_record, 0) AS test_record
       FROM conversations c LEFT JOIN people p ON p.id = c.person_id WHERE c.id = ?1`,
    )
    .bind(conversationId)
    .first<{ mobile_e164: string; test_record: number }>();
  if (row === null) return "not_found";
  return row.mobile_e164.startsWith("+") ? { to: row.mobile_e164, testRecord: row.test_record === 1 } : "erased";
}

/** Why a reply is kept unsent: messaging is off, or it is to a test record the allowlist holds back. */
function heldBecause(settings: MessagingSettings, number: { readonly to: string; readonly testRecord: boolean }) {
  if (!settings.enabled) return "Not sent: messaging is off.";
  const held = isMessageHeldBack(settings, { automatic: false, testRecord: number.testRecord, mobileE164: number.to });
  return held ? "Not sent: a test record, held back." : null;
}

export type Replied = "sent" | "failed" | "not_found" | "erased" | "unavailable";

/**
 * Sends a reply from our number and keeps it in the thread, sent or failed with why. A sent reply leaves the thread
 * waiting on the client. Unavailable where the provider sends no free text, as MSG91 until support phase 1.
 */
export async function replyTo(
  db: D1Database,
  messaging: MessagingProvider,
  settings: MessagingSettings,
  change: Change & { readonly text: string },
): Promise<Replied> {
  const number = await numberOf(db, change.conversationId);
  if (number === "not_found" || number === "erased") return number;
  if (messaging.reply === undefined) return "unavailable";
  const held = heldBecause(settings, number);
  const result: SendResult =
    held === null ? await messaging.reply(number.to, change.text) : { ok: false, transient: false, detail: held };
  const at = change.now.toISOString();
  await db.batch([
    db
      .prepare(
        `INSERT INTO chat_messages (id, conversation_id, direction, author, text, provider_message_id, sent_at,
           created_at, delivery, failure)
         VALUES (?1, ?2, 'out', ?3, ?4, ?5, ?6, ?6, ?7, ?8)`,
      )
      .bind(
        crypto.randomUUID(),
        change.conversationId,
        change.actor.id,
        change.text,
        result.ok ? result.providerMessageId : null,
        at,
        result.ok ? "sent" : "failed",
        result.ok ? null : result.detail.slice(0, 200),
      ),
    db
      .prepare(
        `UPDATE conversations SET last_message_at = ?2, updated_at = ?2,
           state = CASE WHEN ?3 = 1 AND state = 'open' THEN 'waiting' ELSE state END
         WHERE id = ?1`,
      )
      .bind(change.conversationId, at, result.ok ? 1 : 0),
    auditStatement(
      db,
      {
        surface: "ops",
        actor: change.actor,
        action: "chat.reply",
        subject: { kind: "conversation", id: change.conversationId },
        requestId: change.requestId,
        detail: { sent: result.ok },
      },
      change.now,
    ),
  ]);
  return result.ok ? "sent" : "failed";
}

/** A note on the thread, for staff alone: never sent. */
export async function addNote(
  db: D1Database,
  change: Change & { readonly text: string },
): Promise<"added" | "not_found"> {
  if ((await numberOf(db, change.conversationId)) === "not_found") return "not_found";
  const at = change.now.toISOString();
  await db.batch([
    db
      .prepare(
        `INSERT INTO chat_messages (id, conversation_id, direction, author, text, sent_at, created_at)
         SELECT ?1, id, 'note', ?3, ?4, ?5, ?5 FROM conversations WHERE id = ?2`,
      )
      .bind(crypto.randomUUID(), change.conversationId, change.actor.id, change.text, at),
    auditStatement(
      db,
      {
        surface: "ops",
        actor: change.actor,
        action: "chat.note",
        subject: { kind: "conversation", id: change.conversationId },
        requestId: change.requestId,
      },
      change.now,
    ),
  ]);
  return "added";
}

/** Closes a thread with what it was about; the client writing again reopens it. */
export async function closeConversation(
  db: D1Database,
  change: Change & { readonly reason: CloseReason },
): Promise<"closed" | "not_found"> {
  if ((await numberOf(db, change.conversationId)) === "not_found") return "not_found";
  const at = change.now.toISOString();
  await db.batch([
    db
      .prepare(
        `UPDATE conversations SET state = 'closed', closed_at = ?2, closed_by = ?3, close_reason = ?4, updated_at = ?2
         WHERE id = ?1`,
      )
      .bind(change.conversationId, at, change.actor.id, change.reason),
    auditStatement(
      db,
      {
        surface: "ops",
        actor: change.actor,
        action: "chat.close",
        subject: { kind: "conversation", id: change.conversationId },
        requestId: change.requestId,
        detail: { reason: change.reason },
      },
      change.now,
    ),
  ]);
  return "closed";
}
