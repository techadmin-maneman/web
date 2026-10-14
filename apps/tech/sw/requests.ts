// Which requests the technician app's service worker answers (apps/tech/sw/sw.ts), by the rule both apps share
// (packages/web-kit/sw-requests.ts), and tested on its own (test/node/apps/tech/tech-sw.test.ts). It keeps no API
// answer: the day's list is kept in the phone's own store (apps/tech/src/store/jobs.ts).

import { answerFor as answerOf, type Answer } from "../../../packages/web-kit/sw-requests.ts";

export const answerFor = (request: { method: string; mode: string; url: string }, origin: string): Answer =>
  answerOf(request, origin);
