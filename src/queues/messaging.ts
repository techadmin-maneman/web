// The messaging consumer: the WhatsApp provider's caller for every message but
// a login code, which src/http/send-code.ts hands to the provider itself once
// the response has gone, never through this queue (ADR 0030). It sends a person
// the result they asked for at the gate, as the result template with a signed
// result link that expires an hour after sending; a client's messages about
// their visits (src/domain/visit-messages.ts) and the reminder of their next one
// (src/domain/next-visit.ts); and the referral, waitlist and launch messages,
// each composed where its subject lives.
//
// Skipped, never sent: messaging off, a person erased, an automatic kind to a
// number outside the staging allowlist (a kind that answers the person who
// just acted reaches any number there, ADR 0097) or a test record one of our
// own scripts made off the allowlist regardless of kind, or the daily cap
// reached. A transient failure is retried three times; then the message
// fails and an alert names it.

import { z } from "zod";
import { PUBLIC_ORIGIN } from "../config/environments.ts";
import { messageClass } from "../config/message-templates.ts";
import { MAX_SEND_ATTEMPTS } from "../config/pipeline.ts";
import { onAllowlist, type MessagingSettings } from "../config/settings.ts";
import { RESULT_LINK_MESSAGE_TTL_MS } from "../config/tryon.ts";
import type { Dependencies } from "../dependencies.ts";
import type { StaticConfig } from "../guard.ts";
import { takeOne } from "../domain/rate-limit.ts";
import { saltedHash } from "../lib/hash.ts";
import { indiaDate } from "../lib/india-time.ts";
import { signToken } from "../lib/signed-token.ts";
import { composeBookingRefunded } from "../domain/held-bookings.ts";
import { composeNextServiceReminder } from "../domain/next-visit.ts";
import { readOpsInputs } from "../domain/ops-settings.ts";
import { composeFriendCredited, composeFriendFitted, composeReferralRejected } from "../domain/referral-grants.ts";
import { composeLaunchAlert, composeWaitlistConfirmation } from "../domain/waitlist.ts";
import { composeVisitMessage, VISIT_MESSAGE_KINDS, type VisitMessageKind } from "../domain/visit-messages.ts";
import { isStagingTestRecord } from "../policy/staging-test-records.ts";
import { scrubString, type Logger } from "../log.ts";
import { MINUTE_MS } from "../lib/durations.ts";

export const MessagingMessageSchema = z.object({ message_id: z.uuid(), request_id: z.string() });
export type MessagingMessage = z.infer<typeof MessagingMessageSchema>;

const RETRY_DELAY_SECONDS = 30;
/** A send claimed longer ago than this is taken to have died, and may be claimed again. */
export const SENDING_LEASE_MS = 2 * MINUTE_MS;

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
      next = await sendMessage(db, config, deps, messageLog, parsed.data.message_id);
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
  kind: string;
  subject_id: string;
  person_id: string;
  mobile_e164: string;
  name: string;
  erased_at: string | null;
}

/** What to send: a template, its params, and for the try-on result its image's link, made fresh for each try. */
type Content =
  | { readonly template: string; readonly params: string[]; readonly mediaUrl?: () => Promise<string> }
  | { readonly skip: string };

const isVisitKind = (kind: string): kind is VisitMessageKind =>
  (VISIT_MESSAGE_KINDS as readonly string[]).includes(kind);

/**
 * Whether staging's allowlist should hold this message back: an automatic kind (ADR 0097), or one about a record
 * our own scripts made, whatever its kind (isStagingTestRecord, src/policy/staging-test-records.ts).
 */
const heldBackByAllowlist = (
  messaging: MessagingSettings,
  row: Pick<MessageRow, "mobile_e164" | "name" | "kind">,
): boolean =>
  (messageClass(row.kind) === "automatic" || isStagingTestRecord(row.name)) && !onAllowlist(messaging, row.mobile_e164);

