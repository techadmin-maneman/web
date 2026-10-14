// The technician app's service worker (docs/decisions/0053-the-technician-app-offline.md). It keeps the shell, every
// file of the build with the app itself kept as "/", so a phone in a basement can close the app, reopen it, and still
// see the day from the phone's own store (docs/open-points.md, item 133). It keeps no API answer: no day's list, no
// card, no GET /tech/me, no piece and no photograph (./requests.ts).
//
// The shell is kept as both apps' workers keep it (packages/web-kit/sw-shell.ts). The build writes in MM_PRECACHE
// and MM_VERSION (packages/web-kit/pwa.ts).

import { serveTheShell } from "../../../packages/web-kit/sw-shell.ts";
import { answerFor } from "./requests.ts";

declare const self: ServiceWorkerGlobalScope;
declare const MM_PRECACHE: readonly string[];
declare const MM_VERSION: string;

/** The day's list an earlier build kept here, which names each unlocked job's client; dropped once this build runs. */
const EARLIER_DAY = "mm-tech-day";

serveTheShell(self, { prefix: "mm-tech-shell-", version: MM_VERSION, files: MM_PRECACHE }, (request) =>
  answerFor(request, self.location.origin),
);

self.addEventListener("activate", (event) => {
  event.waitUntil(caches.delete(EARLIER_DAY));
});
