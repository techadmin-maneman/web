// Which requests the technician app's service worker answers, and how
// (apps/tech/sw/sw.ts). Kept apart from the worker so the rule can be read and
// tested on its own (test/node/tech-sw.test.ts).

/** The one API answer the worker keeps a copy of: the day's list, which gives no client's address or number. */
export const DAY_PATH = "/api/tech/jobs";

/**
 * `shell`: a page, which is always the app itself. `file`: one of the app's own
 * scripts, styles, fonts and icons. `day`: the day's list. `null`: the worker
 * stays out of it, and the request goes to the network as if it were not there
 * — every write, every other API call, and anything for another host.
 */
export type Answer = "shell" | "file" | "day" | null;

export function answerFor(request: { method: string; mode: string; url: string }, origin: string): Answer {
  const url = new URL(request.url);
  if (url.origin !== origin || request.method !== "GET") return null;
  if (url.pathname === DAY_PATH) return "day";
  if (request.mode === "navigate") return "shell";
  if (url.pathname.startsWith("/api/")) return null;
  return "file";
}
