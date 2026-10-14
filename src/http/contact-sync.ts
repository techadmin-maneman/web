// A client's new address, or a number change ops confirmed, sent on to the CRM lead, and the client's Books customer
// marked for the Books pass to write. The change is in D1 already; the consumer reads the person afresh, so the
// message says only whose details changed, and a later message also carries an earlier change that could not be sent.

import type { Context } from "hono";
import { markCustomerChanged } from "../domain/books/books-customers.ts";
import type { AppEnv } from "./context.ts";
import { enqueue, type IfLost } from "../domain/platform/enqueue.ts";
import { type CrmSyncMessage } from "../config/pipeline.ts";
import { ALERT_WORDS } from "../config/alert-words.ts";

export async function queueContactSync(c: Context<AppEnv>, personId: string): Promise<void> {
  await markCustomerChanged(c.env.DB, personId, c.var.deps.now());
  await queueCrmContact(c, personId);
}

/** The CRM lead alone, as a chat closed asks (docs/decisions/0137-last-contact-in-the-crm.md). */
export async function queueCrmContact(c: Context<AppEnv>, personId: string): Promise<void> {
  const { requestId, log, deps } = c.var;

  const alertKey = `contact_sync:${personId}`;
  const ifLost: IfLost = {
    alertOnce: deps.alertOnce,
    alert: {
      key: alertKey,
      message: ALERT_WORDS.contact_sync({ client: personId }),
      link: `/clients/${personId}`,
    },
  };
  const toCrm = { update_person_id: personId, request_id: requestId } satisfies CrmSyncMessage;
  if (!(await enqueue(c.env.CRM_QUEUE, toCrm, { log, ifLost }))) return;
  await deps.resolveAlert(alertKey);
}
