// Cloudflare Turnstile. Locally the secret is Cloudflare's always-pass test
// secret, so the real endpoint is called everywhere and needs no stub.

const SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const TIMEOUT_MS = 5_000;

export type TurnstileResult = "passed" | "rejected" | "unavailable";

export interface TurnstileCheck {
  readonly secret: string;
  /** The token the widget gave the browser. */
  readonly token: string;
  /** The visitor's IP, which Cloudflare cross-checks. */
  readonly ip: string | null;
  readonly fetch: typeof fetch;
}

/**
 * "rejected": the token is invalid, expired or already used.
 * "unavailable": Cloudflare could not be asked. The lead is refused either way;
 * an unverified form submission is not accepted.
 */
export async function verifyTurnstile({ secret, token, ip, fetch }: TurnstileCheck): Promise<TurnstileResult> {
  const form = new FormData();
  form.append("secret", secret);
  form.append("response", token);
  if (ip !== null) form.append("remoteip", ip);

  let response: Response;
  try {
    response = await fetch(SITEVERIFY_URL, { method: "POST", body: form, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch {
    return "unavailable";
  }
  if (!response.ok) return "unavailable";

  const outcome = (await response.json().catch(() => null)) as { success?: unknown } | null;
  return outcome?.success === true ? "passed" : "rejected";
}
