// Booking from the public site (docs/decisions/0051-booking-from-the-site.md):
//
//   POST /api/consultation   a free consultation on a real date and window
//   POST /api/waitlist       the number, for a pincode we do not serve yet
//
// These are the referral landing's two routes without the invite, and they share
// their whole path (src/domain/public-booking.ts, and src/http/public-form.ts for
// the person): the same Turnstile check, the same daily limits per number and
// address, the same consent notices, the same held slot written to FSM, and the
// same lead behind it so the CRM funnel sees every booking. Whether we come is
// decided by the pincode, which GET /api/pincodes/{pin} answers for the form.
//
// A number that already has a consultation still to happen is answered
// already_booked, with its day and window, rather than booked twice; one past
// consultations books in the app (docs/decisions/0068-a-paid-hold-is-kept.md).
// The same submission sent again under its Idempotency-Key gets its first answer.
//
// A consultation is booked with the full address it is at, which becomes the
// person's address unless they already have one; a waitlist entry takes none
// (docs/decisions/0081-the-site-takes-the-address.md).
//
// A consultation may be booked with the first fit to follow: a request for the
// fit, written with the booking, which the client books and pays for in the app
// once the consultation is done (docs/decisions/0086-the-next-visit-is-offered.md).

import { createRoute, z } from "@hono/zod-openapi";
import type { App } from "../http/context.ts";
import { LOSS_EXTENTS } from "../config/booking.ts";
import { BOOKING_WINDOWS, FIRST_FIT_WINDOWS } from "../config/scheduling.ts";
import { bookConsultation, joinTheWaitlist } from "../domain/public-booking.ts";
import { errorBody, errorResponse, ErrorResponseSchema } from "../http/errors.ts";
import { IdempotencyKeyHeaderSchema, onceForKey } from "../http/idempotency.ts";
import { formRequest } from "../http/public-form.ts";
import { addressOf, AddressSchema } from "./client-profile.ts";

/** Six digits, and never starting with 0 or 9: India's pincodes. */
const PincodeSchema = z
  .string()
  .regex(/^[1-8]\d{5}$/)
  .openapi({ description: "A six-digit Indian pincode." });

const AttributionSchema = z
  .object({
    utm_source: z.string().max(200).optional(),
    utm_medium: z.string().max(200).optional(),
    utm_campaign: z.string().max(200).optional(),
    utm_content: z.string().max(200).optional(),
    gclid: z.string().max(200).optional(),
    fbclid: z.string().max(200).optional(),
    referrer: z.string().max(500).optional(),
    landing_path: z.string().max(500).optional(),
  })
  .strict()
  .optional();

const Person = {
  name: z.string().trim().min(1).max(80),
  mobile: z.string().max(20),
  pincode: PincodeSchema,
  loss_extent: z.enum(LOSS_EXTENTS).openapi({ description: "Where the hair loss is, as the form's drawings show it." }),
  turnstile_token: z.string().min(1).max(2048),
  attribution: AttributionSchema,
};

/** What a booking did with the address it was sent (src/policy/site-booking.ts). */
export const AddressOutcomeSchema = z.enum(["saved", "on_account"]).openapi({
  description:
    "saved: the address sent is now the person's; on_account: the person already had one, which the visit goes " +
    "to, and the one sent was not written. The address on the account is never sent back.",
});

/**
 * The address a consultation is at: the app's, typed in full, without a building chosen from Google's
 * suggestions, which the site does not offer. Its pincode is the one booked at.
 */
export const TypedAddressSchema = AddressSchema.omit({ building: true, place_id: true })
  .strict()
  .openapi("TypedAddress");

/** "The consultation, then my first fit": the fit asked for, in the window wanted if one was given. */
export const FirstFitRequestSchema = z
  .object({
    window: z.union([z.enum(FIRST_FIT_WINDOWS), z.null()]).openapi({
      description: "The window the fit is wanted in, or null for either. A first fit does not fit in the evening.",
    }),
  })
  .strict()
  .optional()
  .openapi("FirstFitRequest", {
    description:
      "Left out, the consultation alone. Sent, the first fit is asked for too: it is booked and paid for in the app " +
      "once the consultation is done, and nothing is paid here.",
  });

/** What a booking says of the first fit asked for with it. */
export const FirstFitOutcomeSchema = z.boolean().openapi({
  description: "true: the first fit was asked for too, and the app offers it once the consultation is done.",
});

/** The first fit a booking asked for, as the domain takes it: null for the consultation alone. */
export const firstFitOf = (asked: z.infer<typeof FirstFitRequestSchema>) =>
  asked === undefined ? null : { window: asked.window };

const ConsultationRequestSchema = z
  .object({
    ...Person,
    date: z.iso.date(),
    window: z.enum(BOOKING_WINDOWS),
    address: TypedAddressSchema,
    first_fit: FirstFitRequestSchema,
    consent: z.literal(true).openapi({ description: '"You may contact me on WhatsApp about this consultation."' }),
  })
  .strict();

const WaitlistRequestSchema = z
  .object({
    ...Person,
    contact_consent: z.literal(true).openapi({ description: '"You may contact me about this request." Required.' }),
    launch_alert: z.boolean().openapi({ description: '"Tell me when you launch in my area." Optional.' }),
  })
  .strict();

const ConsultationSchema = z
  .object({
    state: z.enum(["booked", "requested"]).openapi({
      description: 'A slot is held for a "booked" one; a "requested" one waits for ops, self-serve booking being off.',
    }),
    date: z.iso.date(),
    window: z.enum(BOOKING_WINDOWS),
    area: z.string(),
    address: AddressOutcomeSchema,
    first_fit: FirstFitOutcomeSchema,
  })
  .strict()
  .openapi("Consultation");

