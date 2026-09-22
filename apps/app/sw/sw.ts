// The client app's service worker (docs/decisions/0043-client-app.md). It keeps
// the app's own files, so the app opens without a connection, and the last Home
// answer (GET /api/me), so board B3's offline state can show the next visit.
// Nothing else is kept: no other API answer, and no photograph or document.
// The build writes in MM_PRECACHE and MM_VERSION (apps/app/pwa.ts).

declare const self: ServiceWorkerGlobalScope;
declare const MM_PRECACHE: readonly string[];
declare const MM_VERSION: string;

const SHELL_PREFIX = "mm-app-shell-";
const SHELL = `${SHELL_PREFIX}${MM_VERSION}`;
/** The app deletes this cache at logout and when the session has ended (apps/app/src/api.ts). */
const HOME = "mm-app-home";
const HOME_PATH = "/api/me";
/** Marks a Home answered from the cache, for the offline banner (apps/app/src/api.ts). */
const SERVED_FROM = "Mm-Served-From";

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
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || request.method !== "GET") return;
  if (url.pathname === HOME_PATH) event.respondWith(home(request));
  else if (request.mode === "navigate") event.respondWith(page(request));
  else if (!url.pathname.startsWith("/api/")) event.respondWith(file(request));
});

/** Home from the network, kept for later; when there is no network, the kept copy, marked as such. */
async function home(request: Request): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(request);
  } catch {
    const kept = await caches.match(HOME_PATH, { cacheName: HOME });
    if (kept === undefined) return Response.error();
    const headers = new Headers(kept.headers);
    headers.set(SERVED_FROM, "cache");
    return new Response(kept.body, { status: kept.status, headers });
  }
  if (response.status === 200) {
    const cache = await caches.open(HOME);
    await cache.put(HOME_PATH, response.clone());
  }
  return response;
}

/** Any page is the app itself (the Worker answers every path with it), from the network or, offline, the kept copy. */
async function page(request: Request): Promise<Response> {
  try {
    return await fetch(request);
  } catch {
    return (await caches.match("/", { cacheName: SHELL })) ?? Response.error();
  }
}

/** The app's scripts, styles, fonts and icons: hashed or fixed, so the kept copy is the right one. */
async function file(request: Request): Promise<Response> {
  return (await caches.match(request, { cacheName: SHELL })) ?? fetch(request);
}

export {};
