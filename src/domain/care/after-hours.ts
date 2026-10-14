// The answer to a message sent outside Customer Care's hours (docs/decisions/0133-the-after-hours-reply.md): once
// each night a chat is written in, our number says when Care are back and when they will reply. It is kept in the chat
// as automatic, and never counts as Care answering: the chat still waits on us, and its reply clock still runs.

import { renderMessage } from "../../config/message-templates.ts";
import type { MessagingSettings } from "../../config/settings.ts";
import { indiaHour } from "../../lib/india-time.ts";
import { careIsOn, lastClosed, type CareHours } from "../../policy/care-hours.ts";
import { isMessageHeldBack } from "../../policy/staging-test-records.ts";
import type { MessagingProvider } from "../../providers/messaging/index.ts";
import { messageWording } from "../words/message-wording.ts";

/** The author an automatic reply is kept under, which no member of staff can be. */
export const AUTO_REPLY = "auto";

const TEMPLATE = "care_after_hours_v1";

/** "9 am", "noon", "9 pm", as the message says an hour. */
function hourWords(hour: number): string {
  if (hour === 0) return "midnight";
  if (hour === 12) return "noon";
  return hour < 12 ? `${String(hour)} am` : `${String(hour - 12)} pm`;
}

/** When Care are back, as the message says it: "9 am tomorrow", or "9 am" before they open on the same day. */
function backWords(at: Date, hours: CareHours): string {
  const sameDay = Number(indiaHour(at).slice(11, 13)) < hours.opens;
  return sameDay ? hourWords(hours.opens) : `${hourWords(hours.opens)} tomorrow`;
}

/**
 * Answers a message written at `at` from `mobileE164`, where Care are off and the chat has had no answer since they
 * last closed. Nothing where the provider sends no free text, the chat is not ours, messaging is off, or the reply,
 * being automatic, is one the allowlist holds back like every other automatic message.
 */
export async function answerAfterHours(
  db: D1Database,
  messaging: MessagingProvider,
  settings: MessagingSettings,
  written: { readonly mobileE164: string; readonly at: Date; readonly hours: CareHours },
): Promise<"sent" | "failed" | "none"> {
  const { mobileE164, at, hours } = written;
  if (careIsOn(at, hours) || messaging.reply === undefined || !settings.enabled) return "none";
  const thread = await db
    .prepare(
      `SELECT c.id, (SELECT MAX(m.sent_at) FROM chat_messages m WHERE m.conversation_id = c.id AND m.author = ?2)
         AS last_answered, COALESCE(p.test_record, 0) AS test_record
       FROM conversations c LEFT JOIN people p ON p.id = c.person_id WHERE c.mobile_e164 = ?1`,
    )
    .bind(mobileE164, AUTO_REPLY)
    .first<{ id: string; last_answered: string | null; test_record: number }>();
  if (thread === null || (thread.last_answered ?? "") >= lastClosed(at, hours).toISOString()) return "none";
  if (isMessageHeldBack(settings, { automatic: true, testRecord: thread.test_record === 1, mobileE164 })) return "none";
  const wording = await messageWording(db, TEMPLATE, false);
  const text = renderMessage(TEMPLATE, [backWords(at, hours), hourWords(hours.answered_by)], wording?.text) ?? "";
  const result = await messaging.reply(mobileE164, text);
  const sentAt = at.toISOString();
  await db.batch([
    db
      .prepare(
        `INSERT INTO chat_messages (id, conversation_id, direction, author, text, provider_message_id, sent_at,
           created_at, delivery, failure)
         VALUES (?1, ?2, 'out', ?3, ?4, ?5, ?6, ?6, ?7, ?8)`,
      )
      .bind(
        crypto.randomUUID(),
        thread.id,
        AUTO_REPLY,
        text,
        result.ok ? result.providerMessageId : null,
        sentAt,
        result.ok ? "sent" : "failed",
        result.ok ? null : result.detail.slice(0, 200),
      ),
    db
      .prepare("UPDATE conversations SET last_message_at = MAX(last_message_at, ?2) WHERE id = ?1")
      .bind(thread.id, sentAt),
  ]);
  return result.ok ? "sent" : "failed";
}
