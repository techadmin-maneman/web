// The referral landing's API (design/phase2/Referral and Waitlist, C1 to C4; docs/decisions/0048-referrals.md),
// on the public host, for maneman.in/r/:code:
//
//   GET  /api/r/:code                 the invite: valid or unknown, with the referrer's first name if they agreed
//   GET  /api/pincodes/:pin           whether we come there, and the area's name
//   POST /api/r/:code/consultation    book a free consultation through the invite, or ask for one where
//                                     self-serve booking is off and ops fix the hour on WhatsApp
//   POST /api/r/:code/waitlist        wait for an unserved pincode, the invite held until 12 months after launch
//   GET  /api/og/:code.jpg?v=         the invite's preview image: the referrer's card while it is live, else the
//                                     house card; the version in the link is what makes a revoke reach new shares
//
// Posting takes a Turnstile token, and the same limits per number and address as the booking form. A consultation
// takes the full address it is at, as the booking form's does (docs/decisions/0081-the-site-takes-the-address.md),
// and may ask for the first fit to follow, as it may there (docs/decisions/0086-the-next-visit-is-offered.md).
// An unknown code still books or waits, without an invite. The same submission sent again under its
// Idempotency-Key gets its first answer.

import { createRoute, z } from "@hono/zod-openapi";
import type { Context } from "hono";
import type { App, AppEnv } from "../http/context.ts";
import { HOUSE_CARD } from "../config/house-card.ts";
import { BOOKING_WINDOWS } from "../config/scheduling.ts";
import { bookConsultation, joinTheWaitlist, pincodeOf } from "../domain/public-booking.ts";
import { liveCard } from "../domain/referral-cards.ts";
import { CODE_PATTERN, inviteOf, type Invite } from "../domain/referrals.ts";
import { errorBody, errorResponse } from "../http/errors.ts";
import { IdempotencyKeyHeaderSchema, onceForKey } from "../http/idempotency.ts";
import { formRequest } from "../http/public-form.ts";
import { addressOf } from "./client-profile.ts";
import {
  AddressOutcomeSchema,
  CreditsSchema,
  FirstFitOutcomeSchema,
  firstFitOf,
  FirstFitRequestSchema,
  InviteStateSchema,
  takenOrBooked,
  TypedAddressSchema,
} from "./consultations.ts";

const CodeParams = z.object({ code: z.string().regex(CODE_PATTERN) });

/** Six digits, and never starting with 0 or 9: India's pincodes. */
const PincodeSchema = z
  .string()
  .regex(/^[1-8]\d{5}$/)
  .openapi({ description: "A six-digit Indian pincode." });

const InviteSchema = z
  .object({
    state: z.enum(["valid", "unknown"]),
    referrer_first_name: z
      .union([z.string(), z.null()])
      .openapi({ description: "Only if the referrer agreed to be named, and naming is on (REFERRER_NAME_ON_INVITE)." }),
    card: z
      .object({ state: z.enum(["house", "personal"]), version: z.number().int() })
      .strict()
      .openapi({ description: "Which card the invite shows, and its version for the preview's URL." }),
  })
  .strict()
  .openapi("Invite");

const PincodeAnswerSchema = z
  .object({
    pincode: z.string(),
    served: z.boolean(),
    area: z.union([z.string(), z.null()]).openapi({ description: "Null for a pincode we do not know." }),
    city: z.union([z.string(), z.null()]),
  })
  .strict()
  .openapi("PincodeAnswer");

const Person = {
  name: z.string().trim().min(1).max(80),
  mobile: z.string().max(20),
  turnstile_token: z.string().min(1).max(2048),
};

const ConsultationRequestSchema = z
  .object({
    ...Person,
    pincode: PincodeSchema,
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
    pincode: PincodeSchema,
    contact_consent: z.literal(true).openapi({ description: '"You may contact me about this request." Required.' }),
    launch_alert: z.boolean().openapi({ description: '"Tell me when you launch in my area." Optional.' }),
  })
  .strict();

/** The crawlers that fetch a shared link to draw its preview in a chat or a feed, by their user agents. */
const LINK_PREVIEW =
  /WhatsApp|facebookexternalhit|facebookcatalog|meta-externalagent|TelegramBot|Discordbot|Slackbot|LinkedInBot|Twitterbot|SkypeUriPreview|Googlebot|bingbot|Applebot/i;

