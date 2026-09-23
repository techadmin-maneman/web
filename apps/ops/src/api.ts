// The ops console's calls to mm-api (docs/openapi-ops.json). Every call is
// same-origin, so Cloudflare Access's own cookie goes with it and the Origin
// matches, which the ops surface requires on a write
// (docs/decisions/0026-hosts-and-surfaces.md).
//
// The console holds no session of its own. Access decides who gets here, and
// mm-api records each call under that identity (docs/decisions/0031-access-and-audit.md).

import type { paths } from "./api-schema.ts";

/** The 200 body of one operation, which the ops document mostly writes inline rather than naming. */
type Body<T> = T extends { responses: { 200: { content: { "application/json": infer B } } } } ? B : never;

export type Held = Body<paths["/api/referrals/held"]["get"]>["held"][number];
export type Referrer = Body<paths["/api/referrers"]["get"]>["referrers"][number];
export type Area = Body<paths["/api/waitlist"]["get"]>["areas"][number];
export type Launch = Body<paths["/api/pincodes/{pin}/launch"]["post"]>;
export type Decision = Body<paths["/api/referrals/{id}/decision"]["post"]>;

/** A failed call carries the API's error code, or "offline" when it never reached the API. */
export type Answer<T> =
  { readonly ok: true; readonly body: T } | { readonly ok: false; readonly status: number; readonly code: string };

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
  if (response.ok) return { ok: true, body: (await response.json()) as T };
  const error = (await response.json().catch(() => null)) as { error?: { code?: string } } | null;
  return { ok: false, status: response.status, code: error?.error?.code ?? "unknown" };
}

export const api = {
  held: () => call<{ held: Held[] }>("GET", "/api/referrals/held"),
  decideReferral: (id: string, decision: "approve" | "reject", reason: string | null) =>
    call<Decision>("POST", `/api/referrals/${id}/decision`, { decision, reason }),
  referrers: () => call<{ referrers: Referrer[] }>("GET", "/api/referrers"),
  waitlist: () => call<{ areas: Area[] }>("GET", "/api/waitlist"),
  /** Without confirm, what a launch would send; with it, the launch itself. */
  launch: (pincode: string, confirm: boolean) => call<Launch>("POST", `/api/pincodes/${pincode}/launch`, { confirm }),
};
