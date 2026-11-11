// This phone's notifications (docs/decisions/0250-guides-and-alerts.md): asked for when the technician taps Turn on,
// then the browser's push subscription, made with the API's key and kept by the API. Made again each time the app
// opens with notifications allowed, so an address the browser renewed reaches the API. A push carries nothing; the
// service worker reads the alert from the API and shows it (../../sw/sw.ts).

import { api } from "../api.ts";

/** Whether the phone shows the alerts; "failed" is allowed but not subscribed, which Turn on tries again. */
export type OnThisPhone = "unsupported" | "off" | "on" | "blocked" | "failed";

/** Whether this phone can show the technician's alerts, and whether it has been allowed to. */
export function notificationsHere(): OnThisPhone {
  const able = "Notification" in window && "serviceWorker" in navigator && "PushManager" in window;
  if (!able || !import.meta.env.PROD) return "unsupported";
  if (Notification.permission === "granted") return "on";
  return Notification.permission === "denied" ? "blocked" : "off";
}

/** A base64url key's bytes. */
function bytesOf(key: string): Uint8Array {
  const base64 = key.replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, "=")), (char) => char.charCodeAt(0));
}

/** Whether a subscription was made with this key: one made with a key since replaced takes no pushes. */
function madeWith(held: ArrayBuffer | null, key: string): boolean {
  if (held === null) return false;
  const [a, b] = [new Uint8Array(held), bytesOf(key)];
  return a.length === b.length && a.every((byte, index) => byte === b[index]);
}

/** The browser's subscription for this phone, made anew if it has none or one with an old key, given to the API. */
export async function keepSubscription(key: string): Promise<boolean> {
  const registration = await navigator.serviceWorker.ready;
  let subscription = await registration.pushManager.getSubscription();
  if (subscription !== null && !madeWith(subscription.options.applicationServerKey, key)) {
    await subscription.unsubscribe();
    subscription = null;
  }
  subscription ??= await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
  return (await api.pushSubscribe(subscription.endpoint)).ok;
}

/** Asks the phone to show alerts, from the technician's tap, and subscribes once allowed. */
export async function turnOnNotifications(key: string): Promise<OnThisPhone> {
  try {
    const answer = await Notification.requestPermission();
    if (answer !== "granted") return answer === "denied" ? "blocked" : "off";
    return (await keepSubscription(key)) ? "on" : "failed";
  } catch {
    // The push service refused, or the API could not be reached.
    return "failed";
  }
}
