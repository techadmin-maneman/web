// The referral landing's API (design/phase2/Referral and Waitlist, C1 to C4; docs/decisions/0048-referrals.md),
// on the public host, for maneman.in/r/:code:
//
//   GET  /api/r/:code                 the invite: valid or unknown, with the referrer's first name if they agreed
//   GET  /api/pincodes/:pin           whether we come there, and the area's name
//   POST /api/r/:code/consultation    book a free consultation through the invite
//   POST /api/r/:code/waitlist        wait for an unserved pincode, the invite held until 12 months after launch
//
// Posting takes a Turnstile token, and the same limits per number and address as the booking form. An unknown
// code still books or waits, without an invite.

import { createRoute, z } from "@hono/zod-openapi";
import type { Context } from "hono";
import type { App, AppEnv } from "../app.ts";
import { CURRENT_NOTICE, LANDING_NOTICES } from "../config/notices.ts";
import { BOOKING_DAYS, BOOKING_WINDOWS, HOLD_SECONDS } from "../config/scheduling.ts";
import { takeOne } from "../domain/rate-limit.ts";
import { attribute, inviteOf, type Invite } from "../domain/referrals.ts";
import { holdSlot } from "../domain/scheduling.ts";
import { errorBody, errorResponse } from "../http/errors.ts";
import { checkTurnstile, visitorOf } from "../http/visitor.ts";
import { saltedHash } from "../lib/hash.ts";
import { addDays, indiaDate } from "../lib/india-time.ts";
import { toE164 } from "../lib/mobile.ts";
import type { FsmSyncMessage } from "../queues/fsm-sync.ts";

const CodeParams = z.object({ code: z.string().regex(/^[A-Za-z0-9]{4,12}$/) });

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
    body: { content: { "application/json": { schema: ConsultationRequestSchema } } },
  },
  responses: {
    201: {
      description: "Booked",
      content: {
        "application/json": {
          schema: z
            .object({
              state: z.literal("booked"),
              date: z.iso.date(),
              window: z.enum(BOOKING_WINDOWS),
              area: z.string(),
              credits: z.boolean().openapi({ description: "Whether the invite's 3 service visits apply." }),
            })
            .strict()
            .openapi("ReferralConsultation"),
        },
      },
    },
    400: errorResponse("invalid_request"),
    403: errorResponse("turnstile_failed"),
    409: errorResponse("taken: that window has gone; ops_assisted: booking goes through WhatsApp for now"),
    422: errorResponse("not_bookable: the pincode is not served, or the day is not open"),
    429: errorResponse("rate_limited"),
    503: errorResponse("unavailable: Turnstile could not be reached"),
  },
});

const waitlistRoute = createRoute({
  method: "post",
  path: "/api/r/{code}/waitlist",
  summary: "Wait for an unserved pincode",
  request: { params: CodeParams, body: { content: { "application/json": { schema: WaitlistRequestSchema } } } },
  responses: {
    201: {
      description: "On the list",
      content: {
        "application/json": {
          schema: z
            .object({ area: z.union([z.string(), z.null()]), credits: z.boolean() })
            .strict()
            .openapi("ReferralWaitlist"),
        },
      },
    },
    400: errorResponse("invalid_request"),
    403: errorResponse("turnstile_failed"),
    422: errorResponse("not_bookable: that pincode is served; book instead"),
    429: errorResponse("rate_limited"),
    503: errorResponse("unavailable: Turnstile could not be reached"),
  },
});

interface Pincode {
  pincode: string;
  area: string;
  city: string;
  served: number;
}

const pincodeOf = (db: D1Database, pin: string) =>
  db
    .prepare("SELECT pincode, area, city, served FROM serviceable_pincodes WHERE pincode = ?1")
    .bind(pin)
    .first<Pincode>();

type Checked =
  | { readonly ok: true; readonly mobile: string; readonly ipHash: string }
  | {
      readonly ok: false;
      readonly status: 400 | 403 | 429 | 503;
      readonly code: "invalid_request" | "turnstile_failed" | "rate_limited" | "unavailable";
    };

/** The number, the Turnstile check and the daily limits, as the booking form has them. */
async function checkPerson(c: Context<AppEnv>, mobile: string, token: string): Promise<Checked> {
  const mobileE164 = toE164(mobile);
  if (mobileE164 === null) return { ok: false, status: 400, code: "invalid_request" };
  const visitor = await visitorOf(c);
  const turnstile = await checkTurnstile(c, token, visitor);
  if (turnstile === "rejected") return { ok: false, status: 403, code: "turnstile_failed" };
  if (turnstile === "unavailable") return { ok: false, status: 503, code: "unavailable" };
  const { settings } = c.var.config;
  const today = indiaDate(c.var.deps.now());
  const db = c.env.DB;
  const within =
    (await takeOne(db, {
      scope: "referral:mobile",
      key: await saltedHash(settings.ipHashSalt, `mobile:${mobileE164}`),
      window: today,
      limit: settings.leadMobileDailyLimit,
    })) &&
    (await takeOne(db, { scope: "referral:ip", key: visitor.ipHash, window: today, limit: settings.leadIpDailyLimit }));
  if (!within) return { ok: false, status: 429, code: "rate_limited" };
  return { ok: true, mobile: mobileE164, ipHash: visitor.ipHash };
}

