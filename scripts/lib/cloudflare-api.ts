// What the deploy scripts share about Cloudflare's API dropping a reply.
//
// The API sometimes takes a request and never answers: it hangs about five
// minutes and the connection closes, so wrangler exits 1 although the work was
// done. Six staging deploys failed that way on 22 September 2026, from the
// self-hosted runner and from a laptop alike (docs/decisions/0006-deployment-pipeline.md).
//
// A call that can safely be made twice is simply made again. A call that cannot
// — uploading a Worker version — asks Cloudflare what landed instead
// (scripts/release.ts).

/** How a dropped reply reads, in wrangler's own words. */
const LOST = ["terminated", "fetch failed", "socket hang up", "ECONNRESET", "ETIMEDOUT"];

export function isConnectionLost(error: unknown): boolean {
  const said = error instanceof Error && "stderr" in error ? String(error.stderr) : "";
  const message = error instanceof Error ? error.message : "";
  return LOST.some((phrase) => said.includes(phrase) || message.includes(phrase));
}

/**
 * Runs `work`, and runs it again if Cloudflare dropped the reply. Only for work
 * that is the same done twice: a migration that applies what is missing, a
 * SELECT, an INSERT that ignores a conflict.
 */
export function retryingLostReplies<T>(what: string, work: () => T, attempts = 3): T {
  for (let attempt = 1; ; attempt++) {
    try {
      return work();
    } catch (error) {
      if (attempt >= attempts || !isConnectionLost(error)) throw error;
      console.error(
        `${what}: Cloudflare dropped the reply; trying again (${String(attempt + 1)} of ${String(attempts)})`,
      );
    }
  }
}
