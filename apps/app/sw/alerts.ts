// The client's alerts on the phone (docs/decisions/0255-client-alerts-and-push.md). A push carries nothing, so the worker
// reads the inbox and says how many alerts are new, opening the inbox, where each is told in full (./alert-notice.ts).
// Every push shows one notification, as the phones require, even when the inbox could not be read.

import { noticeOf, OPENS, unreadIn } from "./alert-notice.ts";

/** How many of the inbox's alerts are not read; null when it could not be read. */
async function unreadNow(): Promise<number | null> {
  try {
    const answer = await fetch("/api/me/alerts", { credentials: "same-origin", cache: "no-store" });
    return answer.ok ? unreadIn(await answer.json()) : null;
  } catch {
    return null;
  }
}

async function showNew(self: ServiceWorkerGlobalScope): Promise<void> {
  const { title, ...notice } = noticeOf(await unreadNow());
  await self.registration.showNotification(title, notice);
}

/** Opens the inbox, in the window already open where there is one. */
async function openInbox(self: ServiceWorkerGlobalScope): Promise<void> {
  const open = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  const app = open.find((client) => new URL(client.url).origin === self.location.origin);
  if (app === undefined) {
    await self.clients.openWindow(OPENS);
    return;
  }
  await app.focus();
  // A window the worker does not control yet cannot be sent elsewhere; a new one opens instead.
  await app.navigate(OPENS).catch(() => self.clients.openWindow(OPENS));
}

export function listenForAlerts(self: ServiceWorkerGlobalScope): void {
  self.addEventListener("push", (event) => {
    event.waitUntil(showNew(self));
  });
  self.addEventListener("notificationclick", (event) => {
    event.notification.close();
    event.waitUntil(openInbox(self));
  });
}
