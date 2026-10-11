// Every call to a vendor goes through vendorFetch: it is given up after its timeout and logged as one `vendor_call`
// line with the vendor, the step, the HTTP status, how long it took and, on a failed answer, the vendor's own code.
// The line never holds the URL, which can carry a key or a secret. A call that gets no answer comes back as a
// VendorUnreachable instead of a thrown error, so each adapter decides what no answer means for its work.

import type { Logger } from "../log.ts";
import { ProviderError } from "./provider-error.ts";

/** Each vendor, as its calls are logged, and as its errors name it. */
const VENDOR_NAMES = {
  "zoho-crm": "Zoho CRM",
  "zoho-books": "Zoho Books",
  razorpay: "Razorpay",
  evolution: "WhatsApp bridge",
  msg91: "MSG91",
  ailabtools: "AILabTools",
  google: "Google",
  turnstile: "Turnstile",
  "cloudflare-access": "Cloudflare Access",
  "cloudflare-analytics": "Cloudflare analytics",
  "chat-webhook": "Chat webhook",
  healthchecks: "Heartbeat monitor",
} as const;

export type Vendor = keyof typeof VENDOR_NAMES;

export interface VendorCall {
  readonly vendor: Vendor;
  /** What the call does, as the log and an error name it: "create_order", "token". */
  readonly step: string;
  readonly timeoutMs: number;
  /** Reads the vendor's own code from a failed answer's body, for the log. A code only, never a record's value. */
  readonly codeOf?: (body: unknown) => string | null;
}

export interface VendorFetchDependencies {
  readonly fetch: typeof fetch;
  readonly log: Logger;
}

const errorName = (error: unknown): string => (error instanceof Error ? error.name : "unknown");

/** A call that got no answer: none came within its timeout, or the vendor could not be reached. Never a refusal. */
export class VendorUnreachable extends ProviderError {
  override readonly name = "VendorUnreachable";
  /** The fetch error's name, "TimeoutError" or "TypeError"; never its message, which may hold the URL. */
  readonly reason: string;
  readonly timedOut: boolean;

  constructor(call: VendorCall, cause: unknown) {
    const reason = errorName(cause);
    const timedOut = reason === "TimeoutError";
    const what = timedOut
      ? `${call.step} got no answer within ${String(call.timeoutMs / 1000)} s`
      : `${call.step} could not be reached (${reason})`;
    const code = timedOut ? "TIMEOUT" : "UNREACHABLE";
    super(0, code, `${VENDOR_NAMES[call.vendor]} 0 ${code}: ${what}`, { refusal: false });
    this.reason = reason;
    this.timedOut = timedOut;
    this.cause = cause;
  }
}

export async function vendorFetch(
  deps: VendorFetchDependencies,
  call: VendorCall,
  url: string,
  init: RequestInit = {},
): Promise<Response | VendorUnreachable> {
  const started = Date.now();
  const which = { vendor: call.vendor, step: call.step };
  let response: Response;
  try {
    response = await deps.fetch(url, { ...init, signal: AbortSignal.timeout(call.timeoutMs) });
  } catch (error) {
    deps.log.warn("vendor_call", { ...which, status: 0, reason: errorName(error), duration_ms: Date.now() - started });
    return new VendorUnreachable(call, error);
  }

  const answered = { ...which, status: response.status, duration_ms: Date.now() - started };
  if (response.ok || call.codeOf === undefined) {
    deps.log.info("vendor_call", answered);
  } else {
    deps.log.info("vendor_call", { ...answered, code: await failureCode(response, call.codeOf) });
  }
  return response;
}

/** The vendor's code in a failed answer, read from a copy so the adapter can still read the answer itself. */
async function failureCode(response: Response, codeOf: (body: unknown) => string | null): Promise<string | null> {
  const body: unknown = await response
    .clone()
    .json()
    .catch(() => null);
  return codeOf(body);
}
