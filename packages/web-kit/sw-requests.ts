// Which requests an app's service worker answers, and how, for the client app and the technician app alike
// (apps/app/sw/requests.ts, apps/tech/sw/requests.ts). Each keeps one API answer of its own; everything else is the
// same rule. Kept apart from the workers so it can be read and tested on its own.

/**
 * `shell`: a page, which is always the app itself. `file`: one of the app's own scripts, styles, fonts and icons.
 * `Kept`: the one API answer the worker keeps a copy of, by the name the worker gives it. `null`: the worker stays out
 * of it, and the request goes to the network as if it were not there: every write, every other API call, a page marked
 * for Access's sign-in, and anything for another host.
 */
export type Answer<Kept extends string> = "shell" | "file" | Kept | null;

/**
 * The mark on a page the app sends through Cloudflare Access's sign-in, which the worker leaves to the network, named
 * the same in ./access.ts. The worker imports nothing the app does, so nothing is split into a chunk it could not load.
 */
const SIGN_IN_AGAIN = "signin";

export function answerFor<Kept extends string>(
  request: { method: string; mode: string; url: string },
  origin: string,
  kept: { readonly path: string; readonly answer: Kept },
): Answer<Kept> {
  const url = new URL(request.url);
  if (url.origin !== origin || request.method !== "GET") return null;
  if (url.pathname === kept.path) return kept.answer;
  if (request.mode === "navigate") return url.searchParams.has(SIGN_IN_AGAIN) ? null : "shell";
  if (url.pathname.startsWith("/api/")) return null;
  return "file";
}
