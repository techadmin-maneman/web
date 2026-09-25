// Which requests the client app's service worker answers, and how
// (apps/app/sw/sw.ts). Kept apart from the worker so the rule can be read and
// tested on its own (test/node/app-sw.test.ts).

/** Home's data (GET /api/me): the one API answer the worker keeps a copy of. */
export const HOME_PATH = "/api/me";

/**
 * `shell`: a page, which is always the app itself. `file`: one of the app's own
 * scripts, styles, fonts and icons. `home`: Home's data. `null`: the worker
 * stays out of it, and the request goes to the network as if it were not there
 * — every write, every other API call, and anything for another host.
 */
export type Answer = "shell" | "file" | "home" | null;

export function answerFor(request: { method: string; mode: string; url: string }, origin: string): Answer {
  const url = new URL(request.url);
  if (url.origin !== origin || request.method !== "GET") return null;
  if (url.pathname === HOME_PATH) return "home";
  if (request.mode === "navigate") return "shell";
  if (url.pathname.startsWith("/api/")) return null;
  return "file";
}
