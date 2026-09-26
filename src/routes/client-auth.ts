// Logging in to the client app with a one-time code (docs/decisions/0030-one-time-codes.md):
//   POST /api/auth/otp          a code on WhatsApp to a number
//   POST /api/auth/otp/resend   a fresh code on WhatsApp, 30 seconds after the last
//   POST /api/auth/otp/sms      a fresh code by SMS instead, 30 seconds after the first
//   POST /api/auth/verify       the code, for a session
//   POST /api/auth/logout
//
// Every answer is the same whether or not the number has a booking, and takes
// the same time: a number without one gets a challenge that sends nothing and
// that no code opens, and a real code is sent after the response has gone.

import { createRoute, z, type RouteHandler } from "@hono/zod-openapi";
import type { Context } from "hono";
import type { App, AppEnv } from "../app.ts";
import {
  createChallenge,
  findEligiblePerson,
  openChallenge,
  replaceCode,
  verifyCode,
  type Challenge,
} from "../domain/login.ts";
import { takeOne } from "../domain/rate-limit.ts";
import { deviceLabel, openSession, revokeSession } from "../domain/sessions.ts";
import { clearClientCookie, clientSessionOf, setClientCookie } from "../http/client-session.ts";
import { errorBody, errorResponse } from "../http/errors.ts";
import { codeGate, countCode, sendCodeAfterResponse } from "../http/send-code.ts";
import { visitorOf } from "../http/visitor.ts";
import { saltedHash } from "../lib/hash.ts";
import { indiaDate, indiaHour } from "../lib/india-time.ts";
import { INDIAN_MOBILE_PATTERN, toE164 } from "../lib/mobile.ts";
import { MAX_SENDS_PER_CHALLENGE, newCode, smsOfferedAt, whatsappResendAt } from "../policy/one-time-code.ts";
import type { CodeChannel } from "../providers/codes.ts";

export const LoginChallengeSchema = z
  .object({
    challenge_id: z.uuid(),
    channel: z.enum(["whatsapp", "sms"]).openapi({ description: "How the current code was sent." }),
    expires_in_s: z.number().int(),
    resend_in_s: z.number().int().openapi({ description: "Seconds until the code may be sent again on WhatsApp." }),
    sms_in_s: z
      .number()
      .int()
      .nullable()
      .openapi({ description: "Seconds until SMS may be asked for instead; null while SMS is unavailable." }),
  })
  .strict()
  .openapi("LoginChallenge");

const MobileSchema = z
  .object({ mobile: z.string().regex(INDIAN_MOBILE_PATTERN).openapi({ example: "98100 00000" }) })
  .strict()
  .openapi("LoginRequest");
const ChallengeRequestSchema = z.object({ challenge_id: z.uuid() }).strict().openapi("LoginChallengeRequest");
const VerifyRequestSchema = z
  .object({ challenge_id: z.uuid(), code: z.string().regex(/^\d{6}$/) })
  .strict()
  .openapi("LoginVerifyRequest");

export const LoginVerifySchema = z
  .discriminatedUnion("verified", [
    z.object({ verified: z.literal(true), first_name: z.string() }).strict(),
    z
      .object({
        verified: z.literal(false),
        attempts_left: z.number().int().openapi({ description: "0 means the code is now void." }),
      })
      .strict(),
  ])
  .openapi("LoginVerify");

const json = <T extends z.ZodType>(schema: T) => ({ content: { "application/json": { schema } } });
const challengeAnswer = {
  description: "A code is on its way, if this number has a booking",
  ...json(LoginChallengeSchema),
};

export const loginRoute = createRoute({
  method: "post",
  path: "/api/auth/otp",
  summary: "Send a login code on WhatsApp. The answer is the same whether or not the number has a booking",
  request: { body: { required: true, ...json(MobileSchema) } },
  responses: {
    202: challengeAnswer,
    400: errorResponse("invalid_request"),
    429: errorResponse("rate_limited: too many codes for this number today, or from this address this hour"),
    503: errorResponse("busy: today's ceiling on codes is reached"),
  },
});

