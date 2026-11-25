// The console's service worker (docs/decisions/0323-the-unanswered-lead-alert.md): it shows the unanswered-lead push
// on the phone of a Care person on shift, and a tap opens the console. It keeps nothing and answers no request, so the
// console is read from the network as ever and nothing about a client reaches the phone's disk. A push carries nothing,
// and the notification names no client, since a locked phone is seen by others. Its own words, not the console's
// (../src/content.ts): the worker is built as one file and shares no module with the console.

declare const self: ServiceWorkerGlobalScope;

// A module, so `self` above is this worker's own scope and not the global one redeclared.
export {};

const WORDS = { title: "New lead waiting", body: "Nobody has answered them yet." } as const;

// A new build takes over at once: it holds nothing for the old one to hand over.
self.addEventListener("install", () => {
  void self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  event.waitUntil(
    // No tag: a notification with the same tag replaces the last without a sound, and each lead must alert.
    self.registration.showNotification(WORDS.title, { body: WORDS.body, icon: "/icon-192.png" }),
  );
});

/** Opens the console, in the window already open where there is one. */
async function openConsole(): Promise<void> {
  const open = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  const opened = open.find((client) => new URL(client.url).origin === self.location.origin);
  if (opened === undefined) {
    await self.clients.openWindow("/");
    return;
  }
  await opened.focus();
}

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(openConsole());
});
