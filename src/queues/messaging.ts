// The messaging consumer: the WhatsApp provider's caller for every message but
// a login code, which src/http/send-code.ts hands to the provider itself once
// the response has gone, never through this queue (ADR 0030), and the word that
// an account is deleted, which goes the same way to a number the erasure has
// just blanked (src/routes/ops/profile.ts). It sends a person the result they
// asked for at the gate, as the result template with a signed result link that
// expires an hour after sending; a client's messages about their visits
// (src/domain/messages/visit-messages.ts) and the reminder of their next one
// (src/domain/visits/next-visit.ts); the receipt for a hair system paid by its link
// (src/domain/money/payment-links.ts); the referral, waitlist and launch messages; the
// booking form's notices to a number we know; ops' rejection of a request to
// delete an account; and the answer to a STOP reply, each composed where its
// subject lives. A reminder or the launch alert ends with the signed link that
// stops them (src/domain/messages/stop-messages.ts).
//
// Skipped, never sent: messaging off, a person erased, an automatic kind to a
// number outside the staging allowlist (a kind that answers the person who
// just acted reaches any number there, ADR 0097) or a test record one of our
// own scripts made off the allowlist regardless of kind, the daily cap
// reached, a reminder or arrival notice whose moment has passed, or a move a
// later move's message tells.
//
// A transient failure is retried three times; then the message fails and an
// alert names it, which ops may send again from Tasks. So does a message that
// throws on each of four deliveries, such as one that cannot be composed. A
// bridge that cannot send at all leaves the message queued: the sweeper sends
// it again once the bridge is open, and fails it if it is still unsent a day on
// (src/scheduled/unsent-messages.ts).

import { PUBLIC_ORIGIN } from "../config/environments.ts";
import { messageClass, RESULT_TEMPLATE, stopLinkPurpose, type TemplateName } from "../config/message-templates.ts";
import { typeOfKey, type ImageType } from "../lib/image-bytes.ts";
import { MAX_SEND_ATTEMPTS } from "../config/pipeline.ts";
import { type MessagingSettings } from "../config/settings.ts";
import { RESULT_LINK_MESSAGE_TTL_MS } from "../config/tryon.ts";
import type { Dependencies } from "../dependencies.ts";
import type { StaticConfig } from "../guard.ts";
import type { MessageKind } from "../config/message-kinds.ts";
import { takeOne } from "../domain/sign-in/rate-limit.ts";
import { mobileHashOf } from "../domain/clients/number-codes.ts";
import { isMessageHeldBack } from "../policy/staging-test-records.ts";

import { firstNameOf } from "../lib/names.ts";
import { signToken } from "../lib/signed-token.ts";
import { composeBookingRefunded } from "../domain/money/auto-refunds.ts";
import { composeCreditsExpiring } from "../domain/money/credit-reminders.ts";
import { composeDeletionRejected } from "../domain/privacy/deletion.ts";
import { composeNextServiceReminder } from "../domain/visits/next-visit.ts";
import { composeLinkPaid } from "../domain/money/payment-links.ts";
import { readOpsInputs } from "../domain/ops/ops-settings.ts";
import {
  composeFriendCredited,
  composeFriendFitted,
  composeReferralRejected,
} from "../domain/referrals/referral-messages.ts";
import { composeSiteNotice, isSiteNoticeKind } from "../domain/ops/site-notices.ts";
import { composeMessagesStopped, stopLink } from "../domain/messages/stop-messages.ts";
import { composeLaunchAlert, composeWaitlistConfirmation } from "../domain/booking/waitlist.ts";
import {
  composeVisitMessage,
  isMessageStale,
  VISIT_MESSAGE_KINDS,
  type VisitMessageKind,
} from "../domain/messages/visit-messages.ts";
import { messageFailedKey } from "../policy/alerts.ts";
import type { SendResult } from "../providers/messaging/index.ts";
import { scrubString, type Logger } from "../log.ts";
import { MINUTE_MS } from "../lib/durations.ts";
import { isOneOf } from "../lib/one-of.ts";
import { MessagingMessageSchema } from "../config/pipeline.ts";
import { runConsumer, type Settle } from "./consumer.ts";

const RETRY_DELAY_SECONDS = 30;
/** A send claimed longer ago than this is taken to have died, and may be claimed again. */
export const SENDING_LEASE_MS = 2 * MINUTE_MS;

type Next = Settle;

/** Each message sent; one whose every try threw is failed, and ops told, so the sweeper does not send it for ever. */
export function handleMessagingBatch(
  batch: MessageBatch,
  db: D1Database,
  config: StaticConfig,
  deps: Dependencies,
  log: Logger,
): Promise<void> {
  return runConsumer(batch, {
    name: "messaging",
    schema: MessagingMessageSchema,
    log,
    logFor: (data) => log.child({ request_id: data.request_id, outbound_message_id: data.message_id }),
    handle: (data, _attempts, messageLog) => sendMessage(db, config, deps, messageLog, data.message_id),
    onError: async (data, attempts, error, messageLog) =>
      attempts < MAX_SEND_ATTEMPTS
        ? { retryAfterSeconds: RETRY_DELAY_SECONDS }
        : failAfterErrors(db, deps, messageLog, data.message_id, error),
  });
}

