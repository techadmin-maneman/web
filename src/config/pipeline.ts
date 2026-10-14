// Timings and attempt limits for the render, messaging and CRM consumers, and what their queues carry. They live
// here, not in the consumers, so test/node/tooling/usage-budget.test.ts can price the worst case
// (docs/decisions/0194-the-build-on-workers-paid.md), and so whoever sends to a queue (the domain, the routes, the sweeper) reads its contract
// without reaching into its consumer.

import { z } from "zod";
import { HOUR_MS, MINUTE_MS } from "../lib/durations.ts";

/**
 * Polls every 2 s for the first 20 s after submitting, then every 5 s. Every YouCam render had finished by the first
 * 10 s poll when the harness measured them, about 15 s end to end (docs/reference/youcam-api-notes.md).
 */
export const POLL_DELAY_SECONDS = { early: 2, late: 5 } as const;
export const POLL_SLOWDOWN_AFTER_MS = 20_000;
/** A render still running this long after submitting is given up, or made once more (RENDER_ATTEMPTS). */
export const RENDER_GIVE_UP_MS = 2 * MINUTE_MS;
/** A render YouCam's own model failed, or that ran out of time, is made once more: this many renders in all. */
export const RENDER_ATTEMPTS = 2;
/** A submit that failed on the network or a 5xx is tried again, this many times in all. */
export const SUBMIT_ATTEMPTS = 3;
/** A stalled download is tried again soon by the queue, this many times, then by the sweeper. */
export const DOWNLOAD_QUEUE_RETRIES = 3;
/** YouCam's result URL works for two hours. */
export const RESULT_URL_LIFETIME_MS = 2 * HOUR_MS;

/** A result message: the first try plus three retries. */
export const MAX_SEND_ATTEMPTS = 4;

/** A WhatsApp message to send, by its row in outbound_messages. */
export const MessagingMessageSchema = z.object({ message_id: z.uuid(), request_id: z.string() });
export type MessagingMessage = z.infer<typeof MessagingMessageSchema>;

/** A Razorpay event the webhook took, as Razorpay signed it, for its consumer to apply (src/queues/razorpay.ts). */
export const RazorpayEventMessageSchema = z.object({ event_id: z.string(), request_id: z.string(), body: z.string() });
export type RazorpayEventMessage = z.infer<typeof RazorpayEventMessageSchema>;

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
