// The technician app's service worker (docs/decisions/0053-the-technician-app-offline.md).
// It keeps two things and refuses everything else (./requests.ts):
//
//   the shell     every file of the build, with the app itself kept as "/", so a
//                 phone in a basement can close the app, reopen it, and still see
//                 the day (docs/open-points.md, item 133);
//   today's jobs  the one answer to GET /api/tech/jobs?date=<today in India>,
//                 which carries a time, a type, a badge, an area and the name of
//                 each unlocked job's client — no address, no number.
//
// Nothing else is cached: not a job's card, which carries the client's mobile
// and address; not GET /tech/me; not a piece; and no photograph, going
// up or coming down. The app deletes the day cache when the session ends or ops
// revoke the phone (apps/tech/src/store/db.ts).
//
// The shell is kept as both apps' workers keep it (packages/web-kit/sw-shell.ts). The build writes in MM_PRECACHE
// and MM_VERSION (packages/web-kit/pwa.ts).

import { marked, serveTheShell } from "../../../packages/web-kit/sw-shell.ts";
import { answerFor } from "./requests.ts";

declare const self: ServiceWorkerGlobalScope;
declare const MM_PRECACHE: readonly string[];
declare const MM_VERSION: string;

/** Named the same in apps/tech/src/store/db.ts, which deletes it at sign-out and on revocation. */
const DAY = "mm-tech-day";

serveTheShell(
  self,
  { prefix: "mm-tech-shell-", version: MM_VERSION, files: MM_PRECACHE },
  (request) => answerFor(request, self.location.origin),
  (event) => day(event.request, new URL(event.request.url)),
);

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
    return kept === undefined ? Response.error() : marked(kept);
  }
  if (response.status === 200 && isToday(url)) {
    const cache = await caches.open(DAY);
    for (const earlier of await cache.keys()) await cache.delete(earlier);
    await cache.put(url.href, response.clone());
  }
  return response;
}