/** The try-on result: the person's result image, within the daily cap on result messages to one number. */
async function resultContent(db: D1Database, config: StaticConfig, row: MessageRow, now: Date): Promise<Content> {
  const { messaging, tryon, ipHashSalt } = config.settings;
  const job = await db
    .prepare("SELECT result_key, state FROM tryon_jobs WHERE id = ?1")
    .bind(row.subject_id)
    .first<{ result_key: string | null; state: string }>();
  if (job?.state !== "ready" || job.result_key === null) return { skip: "no result to send" };
  if (row.attempts === 0) {
    const withinCap = await takeOne(db, {
      scope: "message:result:mobile",
      key: await saltedHash(ipHashSalt, `mobile:${row.mobile_e164}`),
      window: indiaDate(now),
      limit: tryon.resultMessageMobileDailyLimit,
    });
    if (!withinCap) return { skip: "daily message limit reached" };
  }
  const resultKey = job.result_key;
  return {
    template: messaging.resultTemplate,
    params: [row.name],
    // The provider fetches the image when it sends.
    mediaUrl: async () => {
      const token = await signToken(
        tryon.linkSigningKey,
        "result",
        resultKey,
        new Date(now.getTime() + RESULT_LINK_MESSAGE_TTL_MS),
      );
      return `${PUBLIC_ORIGIN[config.environment]}/api/result/${token}`;
    },
  };
}

/** What a message of its kind says, as things stand now, or why it is not sent. */
async function contentOf(db: D1Database, config: StaticConfig, row: MessageRow, now: Date): Promise<Content> {
  if (row.kind === "tryon_result") return resultContent(db, config, row, now);
  if (isVisitKind(row.kind)) return composeVisitMessage(db, row.kind, row.subject_id, row.person_id);
  if (row.kind === "next_service_reminder") {
    const days = (await readOpsInputs(db, now)).nextVisitDays;
    return composeNextServiceReminder(db, row.subject_id, row.person_id, days);
  }
  if (row.kind === "booking_refunded") return composeBookingRefunded(db, row.subject_id, row.person_id);
  if (row.kind === "friend_fitted") return composeFriendFitted(db, row.subject_id, row.person_id);
  if (row.kind === "friend_credited") return composeFriendCredited(db, row.subject_id, row.person_id);
  if (row.kind === "referral_rejected") return composeReferralRejected(db, row.subject_id, row.person_id);
  if (row.kind === "launch_alert") return composeLaunchAlert(db, row.subject_id, row.person_id, config.environment);
  if (row.kind === "waitlist_confirmation") return composeWaitlistConfirmation(db, row.subject_id, row.person_id);
  return { skip: "unknown kind" };
}

export async function sendMessage(
  db: D1Database,
  config: StaticConfig,
  deps: Dependencies,
  log: Logger,
  messageId: string,
): Promise<Next> {
  const { messaging } = config.settings;
  const now = deps.now();

  const row = await db
    .prepare(
      `SELECT m.state, m.attempts, m.kind, m.subject_id, m.person_id, p.mobile_e164, p.name, p.erased_at
       FROM outbound_messages m JOIN people p ON p.id = m.person_id
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
    log.info("message_skipped", { kind: row.kind, reason });
    return {};
  };

  if (row.erased_at !== null) return skip("person erased");
  if (!messaging.enabled) return skip("messaging is off");
  if (heldBackByAllowlist(messaging, row)) return skip("number not on the allowlist");
  const content = await contentOf(db, config, row, now);
  if ("skip" in content) return skip(content.skip);

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

  const result = await deps.messaging.send({
    to: row.mobile_e164,
    template: content.template,
    params: content.params,
    ...(content.mediaUrl === undefined ? {} : { mediaUrl: await content.mediaUrl() }),
  });

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
  await deps.alert(`Message ${messageId} (${row.kind}) failed after ${String(claim.attempts)} attempts: ${detail}`);
  return {};
}
