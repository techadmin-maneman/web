// A client's new address, or a number change ops confirmed, sent on to the CRM
// lead, and to FSM's contact while FSM holds the record of field work. Without
// FSM, the client's Books customer is marked instead, for the Books pass to
// write. The change is in D1 already; each consumer reads the person afresh, so
// the message says only whose details changed, and a later message also
// carries an earlier change that could not be sent.

import type { Context } from "hono";
import { fieldRecord } from "../config/field-record.ts";
import { markCustomerChanged } from "../domain/books-customers.ts";
import type { AppEnv } from "./context.ts";
import type { CrmSyncMessage } from "../queues/crm-sync.ts";
import type { FsmSyncMessage } from "../queues/fsm-sync.ts";

export async function queueContactSync(c: Context<AppEnv>, personId: string): Promise<void> {
  const { requestId, log, config, deps } = c.var;
  const toFsm = fieldRecord(config.providers) === "fsm";
  if (!toFsm) await markCustomerChanged(c.env.DB, personId, deps.now());
  try {
    await c.env.CRM_QUEUE.send({ update_person_id: personId, request_id: requestId } satisfies CrmSyncMessage);
    if (toFsm) {
      await c.env.FSM_QUEUE.send({
        update_contact_person_id: personId,
        request_id: requestId,
      } satisfies FsmSyncMessage);
    }
  } catch (error) {
    log.warn("contact_sync_enqueue_failed", { person_id: personId, error });
    await deps.alertOnce({
      key: `contact_sync:${personId}`,
      message: toFsm
        ? `Client ${personId}'s new number or address could not be sent on to FSM and the CRM. ` +
          "Update their FSM contact and CRM lead by hand."
        : `Client ${personId}'s new number or address could not be sent on to the CRM. Update their CRM lead by hand.`,
      link: `/clients/${personId}`,
    });
    return;
  }
  await deps.resolveAlert(`contact_sync:${personId}`);
}
