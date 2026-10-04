// A client's new address, or a number change ops confirmed, sent on to the CRM lead, and the client's Books customer
// marked for the Books pass to write. The change is in D1 already; the consumer reads the person afresh, so the
// message says only whose details changed, and a later message also carries an earlier change that could not be sent.

import type { Context } from "hono";
import { markCustomerChanged } from "../domain/books-customers.ts";
import type { AppEnv } from "./context.ts";
import { enqueue, type IfLost } from "../queues/enqueue.ts";
import type { CrmSyncMessage } from "../queues/crm-sync.ts";

export async function queueContactSync(c: Context<AppEnv>, personId: string): Promise<void> {
  const { requestId, log, deps } = c.var;
  await markCustomerChanged(c.env.DB, personId, deps.now());

  const alertKey = `contact_sync:${personId}`;
  const ifLost: IfLost = {
    alertOnce: deps.alertOnce,
    alert: {
      key: alertKey,
      message: `Client ${personId}'s new number or address could not be sent on to the CRM. Update their CRM lead by hand.`,
      link: `/clients/${personId}`,
    },
  };
  const toCrm = { update_person_id: personId, request_id: requestId } satisfies CrmSyncMessage;
  if (!(await enqueue(c.env.CRM_QUEUE, toCrm, { log, ifLost }))) return;
  await deps.resolveAlert(alertKey);
}
