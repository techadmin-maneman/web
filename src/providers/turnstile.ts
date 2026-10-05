// Cloudflare Turnstile. Locally the secret is Cloudflare's always-pass test
// secret, so the real endpoint is called everywhere and needs no stub.

import type { Logger } from "../log.ts";
import { vendorFetch, VendorUnreachable } from "./vendor-fetch.ts";

/** Cloudflare's published dummy token, which its always-pass test secret accepts. */
export const TURNSTILE_TEST_TOKEN = "XXXX.DUMMY.TOKEN.XXXX";

const SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const TIMEOUT_MS = 5_000;

export type TurnstileResult = "passed" | "rejected" | "unavailable";

type TurnstileVerdict =
  | { readonly result: "passed" | "rejected" }
  /** Why the token could not be checked: Cloudflare's status or error code, never the token. */
  | { readonly result: "unavailable"; readonly detail: string };

interface TurnstileCheck {
  readonly secret: string;
  /** The token the widget gave the browser. */
  readonly token: string;
  /** The visitor's IP, which Cloudflare cross-checks. */
  readonly ip: string | null;
  /** The pages the token may have been solved on; null takes any. */
  readonly hosts: readonly string[] | null;
  readonly fetch: typeof fetch;
  readonly log: Logger;
}

/** What siteverify answers, as far as it is read. */
interface SiteverifyAnswer {
  success?: unknown;
  /** The page the widget was solved on. */
  hostname?: unknown;
  "error-codes"?: unknown;
}

/**
 * Cloudflare's own failure, or our secret refused: no visitor's token could
 * pass, so it is not the visitor who is turned away but everybody.
 */
const NOBODY_COULD_PASS = new Set(["internal-error", "invalid-input-secret", "missing-input-secret"]);

/**
 * "rejected": the token is invalid, expired or already used, or was solved on a page not ours.
 * "unavailable": the token could not be checked. The lead is refused either way;
 * an unverified form submission is not accepted.
 */
export async function verifyTurnstile(check: TurnstileCheck): Promise<TurnstileVerdict> {
  const form = new FormData();
  form.append("secret", check.secret);
  form.append("response", check.token);
  if (check.ip !== null) form.append("remoteip", check.ip);

  const call = { vendor: "turnstile", step: "siteverify", timeoutMs: TIMEOUT_MS } as const;
  const http = { fetch: check.fetch, log: check.log };
  const response = await vendorFetch(http, call, SITEVERIFY_URL, { method: "POST", body: form });
  if (response instanceof VendorUnreachable) {
    return { result: "unavailable", detail: `unreachable: ${response.reason}` };
  }
  if (!response.ok) return { result: "unavailable", detail: `siteverify ${String(response.status)}` };

  const outcome = (await response.json().catch(() => null)) as SiteverifyAnswer | null;
  if (outcome?.success === true) return { result: ourPage(check, outcome.hostname) ? "passed" : "rejected" };
  const codes = Array.isArray(outcome?.["error-codes"]) ? outcome["error-codes"] : [];
  const nobody = codes.find((code): code is string => typeof code === "string" && NOBODY_COULD_PASS.has(code));
  return nobody === undefined ? { result: "rejected" } : { result: "unavailable", detail: `siteverify said ${nobody}` };
}

function ourPage(check: TurnstileCheck, hostname: unknown): boolean {
  if (check.hosts === null || (typeof hostname === "string" && check.hosts.includes(hostname))) return true;
  check.log.warn("turnstile_wrong_host", { hostname: typeof hostname === "string" ? hostname.slice(0, 100) : null });
  return false;
}
