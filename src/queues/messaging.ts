// The messaging consumer: the only caller of the WhatsApp provider. It sends a
// person the result they asked for at the gate, as the result template with a
// signed result link that expires an hour after sending.
//
// Skipped, never sent: messaging off, a person erased, a number outside the
// staging allowlist, or the daily cap reached. A transient failure is retried
// three times; then the message fails and an alert names it.

import { z } from "zod";
import { PUBLIC_ORIGIN } from "../config/environments.ts";
import { MAX_SEND_ATTEMPTS } from "../config/pipeline.ts";
import { RESULT_LINK_MESSAGE_TTL_MS } from "../config/tryon.ts";
import type { Dependencies } from "../dependencies.ts";
import type { StaticConfig } from "../guard.ts";
import { takeOne } from "../domain/rate-limit.ts";
import { saltedHash } from "../lib/hash.ts";
import { indiaDate } from "../lib/india-time.ts";
import { signToken } from "../lib/signed-token.ts";
import { scrubString, type Logger } from "../log.ts";

export const MessagingMessageSchema = z.object({ message_id: z.uuid(), request_id: z.string() });
export type MessagingMessage = z.infer<typeof MessagingMessageSchema>;

const RETRY_DELAY_SECONDS = 30;
/** A send claimed longer ago than this is taken to have died, and may be claimed again. */
export const SENDING_LEASE_MS = 2 * 60 * 1000;

type Next = { readonly retryAfterSeconds?: number };

export async function handleMessagingBatch(
  batch: MessageBatch,
  db: D1Database,
  config: StaticConfig,
  deps: Dependencies,
  log: Logger,
): Promise<void> {
  for (const message of batch.messages) {
    const parsed = MessagingMessageSchema.safeParse(message.body);
    if (!parsed.success) {
      log.error("messaging_bad_message", { message_id: message.id });
      message.ack();
      continue;
    }
    const messageLog = log.child({ request_id: parsed.data.request_id, outbound_message_id: parsed.data.message_id });

    let next: Next;
    try {
      next = await sendResultMessage(db, config, deps, messageLog, parsed.data.message_id);
    } catch (error) {
      messageLog.error("messaging_step_error", { error });
      next = { retryAfterSeconds: RETRY_DELAY_SECONDS };
    }
    if (next.retryAfterSeconds === undefined) message.ack();
    else message.retry({ delaySeconds: next.retryAfterSeconds });
  }
}

interface MessageRow {
  state: string;
  attempts: number;
  mobile_e164: string;
  name: string;
  erased_at: string | null;
  result_key: string | null;
  job_state: string | null;
}

export async function sendResultMessage(
  db: D1Database,
  config: StaticConfig,
  deps: Dependencies,
  log: Logger,
  messageId: string,
): Promise<Next> {
  const { messaging, tryon, ipHashSalt } = config.settings;
  const now = deps.now();

  const row = await db
    .prepare(
      `SELECT m.state, m.attempts, p.mobile_e164, p.name, p.erased_at, j.result_key, j.state AS job_state
       FROM outbound_messages m
       JOIN people p ON p.id = m.person_id
       LEFT JOIN tryon_jobs j ON j.id = m.subject_id
       WHERE m.id = ?1`,
    )
    .bind(messageId)
    .first<MessageRow>();
  if (row === null) {
    log.error("messaging_unknown_message");
    return {};
  }
  if (row.state !== "queued") return {}; // sent, skipped or failed already

  const skip = async (reason: string): Promise<Next> => {
    await db
      .prepare("UPDATE outbound_messages SET state = 'skipped', last_error = ?2 WHERE id = ?1 AND state = 'queued'")
      .bind(messageId, reason)
      .run();
    log.info("message_skipped", { reason });
    return {};
  };

  if (row.erased_at !== null) return skip("person erased");
  if (!messaging.enabled) return skip("messaging is off");
  if (messaging.allowlist.length > 0 && !messaging.allowlist.includes(row.mobile_e164)) {
    return skip("number not on the allowlist");
  }
  if (row.job_state !== "ready" || row.result_key === null) return skip("no result to send");
  if (row.attempts === 0) {
    const withinCap = await takeOne(db, {
      scope: "message:result:mobile",
      key: await saltedHash(ipHashSalt, `mobile:${row.mobile_e164}`),
      window: indiaDate(now),
      limit: tryon.resultMessageMobileDailyLimit,
    });
    if (!withinCap) return skip("daily message limit reached");
  }

  // Claim this send; another delivery of the same message now leaves it alone.
  const claim = await db
    .prepare(
      `UPDATE outbound_messages SET attempts = attempts + 1, sending_at = ?2
       WHERE id = ?1 AND state = 'queued' AND (sending_at IS NULL OR sending_at < ?3)
       RETURNING attempts`,
    )
    .bind(messageId, now.toISOString(), new Date(now.getTime() - SENDING_LEASE_MS).toISOString())
    .first<{ attempts: number }>();
  if (claim === null) return {};

  // A fresh link for every attempt: the provider fetches the image when it sends.
  const token = await signToken(
    tryon.linkSigningKey,
    "result",
    row.result_key,
    new Date(now.getTime() + RESULT_LINK_MESSAGE_TTL_MS),
  );
  const mediaUrl = `${PUBLIC_ORIGIN[config.environment]}/api/result/${token}`;
  const result = await deps.messaging.sendTemplate(row.mobile_e164, messaging.resultTemplate, [row.name], mediaUrl);

  if (result.ok) {
    await db
      .prepare(
        `UPDATE outbound_messages SET state = 'sent', provider_message_id = ?2, sent_at = ?3, last_error = NULL,
           sending_at = NULL
         WHERE id = ?1`,
      )
      .bind(messageId, result.providerMessageId, deps.now().toISOString())
      .run();
    log.info("message_sent", { attempts: claim.attempts });
    return {};
  }

  const detail = scrubString(result.detail).slice(0, 300);
  if (result.transient && claim.attempts < MAX_SEND_ATTEMPTS) {
    await db
      .prepare("UPDATE outbound_messages SET last_error = ?2, sending_at = NULL WHERE id = ?1")
      .bind(messageId, detail)
      .run();
    log.warn("message_send_retry", { attempts: claim.attempts, detail });
    return { retryAfterSeconds: RETRY_DELAY_SECONDS };
  }

  await db
    .prepare("UPDATE outbound_messages SET state = 'failed', last_error = ?2, sending_at = NULL WHERE id = ?1")
    .bind(messageId, detail)
    .run();
  log.error("message_failed", { attempts: claim.attempts, detail });
  await deps.alert(`Result message ${messageId} failed after ${String(claim.attempts)} attempts: ${detail}`);
  return {};
}
