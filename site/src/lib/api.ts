// The site's side of the mm-api contract. The types are generated from
// docs/openapi.json (npm run openapi); none is written by hand. Every call is
// same-origin: mm-api serves /api/* on the site's own host.

import type { components } from "./api-schema.ts";

type Schemas = components["schemas"];
export type City = Schemas["City"];
export type LeadRequest = Schemas["LeadRequest"];
export type LeadResponse = Schemas["LeadResponse"];
export type Attribution = Schemas["Attribution"];
export type ErrorCode = Schemas["ErrorResponse"]["error"]["code"];

/** An answer from the API: the body, or the error code and the fields it names. */
export type Answer<T> =
  | { readonly ok: true; readonly body: T }
  | { readonly ok: false; readonly code: ErrorCode | "network"; readonly fields: readonly string[] };

async function call<T>(path: string, init?: RequestInit): Promise<Answer<T>> {
  let response: Response;
  try {
    response = await fetch(path, init);
  } catch {
    return { ok: false, code: "network", fields: [] };
  }
  const body: unknown = await response.json().catch(() => null);
  if (response.ok) return { ok: true, body: body as T };
  const error = (body as Partial<Schemas["ErrorResponse"]> | null)?.error;
  return { ok: false, code: error?.code ?? "network", fields: error?.fields ?? [] };
}

export function fetchCities(): Promise<Answer<City[]>> {
  return call<City[]>("/api/cities");
}

/** A new idempotency key for each submission attempt, so a repeat of one attempt books once. */
export function submitLead(lead: LeadRequest, idempotencyKey: string): Promise<Answer<LeadResponse>> {
  return call<LeadResponse>("/api/lead", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": idempotencyKey },
    body: JSON.stringify(lead),
  });
}