/** A message whose every delivery threw: failed, and ops told, so the sweeper does not send it again for ever. */
async function failAfterErrors(
  db: D1Database,
  deps: Dependencies,
  log: Logger,
  messageId: string,
  error: unknown,
): Promise<Next> {
  const reason = scrubString(error instanceof Error ? error.message : String(error)).slice(0, 200);
  const detail = `could not be sent: ${reason}`;
  const failed = await db
    .prepare(
      `UPDATE outbound_messages SET state = 'failed', last_error = ?2, sending_at = NULL
       WHERE id = ?1 AND state = 'queued'
       RETURNING kind, person_id`,
    )
    .bind(messageId, detail)
    .first<{ kind: string; person_id: string }>();
  if (failed === null) return {};
  log.error("message_failed", { attempts: MAX_SEND_ATTEMPTS, detail });
  await alertFailed(deps, {
    messageId,
    kind: failed.kind,
    personId: failed.person_id,
    attempts: MAX_SEND_ATTEMPTS,
    detail,
  });
  return {};
}

/** Ops are told of a message that failed for good, and may send it again from Tasks. */
async function alertFailed(
  deps: Dependencies,
  failed: { messageId: string; kind: string; personId: string; attempts: number; detail: string },
): Promise<void> {
  await deps.alertOnce({
    key: messageFailedKey(failed.messageId),
    message: `Message ${failed.messageId} (${failed.kind}) failed after ${String(failed.attempts)} attempts: ${failed.detail}`,
    link: `/clients/${failed.personId}`,
  });
}

interface MessageRow {
  state: string;
  attempts: number;
  created_at: string;
  kind: MessageKind;
  subject_id: string;
  person_id: string;
  mobile_e164: string;
  name: string;
  /** One of our own scripts' records, or a staging test's (src/policy/staging-test-records.ts). */
  test_record: number;
  erased_at: string | null;
}

/**
 * What to send: a template, its params, for the try-on result its image's link, made fresh for each try, and for a
 * reminder or alert the link that stops them.
 */
interface Sendable {
  readonly template: TemplateName;
  readonly params: string[];
  readonly media?: { readonly url: () => Promise<string>; readonly type: ImageType };
  readonly stopLink?: string;
}

type Content = Sendable | { readonly skip: string };

const isVisitKind = (kind: string): kind is VisitMessageKind => isOneOf(VISIT_MESSAGE_KINDS, kind);

/**
 * Whether staging's allowlist should hold this message back: an automatic kind (ADR 0097), or one about a record
 * our own scripts made, whatever its kind (people.test_record, src/policy/staging-test-records.ts). The try-on's
 * gate asks it too, since a try-on whose look would be held back does not run (ADR 0104).
 */
export const messageHeldBack = (
  messaging: MessagingSettings,
  row: Pick<MessageRow, "mobile_e164" | "test_record" | "kind">,
): boolean =>
  isMessageHeldBack(messaging, {
    automatic: messageClass(row.kind) === "automatic",
    testRecord: row.test_record === 1,
    mobileE164: row.mobile_e164,
  });

/** The try-on result: the person's result image, within the daily cap on result messages to one number. */
async function resultContent(db: D1Database, config: StaticConfig, row: MessageRow, now: Date): Promise<Content> {
  const { tryon } = config.settings;
  const job = await db
    .prepare("SELECT result_key, state FROM tryon_jobs WHERE id = ?1")
    .bind(row.subject_id)
    .first<{ result_key: string | null; state: string }>();
  if (job?.state !== "ready" || job.result_key === null) return { skip: "no result to send" };
  if (row.attempts === 0) {
    // The daily cap on try-on results sent to one number, which the gate checks before a look is made (ADR 0104).
    const key = await mobileHashOf(config.settings.ipHashSalt, row.mobile_e164);
    const withinCap = await takeOne(db, "message:result:mobile", key, { now, settings: config.settings });
    if (!withinCap) return { skip: "daily message limit reached" };
  }
  const resultKey = job.result_key;
  return {
    template: RESULT_TEMPLATE,
    // Greeted by first name, and sent on to book the consultation that shows it for real.
    params: [firstNameOf(row.name), `${PUBLIC_ORIGIN[config.environment]}/book`],
    // The provider fetches the image when it sends, declared as what the render stored.
    media: {
      url: async () => {
        const token = await signToken(
          tryon.linkSigningKey,
          "result",
          resultKey,
          new Date(now.getTime() + RESULT_LINK_MESSAGE_TTL_MS),
        );
        return `${PUBLIC_ORIGIN[config.environment]}/api/result/${token}`;
      },
      type: typeOfKey(resultKey),
    },
  };
}

/**
 * What a message of its kind says, as things stand now, or why it is not sent. Every kind is answered: one added to
 * MESSAGE_KINDS and answered nowhere here fails to build, for the switch then has no return for it.
 */
