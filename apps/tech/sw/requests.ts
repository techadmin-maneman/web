// Which requests the technician app's service worker answers (apps/tech/sw/sw.ts), by the rule both apps share
// (packages/web-kit/sw-requests.ts), and tested on its own (test/node/tech-sw.test.ts).

import { answerFor as answerOf, type Answer as Answered } from "../../../packages/web-kit/sw-requests.ts";

/** The one API answer the worker keeps a copy of: the day's list, which gives no client's address or number. */
const DAY_PATH = "/api/tech/jobs";

/** `day`: the day's list; otherwise the shell, a file, or nothing (the shared rule). */
type Answer = Answered<"day">;

export const answerFor = (request: { method: string; mode: string; url: string }, origin: string): Answer =>
  answerOf(request, origin, { path: DAY_PATH, answer: "day" });
