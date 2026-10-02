// The site's side of the mm-api contract. The types are generated from
// docs/openapi.json (npm run openapi); none is written by hand. Every call is
// same-origin: mm-api serves /api/* on the site's own host.

import type { components, paths } from "./api-schema.ts";

type Schemas = components["schemas"];
type Body<P extends keyof paths> = paths[P]["post"] extends {
  requestBody?: { content: { "application/json": infer B } };
}
  ? B
  : never;
export type Attribution = Schemas["Attribution"];
export type ErrorCode = Schemas["ErrorResponse"]["error"]["code"];
export type UploadUrlRequest = Schemas["UploadUrlRequest"];
export type UploadUrlResponse = Schemas["UploadUrlResponse"];
export type GenerateRequest = Schemas["GenerateRequest"];
export type JobStatus = Schemas["JobStatus"];
export type ClaimRequest = Schemas["ClaimRequest"];
export type ClaimResponse = Schemas["ClaimResponse"];
export type TryOnAvailability = Schemas["TryOnAvailability"];
export type Look = Schemas["Look"];
export type Invite = Schemas["Invite"];
export type PincodeAnswer = Schemas["PincodeAnswer"];
export type PublishedPrices = Schemas["PublishedPrices"];
export type ReferralReward = Schemas["ReferralReward"];
export type ReferralConsultation = Schemas["ReferralConsultation"];
export type ReferralWaitlist = Schemas["ReferralWaitlist"];
export type Consultation = Schemas["Consultation"];
export type Waitlist = Schemas["Waitlist"];
export type TypedAddress = Schemas["TypedAddress"];
export type NumberCodeRequest = Schemas["NumberCodeRequest"];
export type NumberCode = Schemas["NumberCode"];
export type NumberCodeVerify = Schemas["NumberCodeVerify"];
export type PublicConsultationRequest = Body<"/api/consultation">;
export type PublicWaitlistRequest = Body<"/api/waitlist">;
export type ConsultationRequest = Body<"/api/r/{code}/consultation">;
export type WaitlistRequest = Body<"/api/r/{code}/waitlist">;

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
  const refusal = body as Partial<Schemas["ErrorResponse"]> | null;
  const code = refusal?.error?.code ?? "network";
  const fields = refusal?.error?.fields ?? [];
  return { ok: false, code, fields };
}

function post<T>(path: string, body: unknown, idempotencyKey?: string): Promise<Answer<T>> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (idempotencyKey !== undefined) headers["Idempotency-Key"] = idempotencyKey;
  return call<T>(path, { method: "POST", headers, body: JSON.stringify(body) });
}

// The WhatsApp code that proves the number typed, before /book's one visit or
// /try's gate acts on it.

export function askForNumberCode(request: NumberCodeRequest): Promise<Answer<NumberCode>> {
  return post<NumberCode>("/api/number-code", request);
}

export function verifyNumberCode(codeId: string, code: string): Promise<Answer<NumberCodeVerify>> {
  return post<NumberCodeVerify>("/api/number-code/verify", { code_id: codeId, code });
}

// The try-on, in order: whether it runs and whether this browser has had its
// look, a link to upload one photo, the upload, the gate, the render and its
// progress. The look itself goes to WhatsApp only, so no call here fetches it
// (docs/decisions/0104-the-try-ons-look-on-whatsapp-only.md).

/** Whether the try-on runs: not while WhatsApp cannot send its look. */
export function fetchAvailability(): Promise<Answer<TryOnAvailability>> {
  return call<TryOnAvailability>("/api/tryon/availability");
}

/** The look this browser has had, or null for none yet: never the image. */
export function fetchLook(): Promise<Answer<Look | null>> {
  return call<Look | null>("/api/tryon/look");
}

export function requestUploadUrl(request: UploadUrlRequest): Promise<Answer<UploadUrlResponse>> {
  return post<UploadUrlResponse>("/api/tryon/upload-url", request);
}

/** `uploadUrl` is the path the API gave; the photo is always a JPEG, from photo.ts. */
export function uploadPhoto(uploadUrl: string, photo: Blob): Promise<Answer<null>> {
  return call<null>(uploadUrl, { method: "PUT", headers: { "Content-Type": "image/jpeg" }, body: photo });
}

/** The photograph's small copy, which a client keeps as their before photo (ADR 0084), on the photo's own link. */
export function uploadCopy(uploadUrl: string, copy: Blob): Promise<Answer<null>> {
  const [path = "", query = ""] = uploadUrl.split("?");
  return call<null>(`${path}/copy?${query}`, { method: "PUT", headers: { "Content-Type": "image/jpeg" }, body: copy });
}

/** The gate: where the look goes on WhatsApp, given before the look is made. */
export function claimLook(claim: ClaimRequest, idempotencyKey: string): Promise<Answer<ClaimResponse>> {
  return post<ClaimResponse>("/api/tryon/claim", claim, idempotencyKey);
}

/** The job to follow is the one this returns, which may differ from the one sent. */
export function generateLook(request: GenerateRequest): Promise<Answer<JobStatus>> {
  return post<JobStatus>("/api/tryon/generate", request);
}

export function jobStatus(jobId: string): Promise<Answer<JobStatus>> {
  return call<JobStatus>(`/api/tryon/status/${jobId}`, { signal: AbortSignal.timeout(POLL_TIMEOUT_MS) });
}

// The referral landing at /r/:code. The invite usually arrives in the page the
// mm-site Worker serves; it is fetched only where the Worker did not write it
// (local dev). An unknown code still books or waits, without the invite.

export function fetchInvite(code: string): Promise<Answer<Invite>> {
  return call<Invite>(`/api/r/${code}`);
}

/** The price book's figures, where the mm-site Worker did not write them into the page (local dev). */
export function fetchPublishedPrices(): Promise<Answer<PublishedPrices>> {
  return call<PublishedPrices>("/api/published-prices");
}

/** What a referral earns, where the mm-site Worker did not write it into the page (local dev). */
export function fetchReferralReward(): Promise<Answer<ReferralReward>> {
  return call<ReferralReward>("/api/referral-reward");
}

export function checkPincode(pincode: string): Promise<Answer<PincodeAnswer>> {
  return call<PincodeAnswer>(`/api/pincodes/${pincode}`);
}

export function bookConsultation(
  code: string,
  request: ConsultationRequest,
  idempotencyKey: string,
): Promise<Answer<ReferralConsultation>> {
  return post<ReferralConsultation>(`/api/r/${code}/consultation`, request, idempotencyKey);
}

export function joinWaitlist(
  code: string,
  request: WaitlistRequest,
  idempotencyKey: string,
): Promise<Answer<ReferralWaitlist>> {
  return post<ReferralWaitlist>(`/api/r/${code}/waitlist`, request, idempotencyKey);
}

// The same two answers from the site's own page, which carries an invite only
// when this browser remembers one (docs/decisions/0051-booking-from-the-site.md,
// 0089-an-invite-is-not-lost.md).

export function bookPublicConsultation(
  request: PublicConsultationRequest,
  idempotencyKey: string,
): Promise<Answer<Consultation>> {
  return post<Consultation>("/api/consultation", request, idempotencyKey);
}

export function joinPublicWaitlist(request: PublicWaitlistRequest, idempotencyKey: string): Promise<Answer<Waitlist>> {
  return post<Waitlist>("/api/waitlist", request, idempotencyKey);
}
