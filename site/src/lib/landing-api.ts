// The two calls every page may make (docs/decisions/0288-attribution-and-conversions.md): a landing's report and a
// Decline on the cookie bar. Kept apart from ./api.ts, whose client every page would otherwise load before its first
// paint, so they ride in the page's own script; each can outlive the page, and neither ever throws.

import type { components } from "./api-schema.ts";

type Landing = components["schemas"]["Landing"];

/** As long as ./api.ts waits for a write. */
const POST_TIMEOUT_MS = 20_000;

async function post(path: string, body: unknown, keepalive: boolean): Promise<Response | null> {
  try {
    return await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      keepalive,
      signal: AbortSignal.timeout(POST_TIMEOUT_MS),
    });
  } catch {
    // Offline, timed out, or the page gone before an answer: the caller sends it again later.
    return null;
  }
}

/** A landing reported: the reference the API answers with, or null where it kept nothing or never answered. */
export async function sendLanding(landing: Landing, keepalive: boolean): Promise<string | null> {
  const answer = await post("/api/landings", landing, keepalive);
  if (answer?.ok !== true) return null;
  const body: unknown = await answer.json().catch(() => null);
  const ref = (body as { ref?: unknown } | null)?.ref;
  return typeof ref === "string" ? ref : null;
}

/** A Decline on the cookie bar, outliving the page; whether the API heard it. */
export async function sendDecline(): Promise<boolean> {
  return (await post("/api/landings/declined", {}, true))?.ok === true;
}
