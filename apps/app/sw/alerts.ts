// The client's alerts on the phone (docs/decisions/0255-client-alerts-and-push.md). A push carries nothing, so the
// worker reads the inbox and shows each alert the client has neither read nor been shown, newest first; tapped, it
// opens what the alert is about. Every push shows one, as the phones require, even when the inbox could not be read.

import { alerts as words, alertWords, type ClientAlert as Alert } from "./alert-words.ts";

/** The alerts already shown on this phone, kept in a cache of their own. */
const SHOWN = "mm-app-alerts-shown";
const shownKey = (id: string): string => `/shown/${id}`;
const idOf = (request: Request): string => new URL(request.url).pathname.slice("/shown/".length);
/** At most this many shown for one push: a phone that was off does not fill with old news. */
const MOST = 3;

async function inboxNow(): Promise<readonly Alert[] | null> {
  try {
    const answer = await fetch("/api/me/alerts", { credentials: "same-origin", cache: "no-store" });
    if (!answer.ok) return null;
    const body: unknown = await answer.json();
    return typeof body === "object" && body !== null && "alerts" in body && Array.isArray(body.alerts)
      ? (body.alerts as readonly Alert[])
      : null;
  } catch {
    return null;
  }
}

async function shownBefore(): Promise<Set<string>> {
  const cache = await caches.open(SHOWN);
  return new Set((await cache.keys()).map(idOf));
}

/** Notes what was shown, and forgets what the inbox no longer holds. */
async function noteShown(shown: readonly string[], held: readonly Alert[]): Promise<void> {
  const cache = await caches.open(SHOWN);
  const kept = new Set(held.map((alert) => alert.id));
  for (const request of await cache.keys()) if (!kept.has(idOf(request))) await cache.delete(request);
  for (const id of shown) await cache.put(shownKey(id), new Response(null, { status: 204 }));
}

async function showNew(self: ServiceWorkerGlobalScope): Promise<void> {
  const [inbox, shown] = await Promise.all([inboxNow(), shownBefore().catch(() => new Set<string>())]);
  const fresh = (inbox ?? []).filter((alert) => !alert.read && !shown.has(alert.id)).slice(0, MOST);
  if (fresh.length === 0) {
    await self.registration.showNotification(words.pushed.title, {
      body: words.pushed.line,
      tag: "mm-alerts",
      icon: "/icon-192.png",
      data: { open: "/alerts" },
    });
    return;
  }
  for (const alert of fresh) {
    const { title, line, to } = alertWords(alert);
    await self.registration.showNotification(title, {
      body: line,
      tag: alert.id,
      icon: "/icon-192.png",
      data: { open: to },
    });
  }
  if (inbox !== null) {
    await noteShown(
      fresh.map((alert) => alert.id),
      inbox,
    ).catch(() => undefined);
  }
}

/** Opens the app on `path`, in the window already open where there is one. */
async function openApp(self: ServiceWorkerGlobalScope, path: string): Promise<void> {
  const open = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  const app = open.find((client) => new URL(client.url).origin === self.location.origin);
  if (app === undefined) {
    await self.clients.openWindow(path);
    return;
  }
  await app.focus();
  // A window the worker does not control yet cannot be sent elsewhere; a new one opens instead.
  await app.navigate(path).catch(() => self.clients.openWindow(path));
}

export function listenForAlerts(self: ServiceWorkerGlobalScope): void {
  self.addEventListener("push", (event) => {
    event.waitUntil(showNew(self));
  });
  self.addEventListener("notificationclick", (event) => {
    event.notification.close();
    const data = event.notification.data as { open: string };
    event.waitUntil(openApp(self, data.open));
  });
}