/** The person with this number, made if new, and the consent they gave on the page. */
async function personWith(
  db: D1Database,
  input: {
    mobile: string;
    name: string;
    purpose: "whatsapp_visits" | "contact";
    notice: string;
    ipHash: string;
    now: Date;
  },
): Promise<string> {
  const at = input.now.toISOString();
  const person = await db
    .prepare(
      `INSERT INTO people (id, created_at, mobile_e164, name, contactable) VALUES (?1, ?2, ?3, ?4, 1)
       ON CONFLICT (mobile_e164) DO UPDATE SET name = excluded.name, contactable = 1
       RETURNING id`,
    )
    .bind(crypto.randomUUID(), at, input.mobile, input.name)
    .first<{ id: string }>();
  if (person === null) throw new Error("the person was not written");
  await db
    .prepare(
      `INSERT INTO consents (id, person_id, purpose, notice_version, granted, created_at, ip_hash)
       VALUES (?1, ?2, ?3, ?4, 1, ?5, ?6)`,
    )
    .bind(crypto.randomUUID(), person.id, input.purpose, input.notice, at, input.ipHash)
    .run();
  return person.id;
}

export function registerReferralLanding(app: App): void {
  const invite = (c: Context<AppEnv>, code: string): Promise<Invite | null> =>
    inviteOf(c.env.DB, code, c.var.config.settings.referrerNameOnInvite);

  app.openapi(inviteRoute, async (c) => {
    const found = await invite(c, c.req.valid("param").code);
    return c.json(
      found === null
        ? { state: "unknown" as const, referrer_first_name: null, card: { state: "house" as const, version: 1 } }
        : { state: "valid" as const, referrer_first_name: found.referrerFirstName, card: found.card },
      200,
    );
  });

  app.openapi(pincodeRoute, async (c) => {
    const pin = c.req.valid("param").pin;
    const row = await pincodeOf(c.env.DB, pin);
    return c.json({ pincode: pin, served: row?.served === 1, area: row?.area ?? null, city: row?.city ?? null }, 200);
  });

  app.openapi(consultationRoute, async (c) => {
    const { code } = c.req.valid("param");
    const body = c.req.valid("json");
    const { deps, requestId, log } = c.var;
    const db = c.env.DB;
    const now = deps.now();
    if (!c.var.config.settings.selfServeBooking) return c.json(errorBody("ops_assisted", requestId), 409);

    const first = addDays(indiaDate(now), 1);
    const pincode = await pincodeOf(db, body.pincode);
    if (pincode?.served !== 1 || body.date < first || body.date > addDays(first, BOOKING_DAYS - 1)) {
      return c.json(errorBody("not_bookable", requestId), 422);
    }
    const checked = await checkPerson(c, body.mobile, body.turnstile_token);
    if (!checked.ok) return c.json(errorBody(checked.code, requestId), checked.status);

    const personId = await personWith(db, {
      mobile: checked.mobile,
      name: body.name,
      purpose: "whatsapp_visits",
      notice: LANDING_NOTICES.consultation,
      ipHash: checked.ipHash,
      now,
    });
    const found = await invite(c, code);
    const credits =
      found !== null &&
      (await attribute(db, { invite: found, personId, via: "consultation", pincode: body.pincode, now }));

    const free = { amount_ex_gst: 0, amount: 0, gst_percent: 0 };
    const hold = await holdSlot(
      db,
      { personId, type: "consultation", date: body.date, window: body.window, price: free },
      now,
      HOLD_SECONDS,
    );
    if (hold === null) return c.json(errorBody("taken", requestId), 409);
    await c.env.FSM_QUEUE.send({ hold_id: hold.id, request_id: requestId } satisfies FsmSyncMessage);
    log.info("referral_consultation", { hold_id: hold.id, invited: found !== null, credits });
    return c.json({ state: "booked" as const, date: body.date, window: body.window, area: pincode.area, credits }, 201);
  });

  app.openapi(waitlistRoute, async (c) => {
    const { code } = c.req.valid("param");
    const body = c.req.valid("json");
    const { deps, requestId } = c.var;
    const db = c.env.DB;
    const now = deps.now();
    const pincode = await pincodeOf(db, body.pincode);
    if (pincode?.served === 1) return c.json(errorBody("not_bookable", requestId), 422);
    const checked = await checkPerson(c, body.mobile, body.turnstile_token);
    if (!checked.ok) return c.json(errorBody(checked.code, requestId), checked.status);

    const personId = await personWith(db, {
      mobile: checked.mobile,
      name: body.name,
      purpose: "contact",
      notice: LANDING_NOTICES.waitlist,
      ipHash: checked.ipHash,
      now,
    });
    const at = now.toISOString();
    if (body.launch_alert) {
      await db
        .prepare(
          `INSERT INTO consents (id, person_id, purpose, notice_version, granted, created_at, ip_hash)
           VALUES (?1, ?2, 'whatsapp_launches', ?3, 1, ?4, ?5)`,
        )
        .bind(crypto.randomUUID(), personId, CURRENT_NOTICE.whatsapp_launches, at, checked.ipHash)
        .run();
    }
    const found = await invite(c, code);
    await db
      .prepare(
        `INSERT INTO waitlist_entries (id, pincode, person_id, referral_code, contact_consent_at, launch_alert,
           created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?5)
         ON CONFLICT (pincode, person_id) DO UPDATE SET launch_alert = MAX(launch_alert, excluded.launch_alert)`,
      )
      .bind(crypto.randomUUID(), body.pincode, personId, found?.code ?? null, at, body.launch_alert ? 1 : 0)
      .run();
    const credits =
      found !== null && (await attribute(db, { invite: found, personId, via: "waitlist", pincode: body.pincode, now }));
    return c.json({ area: pincode?.area ?? null, credits }, 201);
  });
}
