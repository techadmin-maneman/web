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

export type ClientFound = Body<paths["/api/clients/search"]["post"]>;
export type ClientRecord = Body<paths["/api/clients/{id}"]["get"]>;
export type PhotoVisit = Body<paths["/api/clients/{id}/photos"]["get"]>["visits"][number];
export type Photo = PhotoVisit["photos"][number];
export type Consents = Body<paths["/api/clients/{id}/consents"]["get"]>;
export type Consent = Consents["consents"][number];

/** A failed call carries the API's error code, or "offline" when it never reached the API. */
export type Answer<T> =
  { readonly ok: true; readonly body: T } | { readonly ok: false; readonly status: number; readonly code: string };

async function refusal(response: Response): Promise<Answer<never>> {
  const error = (await response.json().catch(() => null)) as { error?: { code?: string } } | null;
  return { ok: false, status: response.status, code: error?.error?.code ?? "unknown" };
}

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
  return refusal(response);
}

/** A photograph's bytes, which the API audits before it serves them. */
async function image(path: string): Promise<Answer<Blob>> {
  let response: Response;
  try {
    response = await fetch(path, { credentials: "same-origin" });
  } catch {
    return { ok: false, status: 0, code: "offline" };
  }
  return response.ok ? { ok: true, body: await response.blob() } : refusal(response);
}

export const api = {
  held: () => call<{ held: Held[] }>("GET", "/api/referrals/held"),
  decideReferral: (id: string, decision: "approve" | "reject", reason: string | null) =>
    call<Decision>("POST", `/api/referrals/${id}/decision`, { decision, reason }),
  referrers: () => call<{ referrers: Referrer[] }>("GET", "/api/referrers"),
  waitlist: () => call<{ areas: Area[] }>("GET", "/api/waitlist"),
  /** Without confirm, what a launch would send; with it, the launch itself. */
  launch: (pincode: string, confirm: boolean) => call<Launch>("POST", `/api/pincodes/${pincode}/launch`, { confirm }),
  /** The number goes in the body, never in a path or a query string, so it stays out of logs and referrers. */
  findClient: (mobile: string) => call<ClientFound>("POST", "/api/clients/search", { mobile }),
  client: (id: string) => call<ClientRecord>("GET", `/api/clients/${id}`),
  /** Which photographs exist, by visit. No image comes with it, and nothing is audited. */
  clientPhotos: (id: string) => call<{ visits: PhotoVisit[] }>("GET", `/api/clients/${id}/photos`),
  /** One photograph. The API writes the audit entry before it serves the bytes (ADR 0031). */
  clientPhoto: (id: string, photoId: string) => image(`/api/clients/${id}/photos/${photoId}`),
  clientConsents: (id: string) => call<Consents>("GET", `/api/clients/${id}/consents`),
};
