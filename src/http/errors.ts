// Errors returned to clients carry a stable code and the request ID. Never a
// stack trace, never a provider's message.

import { z } from "@hono/zod-openapi";

export const ERROR_CODES = [
  "not_found",
  "invalid_request",
  "turnstile_failed",
  "rate_limited",
  "idempotency_in_progress",
  "idempotency_key_reused",
  "environment_mismatch",
  "unavailable",
  "internal_error",
  // Try-on (docs/decisions/0014-try-on-api.md).
  "busy",
  "photo_invalid_file",
  "upload_already_received",
  "upload_missing",
  "session_required",
  "job_not_claimable",
  "look_limit_reached",
  // Erasure (docs/decisions/0019-erasure.md), and what it waits for: a visit still booked, or a payment
  // held with no visit behind it (docs/decisions/0066-erasure-all-or-nothing.md).
  "unauthorized",
  "visit_booked",
  "payment_held",
  // Phase 2 surfaces: a write from another page's origin (docs/decisions/0026-hosts-and-surfaces.md).
  "forbidden_origin",
  // The ops surface: no valid Cloudflare Access token (docs/decisions/0031-access-and-audit.md).
  "access_required",
  // The client app's login (docs/decisions/0030-one-time-codes.md): the challenge is closed, or it is too soon to resend.
  "code_expired",
  "too_early",
  // A number change ops cannot confirm: another person holds the new number (docs/decisions/0042-client-profile.md).
  "number_in_use",
  // A Razorpay refund for a payment not yet recorded: Razorpay retries it (docs/decisions/0044-payments-mirror.md).
  "not_ready",
  // Booking (docs/decisions/0045-self-serve-booking.md): self-serve is off and ops book instead; the time was taken;
  // the client may not book that kind of visit or that day; the hold has lapsed.
  "ops_assisted",
  "taken",
  "not_bookable",
  "hold_expired",
  // Moving or cancelling a visit (docs/decisions/0046-moving-and-cancelling.md): it has started, passed or gone;
  // or the 24 hours ran out between showing the terms and confirming them.
  "not_changeable",
  "terms_changed",
  // A referral card without the client's consent to photographs on referral cards (docs/decisions/0048-referrals.md).
  "consent_required",
  // The technician app (docs/decisions/0052-technician-sessions.md, 0038-offline-writes.md):
  // ops revoked this phone, so it drops its cached jobs; the job moved under it while it
  // was offline; the step before this one has not been sent.
  "device_revoked",
  "superseded",
  "out_of_order",
  // Dispatch (docs/decisions/0034-clash-check.md): the technician already holds a job in that
  // window, is away that day (ADR 0062), or FSM would not take the move.
  "clash",
  "on_leave",
  "fsm_refused",
  // The no-show wait has not run out yet (src/policy/no-show.ts).
  "too_early_to_close",
  // A service-area change that would leave no pincode served at all, and every
  // client on the waitlist (docs/decisions/0061-ops-editable-inputs.md).
  "no_service_area",
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

export const ErrorResponseSchema = z
  .object({
    error: z
      .object({
        code: z.enum(ERROR_CODES),
        request_id: z.string(),
        fields: z
          .array(z.string())
          .optional()
          .openapi({ description: "invalid_request only: the fields that failed validation, never their values." }),
      })
      .strict(),
  })
  .strict()
  .openapi("ErrorResponse");
export type ErrorResponse = z.infer<typeof ErrorResponseSchema>;

export function errorBody(code: ErrorCode, requestId: string, fields?: readonly string[]): ErrorResponse {
  return fields === undefined
    ? { error: { code, request_id: requestId } }
    : { error: { code, request_id: requestId, fields: [...fields] } };
}

/** The OpenAPI entry for an error response. */
export function errorResponse(description: string) {
  return { description, content: { "application/json": { schema: ErrorResponseSchema } } } as const;
}
