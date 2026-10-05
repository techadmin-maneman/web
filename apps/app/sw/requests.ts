// Which requests the client app's service worker answers (apps/app/sw/sw.ts), by the rule both apps share
// (packages/web-kit/sw-requests.ts), and tested on its own (test/node/apps/app/app-sw.test.ts).

import { answerFor as answerOf, type Answer as Answered } from "../../../packages/web-kit/sw-requests.ts";

/** Home's data (GET /api/me): the one API answer the worker keeps a copy of. */
export const HOME_PATH = "/api/me";

/** `home`: Home's data; otherwise the shell, a file, or nothing (the shared rule). */
type Answer = Answered<"home">;

export const answerFor = (request: { method: string; mode: string; url: string }, origin: string): Answer =>
  answerOf(request, origin, { path: HOME_PATH, answer: "home" });
