// This phone's unanswered-lead pushes (docs/decisions/0323-the-unanswered-lead-alert.md), through the console's own
// route and the apps' shared steps (packages/web-kit/web-push.ts). The console's service worker is registered only
// here, on a phone a Care person turns the alerts on for, so a laptop that never does keeps none.

import * as webPush from "@maneman/web-kit/web-push";
import { api } from "../api.ts";

export type { OnThisPhone } from "@maneman/web-kit/web-push";
export { notificationsHere } from "@maneman/web-kit/web-push";

const give = (endpoint: string) => api.leadAlertsPhone(endpoint);

/** Asks this phone to show the alerts, from the person's tap: the worker is registered as the browser asks. */
export async function turnOnLeadAlerts(key: string): Promise<webPush.OnThisPhone> {
  // Both start within the tap, which an iPhone asks of a request to show notifications.
  const registering = navigator.serviceWorker.register("/sw.js");
  const asked = webPush.turnOnNotifications(key, give);
  try {
    await registering;
  } catch {
    return "failed";
  }
  return asked;
}

/**
 * A device whose alerts are allowed subscribes again as the console opens, so a renewed address reaches us; its worker
 * registered again where the browser let it go.
 */
export async function keepLeadAlerts(key: string): Promise<void> {
  if ((await navigator.serviceWorker.getRegistration("/")) === undefined)
    await navigator.serviceWorker.register("/sw.js");
  await webPush.keepSubscription(key, give);
}
