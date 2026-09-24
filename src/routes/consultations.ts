// Booking from the public site (docs/decisions/0051-booking-from-the-site.md):
//
//   POST /api/consultation   a free consultation on a real date and window
//   POST /api/waitlist       the number, for a pincode we do not serve yet
//
// These are the referral landing's two routes without the invite, and they share
// their whole path (src/domain/public-booking.ts): the same Turnstile check, the
// same daily limits per number and address, the same consent notices, the same
// held slot written to FSM, and the same lead behind it so the CRM funnel sees
// every booking. Whether we come is decided by the pincode, which
// GET /api/pincodes/{pin} answers for the form.

import { createRoute, z } from "@hono/zod-openapi";
import type { App } from "../app.ts";
import { LOSS_EXTENTS } from "../config/booking.ts";
import { BOOKING_WINDOWS } from "../config/scheduling.ts";
import { bookConsultation, joinTheWaitlist } from "../domain/public-booking.ts";
import { errorBody, errorResponse } from "../http/errors.ts";

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

const ConsultationRequestSchema = z
  .object({
    ...Person,
    date: z.iso.date(),
    window: z.enum(BOOKING_WINDOWS),
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
  })
  .strict()
  .openapi("Consultation");

const WaitlistSchema = z
  .object({ area: z.union([z.string(), z.null()]) })
  .strict()
  .openapi("Waitlist");

const consultationRoute = createRoute({
  method: "post",
  path: "/api/consultation",
  summary: "Book a free consultation",
  request: { body: { content: { "application/json": { schema: ConsultationRequestSchema } } } },
  responses: {
    201: { description: "Booked, or asked for", content: { "application/json": { schema: ConsultationSchema } } },
    400: errorResponse("invalid_request"),
    403: errorResponse("turnstile_failed"),
    409: errorResponse("taken: that window has gone"),
    422: errorResponse("invalid_request: the pincode is not served, or the day is not open"),
    429: errorResponse("rate_limited"),
    503: errorResponse("unavailable: Turnstile could not be reached"),
  },
});

const waitlistRoute = createRoute({
  method: "post",
  path: "/api/waitlist",
  summary: "Wait for a pincode we do not serve yet",
  request: { body: { content: { "application/json": { schema: WaitlistRequestSchema } } } },
  responses: {
    201: { description: "On the list", content: { "application/json": { schema: WaitlistSchema } } },
    400: errorResponse("invalid_request"),
    403: errorResponse("turnstile_failed"),
    422: errorResponse("invalid_request: that pincode is served; book instead"),
    429: errorResponse("rate_limited"),
    503: errorResponse("unavailable: Turnstile could not be reached"),
  },
});

export function registerConsultations(app: App): void {
  app.openapi(consultationRoute, async (c) => {
    const body = c.req.valid("json");
    const booked = await bookConsultation(c, {
      name: body.name,
      mobile: body.mobile,
      pincode: body.pincode,
      date: body.date,
      window: body.window,
      lossExtent: body.loss_extent,
      turnstileToken: body.turnstile_token,
      attribution: body.attribution ?? {},
      invite: null,
    });
    if (!booked.ok) return c.json(errorBody(booked.code, c.var.requestId), booked.status);
    return c.json({ state: booked.state, date: booked.date, window: booked.window, area: booked.area }, 201);
  });

  app.openapi(waitlistRoute, async (c) => {
    const body = c.req.valid("json");
    const listed = await joinTheWaitlist(c, {
      name: body.name,
      mobile: body.mobile,
      pincode: body.pincode,
      lossExtent: body.loss_extent,
      launchAlert: body.launch_alert,
      turnstileToken: body.turnstile_token,
      attribution: body.attribution ?? {},
      invite: null,
    });
    if (!listed.ok) return c.json(errorBody(listed.code, c.var.requestId), listed.status);
    return c.json({ area: listed.area }, 201);
  });
}
