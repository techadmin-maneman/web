// A page's side of a new build, for the client app and the technician app alike. Each app's service worker keeps a
// new build and waits (./sw-shell.ts), so a page left open all day goes on running the build it opened with, whole.
// The page asks for a new build whenever it comes back to the front and every hour, since an app that never
// navigates is never checked by the browser. Once one is waiting, the app says so, and the page has it take over,
// which loads the page again on the new build: when the person taps to, or by itself while the app is out of sight on
// its first screen with nothing open over it, where nothing is lost.

/** What the waiting worker is told to take over with (TAKE_OVER in ./sw-shell.ts, which imports nothing). */
export const TAKE_OVER = "mm-take-over";

const EVERY_HOUR = 60 * 60_000;

let waiting: ServiceWorker | null = null;
const listeners = new Set<() => void>();
let resting = false;

/** Whether the app is where loading it again loses nothing: signed in, on its first screen. Set as that changes. */
export function atRest(now: boolean): void {
  resting = now;
}

/** Whether a new build is waiting to take over, for useSyncExternalStore. */
export const updateReady = (): boolean => waiting !== null;

/** Calls `listener` once a new build is waiting; returns the way to stop. */
export function onUpdateReady(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Has the waiting build take over; the page loads again on it once it has. */
export function applyUpdate(): void {
  waiting?.postMessage(TAKE_OVER);
}

/** No sheet or dialog over the screen, as a booking and its payment are: the client may be paying in another app. */
const nothingOpen = (): boolean => document.querySelector("dialog[open]") === null;

function nowWaiting(worker: ServiceWorker): void {
  waiting = worker;
  for (const listener of listeners) listener();
}

/**
 * Registers the app's service worker and keeps the page on its newest build: asked for at each return to the front
 * and every hour, said to be ready once it waits, and taken on while the page is out of sight at rest.
 */
export async function keepUpToDate(): Promise<void> {
  const { serviceWorker } = navigator;
  // A page that opened under a worker is reloaded when another takes over, whichever page told it to, since the old
  // build's files go with the old worker. A first worker taking over a page that had none changes nothing.
  const opened = serviceWorker.controller !== null;
  let reloading = false;
  serviceWorker.addEventListener("controllerchange", () => {
    if (!opened || reloading) return;
    reloading = true;
    window.location.reload();
  });

  const registration = await serviceWorker.register("/sw.js");
  if (registration.waiting !== null && opened) nowWaiting(registration.waiting);
  registration.addEventListener("updatefound", () => {
    const incoming = registration.installing;
    incoming?.addEventListener("statechange", () => {
      if (incoming.state === "installed" && opened) nowWaiting(incoming);
    });
  });

  const ask = () => {
    registration.update().catch(() => {
      // Offline, or the API's host away: the next return to the front asks again.
    });
  };
  setInterval(ask, EVERY_HOUR);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") ask();
    else if (updateReady() && resting && nothingOpen()) applyUpdate();
  });
}
