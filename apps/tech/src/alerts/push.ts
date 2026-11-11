// This phone's notifications (docs/decisions/0250-guides-and-alerts.md): asked for when the technician taps Turn on,
// then the browser's push subscription, made with the API's key and kept by the API. Made again each time the app
// opens with notifications allowed, so an address the browser renewed reaches the API. A push carries nothing; the
// service worker reads the alert from the API and shows it (../../sw/sw.ts).

import { api } from "../api.ts";

export type OnThisPhone = "unsupported" | "off" | "on" | "blocked";

/** Whether this phone can show the technician's alerts, and whether it has been allowed to. */
export function notificationsHere(): OnThisPhone {
  const able = "Notification" in window && "serviceWorker" in navigator && "PushManager" in window;
  if (!able || !import.meta.env.PROD) return "unsupported";
  if (Notification.permission === "granted") return "on";
  return Notification.permission === "denied" ? "blocked" : "off";
}

/** The browser's subscription for this phone, made if it has none, and given to the API. */
export async function keepSubscription(key: string): Promise<boolean> {
  const registration = await navigator.serviceWorker.ready;
  const subscription =
    (await registration.pushManager.getSubscription()) ??
    (await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key }));
  return (await api.pushSubscribe(subscription.endpoint)).ok;
}

/** Asks the phone to show alerts, from the technician's tap, and subscribes once allowed. */
export async function turnOnNotifications(key: string): Promise<OnThisPhone> {
  const answer = await Notification.requestPermission();
  if (answer !== "granted") return answer === "denied" ? "blocked" : "off";
  await keepSubscription(key);
  return "on";
}
