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
export type UploadUrlRequest = Schemas["UploadUrlRequest"];
export type UploadUrlResponse = Schemas["UploadUrlResponse"];
export type GenerateRequest = Schemas["GenerateRequest"];
export type JobStatus = Schemas["JobStatus"];
export type FailureCode = Schemas["ResultFailed"]["failure_code"];
export type ClaimRequest = Schemas["ClaimRequest"];
export type ClaimResponse = Schemas["ClaimResponse"];
export type Look = Schemas["Look"];

/**
 * How long a poll waits for its answer. A request stuck on the way is dropped,
 * and the next poll goes out, rather than holding up everything after it.
 */
const POLL_TIMEOUT_MS = 10_000;

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
  // Only 204 has no body. Any other answer that is not JSON came from something other than mm-api.
  if (response.ok && (body !== null || response.status === 204)) return { ok: true, body: body as T };
  const error = (body as Partial<Schemas["ErrorResponse"]> | null)?.error;
  return { ok: false, code: error?.code ?? "network", fields: error?.fields ?? [] };
}

export function fetchCities(): Promise<Answer<City[]>> {
  return call<City[]>("/api/cities");
}

function post<T>(path: string, body: unknown, idempotencyKey?: string): Promise<Answer<T>> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (idempotencyKey !== undefined) headers["Idempotency-Key"] = idempotencyKey;
  return call<T>(path, { method: "POST", headers, body: JSON.stringify(body) });
}

/** A new idempotency key for each submission attempt, so a repeat of one attempt books once. */
export function submitLead(lead: LeadRequest, idempotencyKey: string): Promise<Answer<LeadResponse>> {
  return post<LeadResponse>("/api/lead", lead, idempotencyKey);
}

// The try-on, in order: a link to upload one photo, the upload, the render,
// its progress, the gate, and the result once the gate has given a session.

export function requestUploadUrl(request: UploadUrlRequest): Promise<Answer<UploadUrlResponse>> {
  return post<UploadUrlResponse>("/api/tryon/upload-url", request);
}

/** `uploadUrl` is the path the API gave; the photo is always a JPEG, from photo.ts. */
export function uploadPhoto(uploadUrl: string, photo: Blob): Promise<Answer<null>> {
  return call<null>(uploadUrl, { method: "PUT", headers: { "Content-Type": "image/jpeg" }, body: photo });
}

/** The job to follow is the one this returns, which may differ from the one sent. */
export function generateLook(request: GenerateRequest): Promise<Answer<JobStatus>> {
  return post<JobStatus>("/api/tryon/generate", request);
}

export function jobStatus(jobId: string): Promise<Answer<JobStatus>> {
  return call<JobStatus>(`/api/tryon/status/${jobId}`, { signal: AbortSignal.timeout(POLL_TIMEOUT_MS) });
}

/** The look this browser already has, for a visitor who comes back. */
export function fetchLook(): Promise<Answer<Look>> {
  return call<Look>("/api/tryon/look");
}

/** The gate: optional, for a WhatsApp copy. It also opens a session that can see the result. */
export function claimResult(claim: ClaimRequest, idempotencyKey: string): Promise<Answer<ClaimResponse>> {
  return post<ClaimResponse>("/api/tryon/claim", claim, idempotencyKey);
}

export type ResultAnswer =
  | { readonly kind: "ready"; readonly url: string }
  | { readonly kind: "pending" }
  | { readonly kind: "failed"; readonly failureCode: FailureCode }
  | { readonly kind: "error"; readonly code: ErrorCode | "network" };

/** The result: a link to the image, still rendering, failed, or an error. */
export async function fetchResult(jobId: string): Promise<ResultAnswer> {
  let response: Response;
  try {
    response = await fetch(`/api/tryon/result/${jobId}`, { signal: AbortSignal.timeout(POLL_TIMEOUT_MS) });
  } catch {
    return { kind: "error", code: "network" };
  }
  const body: unknown = await response.json().catch(() => null);
  if (response.status === 200) return { kind: "ready", url: (body as Schemas["ResultReady"]).url };
  if (response.status === 202) return { kind: "pending" };
  if (response.status === 422) return { kind: "failed", failureCode: (body as Schemas["ResultFailed"]).failure_code };
  return { kind: "error", code: (body as Partial<Schemas["ErrorResponse"]> | null)?.error?.code ?? "network" };
}
