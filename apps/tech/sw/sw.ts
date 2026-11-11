// The technician app's service worker (docs/decisions/0053-the-technician-app-offline.md). It keeps the shell, every
// file of the build with the app itself kept as "/", so a phone in a basement can close the app, reopen it, and still
// see the day from the phone's own store (docs/open-points.md, item 133). It keeps no API answer: no day's list, no
// card, no GET /tech/me, no piece and no photograph (./requests.ts).
//
// The shell is kept as both apps' workers keep it (packages/web-kit/sw-shell.ts). The build writes in MM_PRECACHE
// and MM_VERSION (packages/web-kit/pwa.ts).
//
// It shows each push as the phone's own notification (./notice.ts), and a tap opens the app where the alert points.

import { serveTheShell } from "../../../packages/web-kit/sw-shell.ts";
import { noticesOf, WORDS, type Notice, type PushedAlert } from "./notice.ts";
import { answerFor } from "./requests.ts";

declare const self: ServiceWorkerGlobalScope;
declare const MM_PRECACHE: readonly string[];
declare const MM_VERSION: string;

/** The day's list an earlier build kept here, which names each unlocked job's client; dropped once this build runs. */
const EARLIER_DAY = "mm-tech-day";

serveTheShell(self, { prefix: "mm-tech-shell-", version: MM_VERSION, files: MM_PRECACHE }, (request) =>
  answerFor(request, self.location.origin),
);

self.addEventListener("activate", (event) => {
  event.waitUntil(caches.delete(EARLIER_DAY));
});

/** The alerts the API holds for the technician signed in on this phone; null when they could not be read. */
async function alertsNow(): Promise<readonly PushedAlert[] | null> {
  try {
    const answer = await fetch("/api/tech/alerts", { credentials: "same-origin", cache: "no-store" });
    if (!answer.ok) return null;
    const body: unknown = await answer.json();
    return typeof body === "object" && body !== null && "alerts" in body && Array.isArray(body.alerts)
      ? (body.alerts as readonly PushedAlert[])
      : null;
  } catch {
    return null;
  }
}

/** The alerts already shown on this phone, kept in a cache of its own: the alerts read, for the ones not in them. */
const SHOWN = "mm-tech-alerts-shown";
const shownKey = (id: string): string => `/shown/${id}`;

async function shownBefore(): Promise<Set<string>> {
  const cache = await caches.open(SHOWN);
  return new Set((await cache.keys()).map((request) => new URL(request.url).pathname.slice("/shown/".length)));
}

/** Notes what was shown, or is too old to show, and forgets what the API no longer holds. */
async function noteShown(shown: readonly string[], held: readonly PushedAlert[]): Promise<void> {
  const cache = await caches.open(SHOWN);
  const kept = new Set(held.map((alert) => alert.id));
  for (const request of await cache.keys()) {
    if (!kept.has(new URL(request.url).pathname.slice("/shown/".length))) await cache.delete(request);
  }
  for (const id of shown) await cache.put(shownKey(id), new Response(null, { status: 204 }));
}

async function show(notice: Notice): Promise<void> {
  // Actions are in the Notifications standard, not yet in TypeScript's WebWorker types.
  const options: NotificationOptions & { readonly actions: readonly { action: string; title: string }[] } = {
    body: notice.body,
    tag: notice.tag,
    icon: "/icon-192.png",
    data: { open: notice.open, navigate: notice.navigate },
    actions:
      notice.navigate === null
        ? []
        : [
            { action: "navigate", title: WORDS.navigate },
            { action: "open", title: WORDS.openJob },
          ],
  };
  await self.registration.showNotification(notice.title, options);
}

/** An app open on the phone reads its alerts again, so a job called off under it opens the dialog that says so. */
async function tellTheApp(): Promise<void> {
  for (const window of await self.clients.matchAll({ type: "window" })) window.postMessage({ kind: "mm-alerts" });
}

// A push carries nothing (src/providers/web-push.ts): it says there is an alert, which is read from the API and shown.
// Every push shows one, as the phones require, even when the alert could not be read.
self.addEventListener("push", (event) => {
  event.waitUntil(
    (async () => {
      const [alerts, shown] = await Promise.all([alertsNow(), shownBefore().catch(() => new Set<string>())]);
      const { notices, noted } = noticesOf(alerts, shown, Date.now());
      for (const notice of notices) await show(notice);
      if (alerts !== null) await noteShown(noted, alerts).catch(() => undefined);
      await tellTheApp();
    })(),
  );
});

/** Opens the app on `path`, in the window already open where there is one. */
async function openApp(path: string): Promise<void> {
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

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const data = event.notification.data as { open: string; navigate: string | null };
  event.waitUntil(
    event.action === "navigate" && data.navigate !== null
      ? self.clients.openWindow(data.navigate).then(() => undefined)
      : openApp(data.open),
  );
});
