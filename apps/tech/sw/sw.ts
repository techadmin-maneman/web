// The technician app's service worker (docs/decisions/0053-the-technician-app-offline.md).
// It keeps two things and refuses everything else (./requests.ts):
//
//   the shell     every file of the build, with the app itself kept as "/", so a
//                 phone in a basement can close the app, reopen it, and still see
//                 the day (docs/open-points.md, item 56);
//   today's jobs  the one answer to GET /api/tech/jobs?date=<today in India>,
//                 which carries a time, a type, a badge and an area — no client,
//                 no address, no number.
//
// Nothing else is cached: not a job's card, which carries the client's name,
// mobile and address; not GET /tech/me; not a piece; and no photograph, going
// up or coming down. The app deletes the day cache when the session ends or ops
// revoke the phone (apps/tech/src/store/db.ts).
//
// The build writes in MM_PRECACHE and MM_VERSION (apps/tech/sw-build.ts).

import { answerFor } from "./requests.ts";

declare const self: ServiceWorkerGlobalScope;
declare const MM_PRECACHE: readonly string[];
declare const MM_VERSION: string;

const SHELL_PREFIX = "mm-tech-shell-";
const SHELL = `${SHELL_PREFIX}${MM_VERSION}`;
/** Named the same in apps/tech/src/store/db.ts, which deletes it at sign-out and on revocation. */
const DAY = "mm-tech-day";
/** Marks a day answered from the cache, so the app knows it is working offline (apps/tech/src/api.ts). */
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
  switch (answerFor(request, self.location.origin)) {
    case "shell":
      event.respondWith(page(request));
      return;
    case "file":
      event.respondWith(file(request));
      return;
    case "day":
      event.respondWith(day(request, new URL(request.url)));
      return;
    case null:
      return;
  }
});

/** India is five and a half hours ahead of UTC, all year, and a working day is India's. */
export function todayInIndia(now: number): string {
  return new Date(now + 330 * 60 * 1000).toISOString().slice(0, 10);
}

/** Only today's list is kept. Tomorrow's and any later day's go to the network and no further. */
function isToday(url: URL, now: number = Date.now()): boolean {
  return url.searchParams.get("date") === todayInIndia(now);
}

/**
 * The day from the network, kept when it is today's in place of any earlier
 * day's; with no network, the kept copy, marked as such. A day we never cached
 * simply fails, and the app falls back to what its own store holds
 * (apps/tech/src/lib/useDay.ts).
 */
async function day(request: Request, url: URL): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(request);
  } catch {
    const kept = await caches.match(url.href, { cacheName: DAY });
    if (kept === undefined) return Response.error();
    const headers = new Headers(kept.headers);
    headers.set(SERVED_FROM, "cache");
    return new Response(kept.body, { status: kept.status, headers });
  }
  if (response.status === 200 && isToday(url)) {
    const cache = await caches.open(DAY);
    for (const earlier of await cache.keys()) await cache.delete(earlier);
    await cache.put(url.href, response.clone());
  }
  return response;
}

/**
 * Any page is the app itself (the Worker answers every path with it), and it
 * comes from the kept copy first, without waiting on the network. A weak signal
 * that never answers would otherwise hold the app closed for as long as the
 * browser waits. A new build still arrives: the browser checks for a new sw.js
 * each time the app opens, the new worker keeps its own shell and drops this
 * one, and the next open is the new app.
 */
async function page(request: Request): Promise<Response> {
  return (await caches.match("/", { cacheName: SHELL })) ?? fetch(request);
}

/** The app's scripts, styles, fonts and icons: hashed or fixed, so the kept copy is the right one. */
async function file(request: Request): Promise<Response> {
  return (await caches.match(request, { cacheName: SHELL })) ?? fetch(request);
}
