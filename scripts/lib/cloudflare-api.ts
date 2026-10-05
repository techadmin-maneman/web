// What the deploy scripts share about Cloudflare's API: calling it with a token,
// telling a refused token from a missing resource, and a reply it dropped.
//
// The API sometimes takes a request and never answers: it hangs about five
// minutes and the connection closes, so wrangler exits 1 although the work was
// done. Six staging deploys failed that way on 22 September 2026, from the
// self-hosted runner and from a laptop alike (docs/decisions/0006-deployment-pipeline.md).
//
// A call that can safely be made twice is simply made again. A call that cannot
// — uploading a Worker version — asks Cloudflare what landed instead
// (scripts/release/release.ts).

import { z } from "zod";
import type { RemoteEnvironmentName } from "../../src/config/environments.ts";
import { readJsonc } from "./jsonc.ts";

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

// ---------------------------------------------------------------------------
// The REST API, for the read-only checks: check-triggers, check-buckets, soak
// ---------------------------------------------------------------------------

const AccountIds = z.object({ env: z.record(z.string(), z.object({ account_id: z.string() })) });

/** The account an environment deploys to, as wrangler.jsonc names it. */
export function accountIdFor(environment: RemoteEnvironmentName): string {
  const accountId = AccountIds.parse(readJsonc("wrangler.jsonc")).env[environment]?.account_id;
  if (accountId === undefined) throw new Error(`wrangler.jsonc names no account for ${environment}`);
  return accountId;
}

/** One answer from Cloudflare's API. An HTTP error is an answer too; only a lost connection throws. */
export interface ApiAnswer {
  readonly ok: boolean;
  readonly status: number;
  readonly body: unknown;
}

export async function callCloudflare(
  token: string,
  path: string,
  init: RequestInit = {},
  doFetch: typeof fetch = fetch,
): Promise<ApiAnswer> {
  const response = await doFetch(`https://api.cloudflare.com/client/v4${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  });
  const body: unknown = await response.json().catch(() => null);
  const success = typeof body === "object" && body !== null && "success" in body && body.success === true;
  return { ok: response.ok && success, status: response.status, body };
}

function firstErrors(answer: ApiAnswer): { code?: unknown; message?: unknown }[] {
  const { body } = answer;
  if (typeof body !== "object" || body === null || !("errors" in body) || !Array.isArray(body.errors)) return [];
  return body.errors as { code?: unknown; message?: unknown }[];
}

/** Cloudflare's codes for a token it will not let do this: an authentication error, or no access to the resource. */
const REFUSED = [10000, 9109];

/** The token lacks the permission, or the resource is outside its reach. Not the same as "it does not exist". */
export function isRefused(answer: ApiAnswer): boolean {
  if (answer.status === 401 || answer.status === 403) return true;
  return firstErrors(answer).some((error) => typeof error.code === "number" && REFUSED.includes(error.code));
}

/** "HTTP 403" and Cloudflare's own first message, for a line a person reads. */
export function describeAnswer(answer: ApiAnswer): string {
  const message = firstErrors(answer)[0]?.message;
  const status = `HTTP ${String(answer.status)}`;
  return typeof message === "string" && message !== "" ? `${status}, "${message}"` : status;
}
