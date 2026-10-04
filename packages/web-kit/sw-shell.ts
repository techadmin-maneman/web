// What both apps' service workers do alike (apps/app/sw/sw.ts, apps/tech/sw/sw.ts): keep the build's files as one
// shell under its version, drop an older shell once this one is active, and answer a page and the app's own files from
// it. Each worker answers its one kept API answer itself. Bundled into each sw.js at build time: it imports nothing, so
// nothing is split into a chunk a classic service worker could not load.

/** Marks an answer served from a kept copy, so the app knows it is working offline (each app's api.ts reads it). */
export const SERVED_FROM = "Mm-Served-From";

/** `kept`, marked as served from the cache. */
export function marked(kept: Response): Response {
  const headers = new Headers(kept.headers);
  headers.set(SERVED_FROM, "cache");
  return new Response(kept.body, { status: kept.status, headers });
}

/**
 * Installs the build's `files` as the shell named `prefix` and `version`, drops older shells once it is active, and
 * answers each request as `answer` says: a page and the app's own files from the shell first, without waiting on the
 * network, and the worker's kept API answer by `keptAnswer`. A new build still arrives: the browser checks for a new
 * sw.js each time the app opens, the new worker keeps its own shell and drops this one, and the next open is the new
 * app. A page is always the app itself, as the Worker answers every path with it.
 */
export function serveTheShell(
  worker: ServiceWorkerGlobalScope,
  shell: { readonly prefix: string; readonly version: string; readonly files: readonly string[] },
  answer: (request: Request) => string | null,
  keptAnswer: (event: FetchEvent) => Promise<Response>,
): void {
  const name = `${shell.prefix}${shell.version}`;

  worker.addEventListener("install", (event) => {
    event.waitUntil(
      (async () => {
        const cache = await caches.open(name);
        await cache.addAll(shell.files);
        await worker.skipWaiting();
      })(),
    );
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
    else event.respondWith(keptAnswer(event));
  });

  async function fromShell(kept: string | Request, request: Request): Promise<Response> {
    return (await caches.match(kept, { cacheName: name })) ?? fetch(request);
  }
}
