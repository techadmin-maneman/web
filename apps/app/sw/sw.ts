// The client app's service worker (docs/decisions/0043-client-app.md). It keeps
// the app's own files, so the app opens without a connection, and the last Home
// answer (GET /api/me), so board B3's offline state can show the next visit.
// Nothing else is kept: no other API answer, and no photograph or document
// (./requests.ts). The build writes in MM_PRECACHE and MM_VERSION (packages/web-kit/pwa.ts).

import { answerFor, HOME_PATH } from "./requests.ts";

declare const self: ServiceWorkerGlobalScope;
declare const MM_PRECACHE: readonly string[];
declare const MM_VERSION: string;

const SHELL_PREFIX = "mm-app-shell-";
const SHELL = `${SHELL_PREFIX}${MM_VERSION}`;
/** The app deletes this cache at logout and when the session has ended (apps/app/src/api.ts). */
const HOME = "mm-app-home";
/** Marks a Home answered from the cache, for the offline banner (apps/app/src/api.ts). */
const SERVED_FROM = "Mm-Served-From";
/**
 * How long Home waits on the network before the kept copy is shown. A weak
 * signal that never answers is worse than none: the app would stay closed for
 * as long as the browser waits, which is minutes.
 */
const HOME_PATIENCE_MS = 3_000;

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL);
      await cache.addAll(MM_PRECACHE);
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      for (const name of await caches.keys()) {
        if (name.startsWith(SHELL_PREFIX) && name !== SHELL) await caches.delete(name);
      }
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  switch (answerFor(request, self.location.origin)) {
    case "shell":
      event.respondWith(page(request));
      return;
    case "file":
      event.respondWith(file(request));
      return;
    case "home":
      event.respondWith(home(event));
      return;
    case null:
      return;
  }
});

/** Home from the network, and kept whenever it comes, even after the kept copy has been shown in its place. */
async function fetchHome(request: Request): Promise<Response> {
  const response = await fetch(request);
  if (response.status === 200) {
    const cache = await caches.open(HOME);
    await cache.put(HOME_PATH, response.clone());
  }
  return response;
}

async function keptHome(): Promise<Response | null> {
  const kept = await caches.match(HOME_PATH, { cacheName: HOME });
  if (kept === undefined) return null;
  const headers = new Headers(kept.headers);
  headers.set(SERVED_FROM, "cache");
  return new Response(kept.body, { status: kept.status, headers });
}

const noop = () => undefined;

const patience = () =>
  new Promise<null>((resolve) => {
    setTimeout(() => {
      resolve(null);
    }, HOME_PATIENCE_MS);
  });

/**
 * Home from the network. With no network, or none that answers in time, the
 * kept copy, marked as such; with nothing kept, the network is all there is,
 * however long it takes.
 */
async function home(event: FetchEvent): Promise<Response> {
  const fromNetwork = fetchHome(event.request);
  event.waitUntil(fromNetwork.then(noop, noop));
  const inTime = await Promise.race([fromNetwork.catch(() => null), patience()]);
  if (inTime !== null) return inTime;
  return (await keptHome()) ?? fromNetwork.catch(() => Response.error());
}

/**
 * Any page is the app itself (the Worker answers every path with it), and it
 * comes from the kept copy first, without waiting on the network. A new build
 * still arrives: the browser checks for a new sw.js each time the app opens,
 * the new worker keeps its own shell and drops this one, and the next open is
 * the new app.
 */
async function page(request: Request): Promise<Response> {
  return (await caches.match("/", { cacheName: SHELL })) ?? fetch(request);
}

/** The app's scripts, styles, fonts and icons: hashed or fixed, so the kept copy is the right one. */
async function file(request: Request): Promise<Response> {
  return (await caches.match(request, { cacheName: SHELL })) ?? fetch(request);
}