const ogRoute = createRoute({
  method: "get",
  path: "/api/og/{file}",
  summary: "An invite's preview image",
  request: { params: z.object({ file: z.string().regex(/^[A-Za-z0-9]{4,12}\.jpg$/) }) },
  responses: {
    200: { description: "The referrer's card", content: { "image/jpeg": { schema: z.string() } } },
    302: { description: "The house card, on the site" },
  },
});

const inviteRoute = createRoute({
  method: "get",
  path: "/api/r/{code}",
  summary: "An invite: valid or unknown",
  request: { params: CodeParams },
  responses: { 200: { description: "The invite", content: { "application/json": { schema: InviteSchema } } } },
});

const pincodeRoute = createRoute({
  method: "get",
  path: "/api/pincodes/{pin}",
  summary: "Whether we come to a pincode",
  request: { params: z.object({ pin: PincodeSchema }) },
  responses: {
    200: { description: "Served or not", content: { "application/json": { schema: PincodeAnswerSchema } } },
    400: errorResponse('invalid_request: "That is not a six-digit Indian pincode."'),
  },
});

const consultationRoute = createRoute({
  method: "post",
  path: "/api/r/{code}/consultation",
  summary: "Book a free consultation through an invite",
  request: {
    params: CodeParams,
    headers: IdempotencyKeyHeaderSchema,
    body: { content: { "application/json": { schema: ConsultationRequestSchema } } },
  },
  responses: {
    201: {
      description: "Booked, or asked for",
      content: {
        "application/json": {
          schema: z
            .object({
              state: z.enum(["booked", "requested"]).openapi({
                description:
                  'A slot is held for a "booked" one; a "requested" one waits for ops, self-serve booking being off.',
              }),
              date: z.iso.date(),
              window: z.enum(BOOKING_WINDOWS),
              area: z.string(),
              credits: CreditsSchema,
              invite: InviteStateSchema,
              address: AddressOutcomeSchema,
              first_fit: FirstFitOutcomeSchema,
            })
            .strict()
            .openapi("ReferralConsultation"),
        },
      },
    },
    400: errorResponse("invalid_request"),
    403: errorResponse("turnstile_failed"),
    409: takenOrBooked,
    422: errorResponse(
      "not_bookable: the pincode is not served, the day is not open, or this number is past consultations; " +
        "invalid_request: the address is in another pincode (fields names address.pincode); " +
        "idempotency_key_reused: the key was used with a different body",
    ),
    429: errorResponse("rate_limited"),
    503: errorResponse("unavailable: Turnstile could not be reached"),
  },
});