export const resendRoute = createRoute({
  method: "post",
  path: "/api/auth/otp/resend",
  summary: "Send a fresh code on WhatsApp, 30 seconds after the last one",
  request: { body: { required: true, ...json(ChallengeRequestSchema) } },
  responses: {
    202: challengeAnswer,
    410: errorResponse("code_expired: start again"),
    429: errorResponse("too_early, or rate_limited"),
    503: errorResponse("busy"),
  },
});

export const smsRoute = createRoute({
  method: "post",
  path: "/api/auth/otp/sms",
  summary: "Send a fresh code by SMS instead, 30 seconds after the first",
  request: { body: { required: true, ...json(ChallengeRequestSchema) } },
  responses: {
    202: challengeAnswer,
    404: errorResponse("not_found: SMS is not available"),
    410: errorResponse("code_expired: start again"),
    429: errorResponse("too_early, or rate_limited"),
    503: errorResponse("busy"),
  },
});

export const verifyRoute = createRoute({
  method: "post",
  path: "/api/auth/verify",
  summary: "Check a code. The right one opens a session (the mm_app cookie)",
  request: { body: { required: true, ...json(VerifyRequestSchema) } },
  responses: {
    200: { description: "Right, with a session; or wrong, with the attempts left", ...json(LoginVerifySchema) },
    400: errorResponse("invalid_request"),
    410: errorResponse("code_expired: expired, used, or void after five wrong codes"),
  },
});

export const logoutRoute = createRoute({
  method: "post",
  path: "/api/auth/logout",
  summary: "End this session",
  responses: { 204: { description: "Logged out" } },
});

type Ctx = Context<AppEnv>;

function challengeBody(c: Ctx, challenge: Challenge, now: Date) {
  const secondsUntil = (instant: Date) => Math.max(0, Math.ceil((instant.getTime() - now.getTime()) / 1000));
  return {
    challenge_id: challenge.id,
    channel: challenge.channel,
    expires_in_s: secondsUntil(challenge.expiresAt),
    resend_in_s: secondsUntil(whatsappResendAt(challenge.lastSentAt)),
    sms_in_s: c.var.deps.codes.smsAvailable ? secondsUntil(smsOfferedAt(challenge.createdAt)) : null,
  };
}

async function mobileOf(db: D1Database, personId: string | null): Promise<string | null> {
  if (personId === null) return null;
  return db
    .prepare("SELECT mobile_e164 FROM people WHERE id = ?1 AND erased_at IS NULL")
    .bind(personId)
    .first<string>("mobile_e164");
}

const login: RouteHandler<typeof loginRoute, AppEnv> = async (c) => {
  const { requestId, deps, config } = c.var;
  const { login: limits, ipHashSalt } = config.settings;
  const db = c.env.DB;
  const now = deps.now();

  const mobileE164 = toE164(c.req.valid("json").mobile);
  if (mobileE164 === null) return c.json(errorBody("invalid_request", requestId, ["mobile"]), 400);

  const visitor = await visitorOf(c);
  const gate = await codeGate(c, visitor.ipHash, now);
  if (gate === "rate_limited") return c.json(errorBody("rate_limited", requestId), 429);
  if (gate === "busy") return c.json(errorBody("busy", requestId), 503);

  const withinAddress = await takeOne(db, {
    scope: "login:code:ip",
    key: visitor.ipHash,
    window: indiaHour(now),
    limit: limits.codeIpHourlyLimit,
  });
  const withinNumber =
    withinAddress &&
    (await takeOne(db, {
      scope: "login:code:mobile",
      key: await saltedHash(ipHashSalt, `mobile:${mobileE164}`),
      window: indiaDate(now),
      limit: limits.codeMobileDailyLimit,
    }));
  if (!withinNumber) return c.json(errorBody("rate_limited", requestId), 429);

  const person = await findEligiblePerson(db, mobileE164);
  const sendsTo = person?.mobileE164 ?? null;
  if (!(await countCode(c, sendsTo, visitor.ipHash, now))) return c.json(errorBody("busy", requestId), 503);

  const code = limits.fixedCode ?? newCode();
  const challenge = await createChallenge(db, { personId: person?.id ?? null, code, pepper: limits.codePepper, now });
  await sendCodeAfterResponse(c, sendsTo, "whatsapp", code);
  return c.json(challengeBody(c, challenge, now), 202);
};

