// The client app's calls to mm-api (docs/openapi-client.json). Every call is
// same-origin, so the session cookie goes with it and the Origin matches.

import type { components } from "./api-schema.ts";

type Schemas = components["schemas"];
export type LoginChallenge = Schemas["LoginChallenge"];
export type LoginVerify = Schemas["LoginVerify"];
export type Me = Schemas["Me"];
export type Profile = Schemas["Profile"];
export type Address = Schemas["Address"];
export type NumberChange = Schemas["NumberChange"];
export type ConsentPurpose = Profile["consents"][number]["purpose"];

/**
 * A failed call carries the API's error code, or "offline" when it never reached
 * the API. `cached` is true for a Home the service worker kept (apps/app/sw/sw.ts).
 */
export type Answer<T> =
  | { readonly ok: true; readonly status: number; readonly body: T; readonly cached: boolean }
  | { readonly ok: false; readonly status: number; readonly code: string };

/** Named as in apps/app/sw/sw.ts. */
const HOME_CACHE = "mm-app-home";
const SERVED_FROM = "Mm-Served-From";

/** The kept Home is the one personal thing the app keeps on the phone: gone at logout, and once the session has ended. */
export async function forgetHome(): Promise<void> {
  if ("caches" in window) await caches.delete(HOME_CACHE);
}

async function call<T>(method: "GET" | "POST" | "PATCH", path: string, body?: unknown): Promise<Answer<T>> {
  let response: Response;
  try {
    response = await fetch(path, {
      method,
      credentials: "same-origin",
      headers: body === undefined ? {} : { "Content-Type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  } catch {
    return { ok: false, status: 0, code: "offline" };
  }
  if (response.ok) {
    const value = response.status === 204 ? null : ((await response.json()) as unknown);
    return {
      ok: true,
      status: response.status,
      body: value as T,
      cached: response.headers.get(SERVED_FROM) === "cache",
    };
  }
  const error = (await response.json().catch(() => null)) as { error?: { code?: string } } | null;
  return { ok: false, status: response.status, code: error?.error?.code ?? "unknown" };
}

export const api = {
  sendCode: (mobile: string) => call<LoginChallenge>("POST", "/api/auth/otp", { mobile }),
  resendCode: (challengeId: string) =>
    call<LoginChallenge>("POST", "/api/auth/otp/resend", { challenge_id: challengeId }),
  smsCode: (challengeId: string) => call<LoginChallenge>("POST", "/api/auth/otp/sms", { challenge_id: challengeId }),
  verify: (challengeId: string, code: string) =>
    call<LoginVerify>("POST", "/api/auth/verify", { challenge_id: challengeId, code }),
  logout: () => call<null>("POST", "/api/auth/logout"),
  me: () => call<Me>("GET", "/api/me"),
  profile: () => call<Profile>("GET", "/api/profile"),
  saveAddress: (address: Address) => call<Address>("PATCH", "/api/profile/address", address),
  switchConsent: (purpose: ConsentPurpose, granted: boolean) =>
    call<{ purpose: ConsentPurpose; granted: boolean; since: string }>("PATCH", `/api/consents/${purpose}`, {
      granted,
    }),
  startNumberChange: (newMobile: string) =>
    call<{ request_id: string; expires_in_s: number }>("POST", "/api/number-change", { new_mobile: newMobile }),
  verifyNumberChange: (requestId: string, number: "old" | "new", code: string) =>
    call<NumberChange & { attempts_left: number | null }>("POST", "/api/number-change/verify", {
      request_id: requestId,
      number,
      code,
    }),
  requestDeletion: () => call<{ state: "requested"; requested_at: string }>("POST", "/api/deletion-request"),
};
