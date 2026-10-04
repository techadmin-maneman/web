// The client app's service worker (docs/decisions/0043-client-app.md). It keeps
// the app's own files, so the app opens without a connection, as both apps'
// workers do (packages/web-kit/sw-shell.ts), and the last Home answer
// (GET /api/me), so board B3's offline state can show the next visit. Nothing
// else is kept: no other API answer, and no photograph or document
// (./requests.ts). The build writes in MM_PRECACHE and MM_VERSION
// (packages/web-kit/pwa.ts).

import { marked, serveTheShell } from "../../../packages/web-kit/sw-shell.ts";
import { answerFor, HOME_PATH } from "./requests.ts";

declare const self: ServiceWorkerGlobalScope;
declare const MM_PRECACHE: readonly string[];
declare const MM_VERSION: string;

/** The app deletes this cache at logout and when the session has ended (apps/app/src/api.ts). */
const HOME = "mm-app-home";
/**
 * How long Home waits on the network before the kept copy is shown. A weak
 * signal that never answers is worse than none: the app would stay closed for
 * as long as the browser waits, which is minutes.
 */
const HOME_PATIENCE_MS = 3_000;

serveTheShell(
  self,
  { prefix: "mm-app-shell-", version: MM_VERSION, files: MM_PRECACHE },
  (request) => answerFor(request, self.location.origin),
  home,
);

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
  return kept === undefined ? null : marked(kept);
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
