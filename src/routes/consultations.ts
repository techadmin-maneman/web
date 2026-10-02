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
// Every number gets the same answer, so the form tells nobody whether a number
// is a client's: one with a consultation still to happen, or past consultations,
// books nothing, and its owner is told why on WhatsApp
// (src/policy/site-booking.ts). The same submission sent again under its
// Idempotency-Key gets its first answer.
//
// A consultation is booked with the full address it is at, which becomes the
// person's address unless they already have one; a waitlist entry takes none
// (docs/decisions/0081-the-site-takes-the-address.md).
//
// The form may book the consultation and the first fit in one visit instead:
// three hours, morning or afternoon, with nothing paid here; the client chooses
// the product with the technician and pays by a link once fitted
// (docs/decisions/0105-a-consultation-and-fit-in-one-visit.md). That one may
// carry a discount code, which comes off the product's price at the link
// (docs/decisions/0108-discount-codes.md).
//
// Either may carry the code of an invite the visitor opened on this browser in the
// last 30 days, and is then attributed to it exactly as the landing's would be,
// once the form has said beside it who is told of the fit. A code sent without
// that, a code we do not have, or one not shaped like a code, is ignored, and the
// booking goes ahead without an invite (docs/decisions/0089-an-invite-is-not-lost.md).

import { createRoute, z } from "@hono/zod-openapi";
import type { Context } from "hono";
import type { App, AppEnv } from "../http/context.ts";
import { LOSS_EXTENTS } from "../config/booking.ts";
import { TOLD_NOTICES } from "../config/notices.ts";
import { BOOKING_WINDOWS } from "../config/scheduling.ts";
import { bookConsultation, joinTheWaitlist } from "../domain/public-booking.ts";
import type { Plan } from "../policy/one-visit.ts";
import { CODE_PATTERN, inviteOf, type Invite } from "../domain/referrals.ts";
import { errorBody, errorResponse } from "../http/errors.ts";
import { IdempotencyKeyHeaderSchema, onceForKey } from "../http/idempotency.ts";
import { formRequest } from "../http/public-form.ts";
import { addressOf, AddressSchema, RequiredFlatSchema } from "./client-profile.ts";

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
  loss_extent: z.enum(LOSS_EXTENTS).optional().openapi({
    description: "Where the hair loss is, as the form's drawings show it. Left out when the visitor does not say.",
  }),
  turnstile_token: z.string().min(1).max(2048),
  attribution: AttributionSchema,
  invite_code: z
    .string()
    .max(64)
    .optional()
    .openapi({
      description:
        "The code of an invite this browser opened in the last 30 days. One sent without invite_told, one we do " +
        "not have, or one not shaped like a code, is ignored: the booking goes ahead without an invite.",
    }),
  invite_told: z
    .literal(true)
    .optional()
    .openapi({
      description:
        "true: beside the invite, the form said that whoever sent it is told when the friend is fitted, and offered " +
        "to go on without it. The attribution records it.",
    }),
};

/** The invite as it stands for the person who used it, as the landing answers it too. */
export const InviteStateSchema = z.enum(["valid", "expired", "unknown"]).openapi({
  description:
    "valid; expired, when the invite held for them on a waitlist lapsed 12 months after their area launched, so " +
    "the consultation is still free and the invite's visits do not apply; or unknown: no invite came with it, or a " +
    "code we do not have.",
});

export const CreditsSchema = z.boolean().openapi({ description: "Whether the invite's service visits apply." });

/**
 * The address a consultation is at: the app's, typed in full, without a building chosen from Google's
 * suggestions, which the site does not offer. Its pincode is the one booked at.
 */
export const TypedAddressSchema = AddressSchema.omit({ building: true, place_id: true })
  .extend({ flat: RequiredFlatSchema })
  .strict()
  .openapi("TypedAddress");

/** "Consultation and fit, in one visit": the second of the form's two choices. */
export const OneVisitRequestSchema = z
  .boolean()
  .optional()
  .openapi({
    description:
      "true: the consultation and the first fit in one visit, three hours, in the morning or the afternoon; the " +
      "client chooses the product with the technician and pays once fitted, so nothing is paid here. Left out or " +
      "false, the consultation alone.",
  });

/** What a booking says of the plan it booked. */
export const OneVisitOutcomeSchema = z.boolean().openapi({
  description: "true: the consultation and the first fit in one visit were booked, or asked for.",
});

/** The plan a booking asked for, as the domain takes it. */
export const planOf = (oneVisit: boolean | undefined): Plan => (oneVisit === true ? "one_visit" : "consultation");