const WaitlistSchema = z
  .object({ area: z.union([z.string(), z.null()]) })
  .strict()
  .openapi("Waitlist");

/** The consultation a number already has, which a second booking is refused for. */
export const AlreadyBookedSchema = z
  .object({
    error: ErrorResponseSchema.shape.error,
    booked: z
      .object({ date: z.iso.date(), window: z.enum(BOOKING_WINDOWS) })
      .strict()
      .openapi({ description: "The day and window of the consultation still to happen." }),
  })
  .strict()
  .openapi("AlreadyBooked");

/** 409: a window gone, or a consultation this number already has. */
export const takenOrBooked = {
  description:
    "taken: that window has gone; already_booked: this number has a consultation still to happen; " +
    "idempotency_in_progress: the first request with this key is still running",
  content: { "application/json": { schema: z.union([ErrorResponseSchema, AlreadyBookedSchema]) } },
} as const;

const consultationRoute = createRoute({
  method: "post",
  path: "/api/consultation",
  summary: "Book a free consultation",
  request: {
    headers: IdempotencyKeyHeaderSchema,
    body: { content: { "application/json": { schema: ConsultationRequestSchema } } },
  },
  responses: {
    201: { description: "Booked, or asked for", content: { "application/json": { schema: ConsultationSchema } } },
    400: errorResponse("invalid_request"),
    403: errorResponse("turnstile_failed"),
    409: takenOrBooked,
    422: errorResponse(
      "invalid_request: the pincode is not served, or the day is not open, or the address is in another pincode " +
        "(fields names address.pincode); not_bookable: this number is past consultations, and books in the app; " +
        "idempotency_key_reused: the key was used with a different body",
    ),
    429: errorResponse("rate_limited"),
    503: errorResponse("unavailable: Turnstile could not be reached"),
  },
});

const waitlistRoute = createRoute({
  method: "post",
  path: "/api/waitlist",
  summary: "Wait for a pincode we do not serve yet",
  request: {
    headers: IdempotencyKeyHeaderSchema,
    body: { content: { "application/json": { schema: WaitlistRequestSchema } } },
  },
  responses: {
    201: { description: "On the list", content: { "application/json": { schema: WaitlistSchema } } },
    400: errorResponse("invalid_request"),
    403: errorResponse("turnstile_failed"),
    409: errorResponse("idempotency_in_progress: the first request with this key is still running"),
    422: errorResponse(
      "invalid_request: that pincode is served; book instead; idempotency_key_reused: the key was used with a " +
        "different body",
    ),
    429: errorResponse("rate_limited"),
    503: errorResponse("unavailable: Turnstile could not be reached"),
  },
});

export function registerConsultations(app: App): void {
  app.openapi(consultationRoute, async (c) => {
    const body = c.req.valid("json");
    const { requestId } = c.var;
    const key = c.req.valid("header")["idempotency-key"];

    const run = await onceForKey(c, { route: "POST /api/consultation", key, request: body }, async () => {
      const booked = await bookConsultation(formRequest(c), {
        name: body.name,
        mobile: body.mobile,
        pincode: body.pincode,
        address: addressOf(body.address),
        date: body.date,
        window: body.window,
        lossExtent: body.loss_extent,
        turnstileToken: body.turnstile_token,
        attribution: body.attribution ?? {},
        invite: null,
        firstFit: firstFitOf(body.first_fit),
      });
      if (!booked.ok) return booked;
      const { state, date, window, area, address, firstFit } = booked;
      return { ok: true, body: { state, date, window, area, address, first_fit: firstFit } };
    });
    if (run.kind === "replay") return c.json(run.body, 201);
    if (run.kind === "in_progress") return c.json(errorBody("idempotency_in_progress", requestId), 409);
    if (run.kind === "key_reused") return c.json(errorBody("idempotency_key_reused", requestId), 422);

    const booked = run.outcome;
    if (booked.ok) return c.json(booked.body, 201);
    if (booked.booked !== undefined) {
      return c.json({ ...errorBody("already_booked", requestId), booked: booked.booked }, 409);
    }
    return c.json(errorBody(booked.code, requestId, booked.fields), booked.status);
  });

  app.openapi(waitlistRoute, async (c) => {
    const body = c.req.valid("json");
    const { requestId } = c.var;
    const key = c.req.valid("header")["idempotency-key"];

    const run = await onceForKey(c, { route: "POST /api/waitlist", key, request: body }, async () => {
      const listed = await joinTheWaitlist(formRequest(c), {
        name: body.name,
        mobile: body.mobile,
        pincode: body.pincode,
        lossExtent: body.loss_extent,
        launchAlert: body.launch_alert,
        turnstileToken: body.turnstile_token,
        attribution: body.attribution ?? {},
        invite: null,
      });
      if (!listed.ok) return listed;
      return { ok: true, body: { area: listed.area } };
    });
    if (run.kind === "replay") return c.json(run.body, 201);
    if (run.kind === "in_progress") return c.json(errorBody("idempotency_in_progress", requestId), 409);
    if (run.kind === "key_reused") return c.json(errorBody("idempotency_key_reused", requestId), 422);

    const listed = run.outcome;
    if (listed.ok) return c.json(listed.body, 201);
    return c.json(errorBody(listed.code, requestId), listed.status);
  });
}
