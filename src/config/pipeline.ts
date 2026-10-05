// Timings and attempt limits for the render, messaging and CRM consumers, and what their queues carry. They live
// here, not in the consumers, so test/node/tooling/free-tier-budget.test.ts can prove the worst case fits Cloudflare's free
// tier (docs/decisions/0009), and so whoever sends to a queue (the domain, the routes, the sweeper) reads its contract
// without reaching into its consumer.

import { z } from "zod";
import { DAY_MS, MINUTE_MS } from "../lib/durations.ts";

/**
 * Polls every 5 s for the first 30 s after submitting, every 10 s to 3
 * minutes, then once a minute. Pro took 17-49 s and Premium 80-91 s when the
 * harness measured them (API notes, 7.6), but a Premium render on staging took
 * 6 minutes and was billed all the same (docs/decisions/0015-render-pipeline.md).
 */
export const POLL_DELAY_SECONDS = { early: 5, late: 10, slow: 60 } as const;
export const POLL_SLOWDOWN_AFTER_MS = 30_000;
export const POLL_SLOW_AFTER_MS = 180_000;
/** A render still running this long after submitting is given up. */
export const RENDER_GIVE_UP_MS = 15 * MINUTE_MS;
/** A submit that failed on the network or a 5xx is tried again, this many times in all. */
export const SUBMIT_ATTEMPTS = 3;
/** A stalled download is tried again soon by the queue, this many times, then by the sweeper. */
export const DOWNLOAD_QUEUE_RETRIES = 3;
/** AILabTools deletes results after 24 hours (API notes, section 1). */
export const RESULT_URL_LIFETIME_MS = DAY_MS;

/** A result message: the first try plus three retries. */
export const MAX_SEND_ATTEMPTS = 4;

/** A WhatsApp message to send, by its row in outbound_messages. */
export const MessagingMessageSchema = z.object({ message_id: z.uuid(), request_id: z.string() });
export type MessagingMessage = z.infer<typeof MessagingMessageSchema>;

/** After this many failed tries a CRM write stops being retried, and ops are told (docs/decisions/0012-zoho-sync.md). */
export const MAX_SYNC_ATTEMPTS = 10;
export const QUICK_RETRY_DELAY_SECONDS = 30;

export const CrmSyncMessageSchema = z.union([
  z.object({ lead_id: z.uuid(), request_id: z.string() }),
  /** An erased person's record is blanked (docs/decisions/0019-erasure.md). */
  z.object({ erase_person_id: z.uuid(), request_id: z.string() }),
  /**
   * A person whose number or address changed (src/http/contact-sync.ts), or whom ops attached an invite to
   * (src/routes/ops/client-referral.ts), written onto their record; the second is noted on it too.
   */
  z.object({
    update_person_id: z.string().min(1),
    request_id: z.string(),
    invite_attached: z.literal(true).optional(),
  }),
]);
export type CrmSyncMessage = z.infer<typeof CrmSyncMessageSchema>;
