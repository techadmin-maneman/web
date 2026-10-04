// Every five minutes: whether the WhatsApp bridge is connected. Every login
// code goes through it, as SMS is off, so a dropped session locks every client
// and technician out, and nothing else would say so. Ops are told when two runs
// in a row find it closed, with the fix for what is wrong, and the alert closes
// once it is open again.

import type { Dependencies } from "../dependencies.ts";
import type { CallBudget } from "../lib/call-budget.ts";
import type { Logger } from "../log.ts";
import type { BridgeFault } from "../providers/messaging/index.ts";

/** One closed reading can be the bridge reconnecting on its own; two in a row, ten minutes of it, are not. */
const CLOSED_READINGS_BEFORE_ALERT = 2;

const FIXES: Readonly<Record<BridgeFault, string>> = {
  no_instance: "Check EVOLUTION_API_URL and EVOLUTION_INSTANCE_NAME against the bridge's list of instances",
  key_refused: "Check EVOLUTION_API_KEY against the bridge's key",
  logged_out: "Reconnect it by scanning its QR code with the business phone",
  unreachable: "Check the bridge is running at EVOLUTION_API_URL",
};

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
  log.warn("whatsapp_bridge_closed", { fault: connection.fault, detail: connection.detail });
  await deps.alertOnce({
    key: "whatsapp_bridge",
    message:
      `The WhatsApp bridge is not connected (${connection.detail}): no login code or message can be sent until ` +
      `it is. ${FIXES[connection.fault]} (runbook, "WhatsApp (Evolution) is down").`,
    after: CLOSED_READINGS_BEFORE_ALERT,
  });
}
