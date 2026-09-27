// A client's new address, or a number change ops confirmed, sent on to FSM's
// contact and the CRM lead (docs/decisions/0070-vendor-correctness.md). The
// change is in D1 already; each consumer reads the person afresh, so the
// message says only whose details changed.

import type { Context } from "hono";
import type { AppEnv } from "./context.ts";
import type { CrmSyncMessage } from "../queues/crm-sync.ts";
import type { FsmSyncMessage } from "../queues/fsm-sync.ts";

export async function queueContactSync(c: Context<AppEnv>, personId: string): Promise<void> {
  const { requestId, log, config, deps } = c.var;
  try {
    await c.env.CRM_QUEUE.send({ update_person_id: personId, request_id: requestId } satisfies CrmSyncMessage);
    if (config.providers.FSM_PROVIDER !== "none") {
      await c.env.FSM_QUEUE.send({
        update_contact_person_id: personId,
        request_id: requestId,
      } satisfies FsmSyncMessage);
    }
  } catch (error) {
    log.warn("contact_sync_enqueue_failed", { person_id: personId, error });
    await deps.alertOnce({
      key: `contact_sync:${personId}`,
      message:
        `Client ${personId}'s new number or address could not be sent on to FSM and the CRM. ` +
        "Update their FSM contact and CRM lead by hand.",
      link: `/clients/${personId}`,
    });
  }
}