async function contentOf(db: D1Database, config: StaticConfig, row: MessageRow, now: Date): Promise<Content> {
  if (isVisitKind(row.kind)) {
    const composed = await composeVisitMessage(db, row.kind, row.subject_id, row.person_id);
    if ("skip" in composed) return composed;
    const stale = await isMessageStale(db, row.kind, row.subject_id, new Date(row.created_at), now);
    if (stale !== null) return { skip: stale };
    return composed;
  }
  if (isSiteNoticeKind(row.kind)) return composeSiteNotice(db, row.kind, row.person_id);
  switch (row.kind) {
    case "tryon_result":
      return resultContent(db, config, row, now);
    case "next_service_reminder": {
      const days = (await readOpsInputs(db, now)).nextVisitDays;
      return composeNextServiceReminder(db, row.subject_id, row.person_id, days);
    }
    case "booking_refunded":
      return composeBookingRefunded(db, row.subject_id, row.person_id);
    case "link_paid":
      return composeLinkPaid(db, row.subject_id, row.person_id);
    case "friend_fitted":
      return composeFriendFitted(db, row.subject_id, row.person_id);
    case "friend_credited":
      return composeFriendCredited(db, row.subject_id, row.person_id);
    case "referral_rejected":
      return composeReferralRejected(db, row.subject_id, row.person_id);
    case "credits_expiring":
      return composeCreditsExpiring(db, row.subject_id, row.person_id, now);
    case "launch_alert":
      return composeLaunchAlert(db, row.subject_id, row.person_id, config.environment);
    case "waitlist_confirmation":
      return composeWaitlistConfirmation(db, row.subject_id, row.person_id);
    case "deletion_rejected":
      return composeDeletionRejected(db, row.subject_id, row.person_id);
    case "messages_stopped":
      return composeMessagesStopped(db, row.person_id);
  }
}

/** The link a reminder or the launch alert ends with, which stops them; none on any other kind. */
async function stopLinkOf(config: StaticConfig, row: MessageRow, now: Date): Promise<string | undefined> {
  const purpose = stopLinkPurpose(row.kind);
  if (purpose === null) return undefined;
  const origin = PUBLIC_ORIGIN[config.environment];
  return stopLink(origin, config.settings.tryon.linkSigningKey, { personId: row.person_id, purpose }, now);
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
      `SELECT m.state, m.attempts, m.created_at, m.kind, m.subject_id, m.person_id, p.mobile_e164, p.name, p.test_record, p.erased_at
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
  // A record whose number a client took over (src/domain/clients/number-change.ts) has none to send to.
  if (!row.mobile_e164.startsWith("+")) return skip("no number");
  if (!messaging.enabled) return skip("messaging is off");
  if (messageHeldBack(messaging, row)) return skip("number not on the allowlist");
  const content = await contentOf(db, config, row, now);
  if ("skip" in content) return skip(content.skip);
  const stopLink = await stopLinkOf(config, row, now);

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

  const result = await sendContent(deps, row.mobile_e164, { ...content, stopLink });

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
  if (result.bridgeDown === true && claim.attempts < MAX_SEND_ATTEMPTS) {
    await keepQueued(db, messageId, detail);
    log.warn("message_waits_for_bridge", { attempts: claim.attempts, detail });
    return {};
  }
  if (result.transient && claim.attempts < MAX_SEND_ATTEMPTS) {
    await keepQueued(db, messageId, detail);
    log.warn("message_send_retry", { attempts: claim.attempts, detail });
    return { retryAfterSeconds: RETRY_DELAY_SECONDS };
  }

  await db
    .prepare("UPDATE outbound_messages SET state = 'failed', last_error = ?2, sending_at = NULL WHERE id = ?1")
    .bind(messageId, detail)
    .run();
  log.error("message_failed", { attempts: claim.attempts, detail });
  await alertFailed(deps, { messageId, kind: row.kind, personId: row.person_id, attempts: claim.attempts, detail });
  return {};
}

/** Lets the claim go, with why this try failed, for a later try to take. */
async function keepQueued(db: D1Database, messageId: string, detail: string): Promise<void> {
  await db
    .prepare("UPDATE outbound_messages SET last_error = ?2, sending_at = NULL WHERE id = ?1")
    .bind(messageId, detail)
    .run();
}

/** The provider's answer. A throw, minting the image's link or sending, is a failure worth trying again. */
async function sendContent(deps: Dependencies, to: string, content: Sendable): Promise<SendResult> {
  try {
    const media =
      content.media === undefined ? undefined : { url: await content.media.url(), type: content.media.type };
    return await deps.messaging.send({
      to,
      template: content.template,
      params: content.params,
      ...(media === undefined ? {} : { media }),
      ...(content.stopLink === undefined ? {} : { stopLink: content.stopLink }),
    });
  } catch (error) {
    return { ok: false, transient: true, detail: `threw ${error instanceof Error ? error.name : "error"}` };
  }
}