const ConsultationRequestSchema = z
  .object({
    ...Person,
    date: z.iso.date(),
    window: z.enum(BOOKING_WINDOWS),
    address: TypedAddressSchema,
    one_visit: OneVisitRequestSchema,
    discount_code: z
      .string()
      .trim()
      .min(1)
      .max(40)
      .optional()
      .openapi({
        description:
          "A discount code for the consultation and fit in one visit, as typed, any case: it comes off the product's " +
          "price at the payment link (docs/decisions/0108-discount-codes.md). A code that does not apply refuses " +
          "the booking, code_not_applicable, and so does any code with the consultation alone.",
      }),
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
    credits: CreditsSchema,
    invite: InviteStateSchema,
    one_visit: OneVisitOutcomeSchema,
    discount_code: z.boolean().openapi({
      description:
        "true: the code given stands on the booking, or on the request ops book from; false when none was given, " +
        "or another booking took the code's last use a moment before, and the booking stands without it.",
    }),
  })
  .strict()
  .openapi("Consultation");

const WaitlistSchema = z
  .object({ area: z.union([z.string(), z.null()]), credits: CreditsSchema, invite: InviteStateSchema })
  .strict()
  .openapi("Waitlist");

/** 409, the same for every number: a window gone, or the same submission still running. */
export const takenOrInProgress = errorResponse(
  "taken: that window has gone; idempotency_in_progress: the first request with this key is still running",
);

/** Booked, or asked for, or the answer a new number would get: a number we know is told the rest on WhatsApp. */
export const BOOKED_DESCRIPTION =
  "Booked, or asked for. A number with a consultation still to happen, or past consultations, gets the answer a " +
  "new number would, books nothing, and is told why on WhatsApp.";

const consultationRoute = createRoute({
  method: "post",
  path: "/api/consultation",
  summary: "Book a free consultation",
  request: {
    headers: IdempotencyKeyHeaderSchema,
    body: { content: { "application/json": { schema: ConsultationRequestSchema } } },
  },
  responses: {
    201: { description: BOOKED_DESCRIPTION, content: { "application/json": { schema: ConsultationSchema } } },
    400: errorResponse(
      "invalid_request: fields names what was refused, address.pincode for an address in another pincode, window " +
        "for one visit in the evening",
    ),
    403: errorResponse("turnstile_failed"),
    409: takenOrInProgress,
    422: errorResponse(
      "not_bookable: the pincode is not served, or the day is not open; code_not_applicable: the discount code " +
        "does not apply, fields names discount_code; no_product: one visit, on a day the console offers no hair " +
        "system; idempotency_key_reused: the key was used with a different body",
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
      "not_bookable: that pincode is served; book instead; idempotency_key_reused: the key was used with a " +
        "different body",
    ),
    429: errorResponse("rate_limited"),
    503: errorResponse("unavailable: Turnstile could not be reached"),
  },
});

/**
 * The invite a remembered code names, once the form has said who is told of the fit beside it; null for none, one
 * sent without that, one we do not have, or one not shaped like a code.
 */
function rememberedInvite(
  c: Context<AppEnv>,
  sent: { invite_code?: string | undefined; invite_told?: true | undefined },
): Promise<Invite | null> {
  const code = sent.invite_code;
  if (sent.invite_told !== true || code === undefined || !CODE_PATTERN.test(code)) return Promise.resolve(null);
  return inviteOf(c.env.DB, code, c.var.config.settings.referrerNameOnInvite);
}

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
        lossExtent: body.loss_extent ?? null,
        turnstileToken: body.turnstile_token,
        attribution: body.attribution ?? {},
        invite: await rememberedInvite(c, body),
        toldNotice: TOLD_NOTICES.book,
        source: "site_booking",
        plan: planOf(body.one_visit),
        discountCode: body.discount_code ?? null,
      });
      if (!booked.ok) return booked;
      const { state, date, window, area, credits, invite, oneVisit, discountCode } = booked;
      const answer = { state, date, window, area, credits, invite, one_visit: oneVisit };
      return { ok: true, body: { ...answer, discount_code: discountCode } };
    });
    if (run.kind === "replay") return c.json(run.body, 201);
    if (run.kind === "in_progress") return c.json(errorBody("idempotency_in_progress", requestId), 409);
    if (run.kind === "key_reused") return c.json(errorBody("idempotency_key_reused", requestId), 422);

    const booked = run.outcome;
    if (booked.ok) return c.json(booked.body, 201);
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
        lossExtent: body.loss_extent ?? null,
        launchAlert: body.launch_alert,
        turnstileToken: body.turnstile_token,
        attribution: body.attribution ?? {},
        invite: await rememberedInvite(c, body),
        toldNotice: TOLD_NOTICES.book,
        source: "site_waitlist",
      });
      if (!listed.ok) return listed;
      return { ok: true, body: { area: listed.area, credits: listed.credits, invite: listed.invite } };
    });
    if (run.kind === "replay") return c.json(run.body, 201);
    if (run.kind === "in_progress") return c.json(errorBody("idempotency_in_progress", requestId), 409);
    if (run.kind === "key_reused") return c.json(errorBody("idempotency_key_reused", requestId), 422);

    const listed = run.outcome;
    if (listed.ok) return c.json(listed.body, 201);
    return c.json(errorBody(listed.code, requestId, listed.fields), listed.status);
  });
}
