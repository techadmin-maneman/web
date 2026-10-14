// What a queue gave up on after its last try (wrangler.jsonc, dead_letter_queue), told to ops once each, by what it
// was and what settles it by hand, so nothing is dropped without anyone knowing. A message is let go of once told.

import { z } from "zod";
import { ALERT_WORDS } from "../config/alert-words.ts";
import {
  CrmSyncMessageSchema,
  MessagingMessageSchema,
  RazorpayEventMessageSchema,
  type CrmSyncMessage,
} from "../config/pipeline.ts";
import type { Dependencies } from "../dependencies.ts";
import { sha256Hex } from "../lib/hash.ts";
import type { Logger } from "../log.ts";
import { DONE, runConsumer } from "./consumer.ts";

/** A try-on render a queue gave up on, by its job. */
const RenderLetterSchema = z.object({ job_id: z.uuid() });

/** What a CRM write was about. */
function crmSubject(data: CrmSyncMessage): string {
  if ("lead_id" in data) return `lead ${data.lead_id}`;
  if ("erase_person_id" in data) return `the CRM erasure of person ${data.erase_person_id}`;
  return `client ${data.update_person_id}'s CRM update`;
}

/** What the message was, as its alert's key names it, and what settles it by hand. */
async function letterOf(
  body: unknown,
): Promise<{ readonly subject: string; readonly what: string; readonly todo: string }> {
  const razorpay = RazorpayEventMessageSchema.safeParse(body);
  if (razorpay.success) {
    return {
      subject: `razorpay:${razorpay.data.event_id}`,
      what: `Razorpay event ${razorpay.data.event_id}`,
      todo: "Settle its payment or refund by hand from Razorpay's dashboard",
    };
  }
  const message = MessagingMessageSchema.safeParse(body);
  if (message.success) {
    const messageId = message.data.message_id;
    return { subject: `message:${messageId}`, what: `message ${messageId}`, todo: "Send it again from Tasks" };
  }
  const crm = CrmSyncMessageSchema.safeParse(body);
  if (crm.success) {
    const subject = crmSubject(crm.data);
    return { subject: `crm:${subject}`, what: subject, todo: "Write it in the CRM by hand" };
  }
  const render = RenderLetterSchema.safeParse(body);
  if (render.success) {
    const job = render.data.job_id;
    return { subject: `render:${job}`, what: `try-on ${job}`, todo: "Nothing to settle: the visitor can try again" };
  }
  const id = (await sha256Hex(JSON.stringify(body))).slice(0, 16);
  return { subject: `unknown:${id}`, what: `queue message ${id}`, todo: "Read the logs for queue_gave_up" };
}

export function handleDeadLetters(batch: MessageBatch, deps: Pick<Dependencies, "alertOnce">, log: Logger) {
  return runConsumer(batch, {
    name: "dead_letters",
    schema: z.unknown(),
    log,
    logFor: () => log,
    handle: async (body, _attempts, letterLog) => {
      const letter = await letterOf(body);
      letterLog.error("queue_gave_up", { what: letter.subject });
      await deps.alertOnce({ key: `dead_letter:${letter.subject}`, message: ALERT_WORDS.dead_letter(letter) });
      return DONE;
    },
  });
}
