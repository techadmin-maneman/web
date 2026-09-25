// Every five minutes: whether the WhatsApp bridge is connected. Every login
// code goes through it, as SMS is off (docs/decisions/0030-one-time-codes.md),
// so a dropped session locks every client and technician out, and nothing else
// would say so. Ops are told when two runs in a row find it closed, and the
// alert closes once it is open again (docs/decisions/0067-alerts-and-silent-failures.md).

import type { Dependencies } from "../dependencies.ts";
import type { CallBudget } from "../lib/call-budget.ts";
import type { Logger } from "../log.ts";

/** One closed reading can be the bridge reconnecting on its own; two in a row, ten minutes of it, are not. */
const CLOSED_READINGS_BEFORE_ALERT = 2;

export async function checkWhatsAppBridge(
  deps: Pick<Dependencies, "messaging" | "alertOnce" | "resolveAlert">,
  log: Logger,
  budget: CallBudget,
): Promise<void> {
  if (!budget.spend(1)) return;
  const connection = await deps.messaging.connection();
  if (connection.open) {
    await deps.resolveAlert("whatsapp_bridge");
    return;
  }
  log.warn("whatsapp_bridge_closed", { detail: connection.detail });
  await deps.alertOnce({
    key: "whatsapp_bridge",
    message:
      `The WhatsApp bridge is not connected (${connection.detail}): no login code or message can be sent until ` +
      'it is. Reconnect it (runbook, "WhatsApp (Evolution) is down").',
    after: CLOSED_READINGS_BEFORE_ALERT,
  });
}
