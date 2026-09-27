// Cloudflare Turnstile. Locally the secret is Cloudflare's always-pass test
// secret, so the real endpoint is called everywhere and needs no stub.

/** Cloudflare's published dummy token, which its always-pass test secret accepts. */
export const TURNSTILE_TEST_TOKEN = "XXXX.DUMMY.TOKEN.XXXX";

const SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const TIMEOUT_MS = 5_000;

export type TurnstileResult = "passed" | "rejected" | "unavailable";

export type TurnstileVerdict =
  | { readonly result: "passed" | "rejected" }
  /** Why the token could not be checked: Cloudflare's status or error code, never the token. */
  | { readonly result: "unavailable"; readonly detail: string };

export interface TurnstileCheck {
  readonly secret: string;
  /** The token the widget gave the browser. */
  readonly token: string;
  /** The visitor's IP, which Cloudflare cross-checks. */
  readonly ip: string | null;
  readonly fetch: typeof fetch;
}

/**
 * Cloudflare's own failure, or our secret refused: no visitor's token could
 * pass, so it is not the visitor who is turned away but everybody.
 */
const NOBODY_COULD_PASS = new Set(["internal-error", "invalid-input-secret", "missing-input-secret"]);

/**
 * "rejected": the token is invalid, expired or already used.
 * "unavailable": the token could not be checked. The lead is refused either way;
 * an unverified form submission is not accepted.
 */
export async function verifyTurnstile({ secret, token, ip, fetch }: TurnstileCheck): Promise<TurnstileVerdict> {
  const form = new FormData();
  form.append("secret", secret);
  form.append("response", token);
  if (ip !== null) form.append("remoteip", ip);

  let response: Response;
  try {
    response = await fetch(SITEVERIFY_URL, { method: "POST", body: form, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (error) {
    return { result: "unavailable", detail: `unreachable: ${error instanceof Error ? error.name : "error"}` };
  }
  if (!response.ok) return { result: "unavailable", detail: `siteverify ${String(response.status)}` };

  const outcome = (await response.json().catch(() => null)) as { success?: unknown; "error-codes"?: unknown } | null;
  if (outcome?.success === true) return { result: "passed" };
  const codes = Array.isArray(outcome?.["error-codes"]) ? outcome["error-codes"] : [];
  const nobody = codes.find((code): code is string => typeof code === "string" && NOBODY_COULD_PASS.has(code));
  return nobody === undefined ? { result: "rejected" } : { result: "unavailable", detail: `siteverify said ${nobody}` };
}
