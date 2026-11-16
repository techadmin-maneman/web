// The client's alerts on the phone (docs/decisions/0255-client-alerts-and-push.md). A push carries nothing, so the worker
// reads the inbox and says how many alerts are new, opening the inbox, where each is told in full. Its few words are its
// own: what the app and the worker share would be a chunk the worker, a classic script, cannot load. Every push shows
// one notification, as the phones require, even when the inbox could not be read.

/** The worker's words. */
const WORDS = {
  title: "Mane Man",
  one: "You have a new update.",
  many: (count: number) => `You have ${String(count)} new updates.`,
} as const;

/** How many of the inbox's alerts are not read; null when it could not be read. */
async function unreadNow(): Promise<number | null> {
  try {
    const answer = await fetch("/api/me/alerts", { credentials: "same-origin", cache: "no-store" });
    if (!answer.ok) return null;
    const body: unknown = await answer.json();
    if (typeof body !== "object" || body === null || !("alerts" in body) || !Array.isArray(body.alerts)) return null;
    return (body.alerts as readonly { readonly read?: unknown }[]).filter((alert) => alert.read === false).length;
  } catch {
    return null;
  }
}

async function showNew(self: ServiceWorkerGlobalScope): Promise<void> {
  const unread = await unreadNow();
  await self.registration.showNotification(WORDS.title, {
    body: unread !== null && unread > 1 ? WORDS.many(unread) : WORDS.one,
    // One at a time: a later push replaces the earlier one's notification.
    tag: "mm-alerts",
    icon: "/icon-192.png",
  });
}

/** Opens the inbox, in the window already open where there is one. */
async function openInbox(self: ServiceWorkerGlobalScope): Promise<void> {
  const open = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  const app = open.find((client) => new URL(client.url).origin === self.location.origin);
  if (app === undefined) {
    await self.clients.openWindow("/alerts");
    return;
  }
  await app.focus();
  // A window the worker does not control yet cannot be sent elsewhere; a new one opens instead.
  await app.navigate("/alerts").catch(() => self.clients.openWindow("/alerts"));
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
