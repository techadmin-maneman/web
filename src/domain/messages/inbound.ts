// What any messaging provider reports to us, in one shape (docs/decisions/0197-one-inbound-port.md): a receipt for a
// message we sent, which fills in outbound_messages.delivered_at and read_at for the no-show evidence; or a message
// someone sent our number, filed in the Care inbox, answered out of hours, and, a STOP among them, withdrawing its
// sender's WhatsApp consents (src/domain/messages/stop-messages.ts). Each provider's hook reads its own payloads into
// these (src/routes/hooks/), so receipts, replies and STOP work the same whichever sends.

import type { MessagingSettings } from "../../config/settings.ts";
import type { CareHours } from "../../policy/care-hours.ts";
import { isStopReply } from "../../policy/consents.ts";
import type { MessagingProvider } from "../../providers/messaging/index.ts";
import { answerAfterHours } from "../care/after-hours.ts";
import { fileInbound } from "../care/inbox.ts";
import { stopByReply } from "./stop-messages.ts";

export type Inbound =
  | {
      readonly kind: "receipt";
      /** The provider's ID for the message we sent, as its send answered. */
      readonly providerMessageId: string;
      readonly read: boolean;
    }
  | {
      readonly kind: "message";
      /** The sender's number, E.164. */
      readonly mobileE164: string;
      readonly text: string;
      readonly providerMessageId: string | null;
    };

/** What taking them needs: the database, the time, and the ways to answer. */
export interface InboundContext {
  readonly db: D1Database;
  readonly now: Date;
  readonly requestId: string;
  readonly messaging: MessagingProvider;
  readonly messagingSettings: MessagingSettings;
  readonly careHours: () => Promise<CareHours>;
  /** Puts a message written to the outbox on the queue that sends it. */
  readonly queue: (messageId: string) => Promise<void>;
}

/** A request carrying more than this many receipts or messages has the rest ignored. */
const MOST_INBOUND = 50;

/** Takes what a provider reported; how many receipts were new, messages filed and senders stopped. */
export async function takeInbound(context: InboundContext, events: readonly Inbound[]) {
  let receipts = 0;
  let filed = 0;
  let stopped = 0;
  for (const event of events.slice(0, MOST_INBOUND)) {
    if (event.kind === "receipt") {
      receipts += await recordReceipt(context, event);
      continue;
    }
    await fileInbound(context.db, { ...event, at: context.now });
    filed += 1;
    if (!isStopReply(event.text)) {
      await answerAfterHours(context.db, context.messaging, context.messagingSettings, {
        mobileE164: event.mobileE164,
        at: context.now,
        hours: await context.careHours(),
      });
      continue;
    }
    const answerId = await stopByReply(context.db, {
      mobileE164: event.mobileE164,
      requestId: context.requestId,
      now: context.now,
    });
    if (answerId === null) continue;
    stopped += 1;
    await context.queue(answerId);
  }
  return { receipts, filed, stopped };
}

/** Marks our message delivered, and read if it was. The first report of each wins. */
async function recordReceipt(
  { db, now }: InboundContext,
  receipt: Extract<Inbound, { kind: "receipt" }>,
): Promise<number> {
  const result = await db
    .prepare(
      `UPDATE outbound_messages
       SET delivered_at = COALESCE(delivered_at, ?2),
           read_at = CASE WHEN ?3 = 1 THEN COALESCE(read_at, ?2) ELSE read_at END
       WHERE provider_message_id = ?1 AND (delivered_at IS NULL OR (?3 = 1 AND read_at IS NULL))`,
    )
    .bind(receipt.providerMessageId, now.toISOString(), receipt.read ? 1 : 0)
    .run();
  return result.meta.changes;
}