const waitlistRoute = createRoute({
  method: "post",
  path: "/api/r/{code}/waitlist",
  summary: "Wait for an unserved pincode",
  request: {
    params: CodeParams,
    headers: IdempotencyKeyHeaderSchema,
    body: { content: { "application/json": { schema: WaitlistRequestSchema } } },
  },
  responses: {
    201: {
      description: "On the list",
      content: {
        "application/json": {
          schema: z
            .object({ area: z.union([z.string(), z.null()]), credits: CreditsSchema, invite: InviteStateSchema })
            .strict()
            .openapi("ReferralWaitlist"),
        },
      },
    },
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

export function registerReferralLanding(app: App): void {
  const invite = (c: Context<AppEnv>, code: string): Promise<Invite | null> =>
    inviteOf(c.env.DB, code, c.var.config.settings.referrerNameOnInvite);

  app.openapi(inviteRoute, async (c) => {
    const found = await invite(c, c.req.valid("param").code);
    // Ops' funnel counts opens; the referrer never sees them (the tracker shows fits only). A chat app fetching the
    // link for its preview is not an open: the site's Worker passes the visitor's user agent on.
    if (found !== null && !LINK_PREVIEW.test(c.req.header("User-Agent") ?? "")) {
      await c.env.DB.prepare("UPDATE referral_codes SET opens = opens + 1 WHERE code = ?1").bind(found.code).run();
    }
    return c.json(
      found === null
        ? { state: "unknown" as const, referrer_first_name: null, card: { state: "house" as const, version: 1 } }
        : { state: "valid" as const, referrer_first_name: found.referrerFirstName, card: found.card },
      200,
    );
  });

  app.openapi(ogRoute, async (c) => {
    const code = c.req
      .valid("param")
      .file.replace(/\.jpg$/, "")
      .toUpperCase();
    const card = await liveCard(c.env.DB, c.env.REFERRAL_CARDS, code);
    if (card === null) return c.redirect(HOUSE_CARD, 302);
    // A version's card never changes: a new one gets a new link. The length tells a chat's crawler the card's size
    // before it reads it, as the house card's static file does.
    return c.body(card.body, 200, {
      "Content-Type": "image/jpeg",
      "Content-Length": String(card.size),
      "Cache-Control": "public, max-age=86400",
    });
  });

  app.openapi(pincodeRoute, async (c) => {
    const pin = c.req.valid("param").pin;
    const row = await pincodeOf(c.env.DB, pin);
    return c.json({ pincode: pin, served: row?.served === 1, area: row?.area ?? null, city: row?.city ?? null }, 200);
  });

  app.openapi(consultationRoute, async (c) => {
    const { code } = c.req.valid("param");
    const body = c.req.valid("json");
    const { requestId } = c.var;
    const key = c.req.valid("header")["idempotency-key"];

    const keyed = { route: "POST /api/r/:code/consultation", key, request: { code, ...body } };
    const run = await onceForKey(c, keyed, async () => {
      const booked = await bookConsultation(formRequest(c), {
        name: body.name,
        mobile: body.mobile,
        pincode: body.pincode,
        address: addressOf(body.address),
        date: body.date,
        window: body.window,
        lossExtent: null, // an invited friend is not asked where the hair loss is
        turnstileToken: body.turnstile_token,
        attribution: {},
        invite: await invite(c, code),
        firstFit: firstFitOf(body.first_fit),
      });
      if (!booked.ok) return booked;
      return {
        ok: true,
        body: {
          state: booked.state,
          date: booked.date,
          window: booked.window,
          area: booked.area,
          credits: booked.credits,
          invite: booked.invite,
          address: booked.address,
          first_fit: booked.firstFit,
        },
      };
    });
    if (run.kind === "replay") return c.json(run.body, 201);
    if (run.kind === "in_progress") return c.json(errorBody("idempotency_in_progress", requestId), 409);
    if (run.kind === "key_reused") return c.json(errorBody("idempotency_key_reused", requestId), 422);

    const booked = run.outcome;
    if (booked.ok) return c.json(booked.body, 201);
    if (booked.booked !== undefined) {
      return c.json({ ...errorBody("already_booked", requestId), booked: booked.booked }, 409);
    }
    // The landing has said all along whether we come, so a refused pincode reads as not bookable. A field refused
    // is named instead.
    const code422 = booked.status === 422 && booked.fields === undefined ? "not_bookable" : booked.code;
    return c.json(errorBody(code422, requestId, booked.fields), booked.status);
  });

  app.openapi(waitlistRoute, async (c) => {
    const { code } = c.req.valid("param");
    const body = c.req.valid("json");
    const { requestId } = c.var;
    const key = c.req.valid("header")["idempotency-key"];

    const keyed = { route: "POST /api/r/:code/waitlist", key, request: { code, ...body } };
    const run = await onceForKey(c, keyed, async () => {
      const listed = await joinTheWaitlist(formRequest(c), {
        name: body.name,
        mobile: body.mobile,
        pincode: body.pincode,
        lossExtent: null,
        launchAlert: body.launch_alert,
        turnstileToken: body.turnstile_token,
        attribution: {},
        invite: await invite(c, code),
      });
      if (!listed.ok) return listed;
      return { ok: true, body: { area: listed.area, credits: listed.credits, invite: listed.invite } };
    });
    if (run.kind === "replay") return c.json(run.body, 201);
    if (run.kind === "in_progress") return c.json(errorBody("idempotency_in_progress", requestId), 409);
    if (run.kind === "key_reused") return c.json(errorBody("idempotency_key_reused", requestId), 422);

    const listed = run.outcome;
    if (listed.ok) return c.json(listed.body, 201);
    const code422 = listed.status === 422 ? "not_bookable" : listed.code;
    return c.json(errorBody(code422, requestId), listed.status);
  });
}
