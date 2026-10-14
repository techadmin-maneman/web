// A client's new address, or a number change ops confirmed, sent on to the CRM lead, and the client's Books customer
// marked for the Books pass to write. The change is in D1 already, and what the lead is owed is kept beside it
// (src/domain/clients/contact-updates.ts); the consumer reads the person afresh, so the message says only whose details
// changed, and one the queue loses the sweeper sends again.

import type { Context } from "hono";
import { markCustomerChanged } from "../domain/books/books-customers.ts";
import { oweContactUpdate } from "../domain/clients/contact-updates.ts";
import type { AppEnv } from "./context.ts";
import { enqueue } from "../domain/platform/enqueue.ts";
import { type CrmSyncMessage } from "../config/pipeline.ts";

export async function queueContactSync(c: Context<AppEnv>, personId: string): Promise<void> {
  await markCustomerChanged(c.env.DB, personId, c.var.deps.now());
  await queueCrmContact(c, personId);
}

/**
 * The CRM lead alone, as a chat closed asks (docs/decisions/0137-last-contact-in-the-crm.md); with the invite ops
 * attached, noted on the lead.
 */
export async function queueCrmContact(c: Context<AppEnv>, personId: string, inviteAttached = false): Promise<void> {
  const { requestId, log, deps } = c.var;
  await oweContactUpdate(c.env.DB, { personId, inviteAttached, now: deps.now() }).run();
  const toCrm = {
    update_person_id: personId,
    request_id: requestId,
    ...(inviteAttached ? { invite_attached: true as const } : {}),
  } satisfies CrmSyncMessage;
  await enqueue(c.env.CRM_QUEUE, toCrm, { log, ifLost: "sweeper" });
}
