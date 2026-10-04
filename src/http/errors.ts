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
  // The look goes to WhatsApp only (docs/decisions/0104-the-try-ons-look-on-whatsapp-only.md): a render waits for the
  // gate's claim, and no try-on runs while WhatsApp cannot send its look.
  "claim_required",
  "whatsapp_unavailable",
  // A site form that acts on a number only once its WhatsApp code was entered: the one visit, and the try-on's gate.
  "number_not_proved",
  // A webhook whose token or signature does not match.
  "unauthorized",
  // What an erasure waits for: a visit or booking still to happen, a payment held with no visit behind it, or a payment
  // link unpaid (docs/decisions/0066-erasure-all-or-nothing.md).
  "visit_booked",
  "payment_held",
  "payment_owed",
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
  // No slot is held for a client who has not given their address (docs/decisions/0079-an-address-before-a-slot.md).
  "address_required",
  // An address in a pincode we do not come to: no visit is booked there, and the app saves no such address.
  "not_served",
  // Ops booking a consultation or first fit for a client who has one still to come, or a payment link open for one.
  "already_booked",
  // Moving or cancelling a visit (docs/decisions/0046-moving-and-cancelling.md): it has started, passed or gone;
  // or the 24 hours ran out between showing the terms and confirming them.
  "not_changeable",
  "terms_changed",
  // A referral card without the client's consent to photographs on referral cards (docs/decisions/0048-referrals.md).
  "consent_required",
  // The technician app (docs/decisions/0052-technician-sessions.md, 0038-offline-writes.md):
  // ops revoked this phone, so it drops its cached jobs; the job moved under it while it
  // was offline; the step before this one has not been sent; a check-in or start on a day
  // that is not the job's; a no-show on a job already started (ADR 0065).
  "device_revoked",
  "superseded",
  "out_of_order",
  "not_today",
  "already_started",
  // A piece label already on record, for another client or as this client's piece from an earlier visit: the
  // technician corrects it on the phone.
  "piece_code",
  // Ops switched the technician off: the phone sets his unsent work aside rather than wiping it.
  "technician_inactive",
  // Dispatch (docs/decisions/0034-clash-check.md): the technician already holds a job in that
  // window, is away that day (ADR 0062), or the window is free but the visit has no room in it.
  "clash",
  "on_leave",
  "does_not_fit",
  // The technician has begun the visit, so a move would leave his work on another day or with another technician.
  "in_progress",
  // The no-show wait has not run out yet (src/policy/no-show.ts), or a visit ops would close by hand is still to come.
  "too_early_to_close",
  // A check-in or a start before the earliest check-in (src/policy/phone-clock.ts).
  "too_early_to_arrive",
  // A visit ops would close by hand is closed or cancelled already, or the technician's phone closed it; or a
  // technician's step or photograph sent for a job that has closed.
  "already_closed",
  // A service-area change that would leave no pincode served at all, and every
  // client on the waitlist (docs/decisions/0061-ops-editable-inputs.md).
  "no_service_area",
  // The services clients book (docs/decisions/0085-services-ops-can-edit.md): another service has the name, or its
  // kind the code; retiring it would leave its kind with nothing to book; a price for a service retired by its day.
  "service_exists",
  "last_of_kind",
  "service_retired",
  // A first fit, or a consultation and fit in one visit, on a day the console offers no hair system to sell.
  "no_product",
  // An invite ops attach to a client (docs/decisions/0089-an-invite-is-not-lost.md): no invite has the code; it is the
  // client's own; or the client came with one already.
  "unknown_invite",
  "own_invite",
  "already_invited",
  // A client's dispute of a no-show's charge (docs/decisions/0096-a-no-shows-charge-and-its-dispute.md): the charge
  // was disputed already, took nothing to give back, or is past the days it could be disputed.
  "already_disputed",
  "not_disputable",
  "dispute_window_closed",
  // Discount codes (docs/decisions/0108-discount-codes.md): the code entered does not apply, which is all its enterer
  // is told; the booking carries a code already; the booking's price is settled, so no code goes on or comes off; or
  // ops typed a code that already exists.
  "code_not_applicable",
  "already_discounted",
  "price_settled",
  "code_exists",
  // A change of the day's times from a day a client can still book, or a visit is booked on or after
  // (docs/decisions/0102-window-times.md).
  "slot_times_too_soon",
  // The Staff list: the caller's grants do not reach this, or a change would leave nobody with Admin MANAGE nationally.
  "not_permitted",
  "last_admin",
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

export const ErrorResponseSchema = z
  .object({
    error: z
      .object({
        code: z.enum(ERROR_CODES),
        request_id: z.string(),
        fields: z.array(z.string()).optional().openapi({
          description:
            "invalid_request: the fields that failed validation, never their values; superseded: what changed under the caller.",
        }),
        moved: z
          .object({
            technician: z.string().openapi({ description: "Their first name, and nothing else of theirs" }),
            at: z.union([z.iso.datetime(), z.null()]).openapi({
              description: "When ops moved the job to them; null where nothing recorded when",
            }),
          })
          .strict()
          .optional()
          .openapi({
            description:
              "superseded, to a technician's phone, for a job given to another technician: whom, and when (docs/open-points.md, item 92).",
          }),
        earliest_at: z.iso.datetime().optional().openapi({
          description:
            "too_early_to_arrive, to a technician's check-in or start: the earliest moment the job takes one.",
        }),
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