/** A fresh code on the same challenge: its wrong attempts carry on, so asking again gains a guesser nothing. */
async function sendAgain(c: Ctx, challengeId: string, channel: CodeChannel) {
  const { requestId, deps, config } = c.var;
  const db = c.env.DB;
  const now = deps.now();

  const challenge = await openChallenge(db, challengeId, now);
  if (challenge === null) return c.json(errorBody("code_expired", requestId), 410);
  const allowedAt = channel === "sms" ? smsOfferedAt(challenge.createdAt) : whatsappResendAt(challenge.lastSentAt);
  if (now < allowedAt) return c.json(errorBody("too_early", requestId), 429);
  if (challenge.sends >= MAX_SENDS_PER_CHALLENGE) return c.json(errorBody("rate_limited", requestId), 429);
  const { ipHash } = await visitorOf(c);
  const gate = await codeGate(c, ipHash, now);
  if (gate === "rate_limited") return c.json(errorBody("rate_limited", requestId), 429);
  if (gate === "busy") return c.json(errorBody("busy", requestId), 503);

  const sendsTo = await mobileOf(db, challenge.personId);
  if (!(await countCode(c, sendsTo, ipHash, now))) return c.json(errorBody("busy", requestId), 503);

  const code = config.settings.login.fixedCode ?? newCode();
  await replaceCode(db, challenge, { channel, code, pepper: config.settings.login.codePepper, now });
  await sendCodeAfterResponse(c, sendsTo, channel, code);
  const sent = { ...challenge, channel, lastSentAt: now, sends: challenge.sends + 1 };
  return c.json(challengeBody(c, sent, now), 202);
}

export function registerClientAuth(app: App): void {
  app.openapi(loginRoute, login);

  app.openapi(resendRoute, (c) => sendAgain(c, c.req.valid("json").challenge_id, "whatsapp"));

  app.openapi(smsRoute, (c) => {
    if (!c.var.deps.codes.smsAvailable) return c.json(errorBody("not_found", c.var.requestId), 404);
    return sendAgain(c, c.req.valid("json").challenge_id, "sms");
  });

  app.openapi(verifyRoute, async (c) => {
    const { requestId, deps, config, log } = c.var;
    const db = c.env.DB;
    const now = deps.now();
    const { challenge_id: challengeId, code } = c.req.valid("json");

    const verification = await verifyCode(db, { challengeId, code, pepper: config.settings.login.codePepper, now });
    if (verification.outcome === "closed") return c.json(errorBody("code_expired", requestId), 410);
    if (verification.outcome === "mismatch") {
      log.info("login_code_mismatch", { attempts_left: verification.attemptsLeft });
      return c.json({ verified: false as const, attempts_left: verification.attemptsLeft }, 200);
    }

    const name = await db
      .prepare("SELECT name FROM people WHERE id = ?1")
      .bind(verification.personId)
      .first<string>("name");
    const token = await openSession(db, {
      kind: "client",
      subjectId: verification.personId,
      deviceLabel: deviceLabel(c.req.header("User-Agent")),
      now,
    });
    setClientCookie(c, token);
    log.info("client_logged_in", { person_id: verification.personId });
    return c.json({ verified: true as const, first_name: (name ?? "").trim().split(/\s+/)[0] ?? "" }, 200);
  });

  app.openapi(logoutRoute, async (c) => {
    const session = await clientSessionOf(c);
    if (session !== null) await revokeSession(c.env.DB, session.id, c.var.deps.now());
    clearClientCookie(c);
    return c.body(null, 204);
  });
}
