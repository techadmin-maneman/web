// The client app's calls to mm-api (docs/openapi-client.json). Every call is
// same-origin, so the session cookie goes with it and the Origin matches.

import type { components } from "./api-schema.ts";

type Schemas = components["schemas"];
export type LoginChallenge = Schemas["LoginChallenge"];
export type LoginVerify = Schemas["LoginVerify"];
export type Me = Schemas["Me"];

/** A failed call carries the API's error code, or "offline" when it never reached the API. */
export type Answer<T> =
  | { readonly ok: true; readonly status: number; readonly body: T }
  | { readonly ok: false; readonly status: number; readonly code: string };

async function call<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<Answer<T>> {
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
    return { ok: true, status: response.status, body: value as T };
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
};
