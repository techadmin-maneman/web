// What both apps' service workers do alike (apps/app/sw/sw.ts, apps/tech/sw/sw.ts): keep the build's files as one
// shell under its version, drop an older shell once this one is active, and answer a page and the app's own files from
// it. The client app's worker answers its one kept API answer itself. Bundled into each sw.js at build time: it imports nothing, so
// nothing is split into a chunk a classic service worker could not load.

/** What a page posts to a new build's waiting worker to have it take over now (packages/web-kit/sw-update.ts). */
export const TAKE_OVER = "mm-take-over";

/** Marks an answer served from a kept copy, so the app knows it is working offline (each app's api.ts reads it). */
const SERVED_FROM = "Mm-Served-From";

/** `kept`, marked as served from the cache. */
export function marked(kept: Response): Response {
  const headers = new Headers(kept.headers);
  headers.set(SERVED_FROM, "cache");
  return new Response(kept.body, { status: kept.status, headers });
}

/**
 * Installs the build's `files` as the shell named `prefix` and `version`, drops older shells once it is active, and
 * answers each request as `answer` says: a page and the app's own files from the shell first, without waiting on the
 * network, and a kept API answer by `keptAnswer`, where the worker keeps one. A page is always the app itself, as the Worker answers
 * every path with it.
 *
 * A new build's worker keeps its shell and then waits, so a page still open on the old build goes on loading the old
 * build's files from the old shell. It takes over when a page tells it to, which reloads that page on the new build,
 * or once no page of the old build is left open; only then is the old shell dropped.
 */
export function serveTheShell(
  worker: ServiceWorkerGlobalScope,
  shell: { readonly prefix: string; readonly version: string; readonly files: readonly string[] },
  answer: (request: Request) => string | null,
  keptAnswer?: (event: FetchEvent) => Promise<Response>,
): void {
  const name = `${shell.prefix}${shell.version}`;

  worker.addEventListener("install", (event) => {
    event.waitUntil(
      (async () => {
        const cache = await caches.open(name);
        await cache.addAll(shell.files);
      })(),
    );
  });

  worker.addEventListener("message", (event) => {
    if (event.data === TAKE_OVER) event.waitUntil(worker.skipWaiting());
  });

  worker.addEventListener("activate", (event) => {
    event.waitUntil(
      (async () => {
        for (const cache of await caches.keys()) {
          if (cache.startsWith(shell.prefix) && cache !== name) await caches.delete(cache);
        }
        await worker.clients.claim();
      })(),
    );
  });

  worker.addEventListener("fetch", (event) => {
    const { request } = event;
    const answered = answer(request);
    if (answered === null) return;
    if (answered === "shell") event.respondWith(fromShell("/", request));
    else if (answered === "file") event.respondWith(fromShell(request, request));
    else if (keptAnswer !== undefined) event.respondWith(keptAnswer(event));
  });

  async function fromShell(kept: string | Request, request: Request): Promise<Response> {
    return (await caches.match(kept, { cacheName: name })) ?? fetch(request);
  }
}
