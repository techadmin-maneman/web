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
// Asking for a code needs Turnstile, which the app renders invisibly.

import { createRoute, z, type RouteHandler } from "@hono/zod-openapi";
import type { Context } from "hono";
import type { App, AppEnv } from "../../http/context.ts";
import { findEligiblePerson, openChallenge, replaceCode, verifyCode } from "../../domain/login.ts";
import { mobileHashOf } from "../../domain/number-codes.ts";
import { createChallenge, type Challenge } from "../../domain/one-time-codes.ts";
import { liveContact } from "../../domain/profile.ts";
import { deviceLabel, openSession, revokeSession } from "../../domain/sessions.ts";
import { clearClientCookie, clientSessionOf, setClientCookie } from "../../http/client-session.ts";
import { errorResponse, refuse } from "../../http/errors.ts";
import { json } from "../../http/openapi.ts";
import { countCode, knownCode, mayAskForCode, sendCodeAfterResponse } from "../../http/send-code.ts";
import { checkTurnstile, visitorOf } from "../../http/visitor.ts";
import { INDIAN_MOBILE_PATTERN, toE164 } from "../../lib/mobile.ts";
import {
  CODE_TEXT,
  MAX_SENDS_PER_CHALLENGE,
  newLoginCode,
  smsOfferedAt,
  whatsappResendAt,
} from "../../policy/one-time-code.ts";
import type { CodeChannel } from "../../providers/codes.ts";
import { firstNameOf } from "../../lib/names.ts";

const LoginChallengeSchema = z
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

const LoginRequestSchema = z
  .object({
    mobile: z.string().regex(INDIAN_MOBILE_PATTERN).openapi({ example: "98100 00000" }),
    turnstile_token: z.string().min(1).max(2048),
  })
  .strict()
  .openapi("LoginRequest");
const ChallengeRequestSchema = z.object({ challenge_id: z.uuid() }).strict().openapi("LoginChallengeRequest");
const VerifyRequestSchema = z
  .object({ challenge_id: z.uuid(), code: z.string().regex(CODE_TEXT) })
  .strict()
  .openapi("LoginVerifyRequest");

const LoginVerifySchema = z
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

const challengeAnswer = {
  description: "A code is on its way, if this number has a booking",
  ...json(LoginChallengeSchema),
};

const loginRoute = createRoute({
  method: "post",
  path: "/api/auth/otp",
  summary: "Send a login code on WhatsApp. The answer is the same whether or not the number has a booking",
  request: { body: { required: true, ...json(LoginRequestSchema) } },
  responses: {
    202: challengeAnswer,
    400: errorResponse("invalid_request"),
    403: errorResponse("turnstile_failed"),
    429: errorResponse("rate_limited: too many codes for this number today, or from this address this hour"),
    503: errorResponse("busy: today's ceiling on codes is reached; unavailable: Turnstile could not be reached"),
  },
});

/** Each code sent again counts against the number's day and the address's hour, as a first one does. */
const SENT_AGAIN_REFUSED =
  `too_early; or rate_limited: this challenge has sent its ${String(MAX_SENDS_PER_CHALLENGE)} codes, or too many ` +
  "codes for this number today, or from this address this hour";

const resendRoute = createRoute({
  method: "post",
  path: "/api/auth/otp/resend",
  summary: "Send a fresh code on WhatsApp, 30 seconds after the last one",
  request: { body: { required: true, ...json(ChallengeRequestSchema) } },
  responses: {
    202: challengeAnswer,
    400: errorResponse("invalid_request"),
    410: errorResponse("code_expired: start again"),
    429: errorResponse(SENT_AGAIN_REFUSED),
    503: errorResponse("busy"),
  },
});

const smsRoute = createRoute({
  method: "post",
  path: "/api/auth/otp/sms",
  summary: "Send a fresh code by SMS instead, 30 seconds after the first",
  request: { body: { required: true, ...json(ChallengeRequestSchema) } },
  responses: {
    202: challengeAnswer,
    400: errorResponse("invalid_request"),
    404: errorResponse("not_found: SMS is not available"),
    410: errorResponse("code_expired: start again"),
    429: errorResponse(SENT_AGAIN_REFUSED),
    503: errorResponse("busy"),
  },
});

const verifyRoute = createRoute({
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

const logoutRoute = createRoute({
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

async function contactOf(
  db: D1Database,
  personId: string | null,
): Promise<{ mobileE164: string; name: string; testRecord: boolean } | null> {
  if (personId === null) return null;
  return liveContact(db, personId);
}

const login: RouteHandler<typeof loginRoute, AppEnv> = async (c) => {
  const { deps, config } = c.var;
  const { login: limits, ipHashSalt } = config.settings;
  const db = c.env.DB;
  const now = deps.now();

  const body = c.req.valid("json");
  const mobileE164 = toE164(body.mobile);
  if (mobileE164 === null) return refuse(c, "invalid_request", ["mobile"]);
  const visitor = await visitorOf(c);
  const turnstile = await checkTurnstile(c, body.turnstile_token, visitor);
  if (turnstile === "rejected") return refuse(c, "turnstile_failed");
  if (turnstile === "unavailable") return refuse(c, "unavailable");

  const person = await findEligiblePerson(db, mobileE164);
  const sendsTo = person?.mobileE164 ?? null;
  const testRecord = person?.testRecord ?? false;
  const mobileHash = await mobileHashOf(ipHashSalt, mobileE164);
  const asked = await mayAskForCode(c, { surface: "login", mobileHash, ipHash: visitor.ipHash, now, testRecord });
  if (asked === "busy") return refuse(c, "busy");
  if (asked !== "open") return refuse(c, "rate_limited");

  if (!(await countCode(c, "login", sendsTo, testRecord, now))) return refuse(c, "busy");

  const code = knownCode(limits, testRecord) ?? newLoginCode();
  const challenge = await createChallenge(db, {
    holder: "person",
    holderId: person?.id ?? null,
    mobileHash,
    code,
    pepper: limits.codePepper,
    now,
  });
  await sendCodeAfterResponse(c, sendsTo, testRecord, "whatsapp", code);
  return c.json(challengeBody(c, challenge, now), 202);
};

/**
 * A fresh code on the same challenge: its wrong attempts carry on, so asking again gains a guesser nothing, and it
 * counts against the number's day and the address's hour like a first code, whoever holds the number.
 */
async function sendAgain(c: Ctx, challengeId: string, channel: CodeChannel) {
  const { deps, config } = c.var;
  const db = c.env.DB;
  const now = deps.now();

  const challenge = await openChallenge(db, challengeId, now);
  if (challenge === null) return refuse(c, "code_expired");
  const allowedAt = channel === "sms" ? smsOfferedAt(challenge.createdAt) : whatsappResendAt(challenge.lastSentAt);
  if (now < allowedAt) return refuse(c, "too_early");
  if (challenge.sends >= MAX_SENDS_PER_CHALLENGE) return refuse(c, "rate_limited");
  // A challenge that does not keep its number cannot count a code against it, so the client starts again.
  if (challenge.mobileHash === null) return refuse(c, "code_expired");

  const contact = await contactOf(db, challenge.holderId);
  const sendsTo = contact?.mobileE164 ?? null;
  const testRecord = contact?.testRecord ?? false;
  const { ipHash } = await visitorOf(c);
  const asked = await mayAskForCode(c, { surface: "login", mobileHash: challenge.mobileHash, ipHash, now, testRecord });
  if (asked === "busy") return refuse(c, "busy");
  if (asked !== "open") return refuse(c, "rate_limited");

  if (!(await countCode(c, "login", sendsTo, testRecord, now))) return refuse(c, "busy");

  const code = knownCode(config.settings.login, testRecord) ?? newLoginCode();
  await replaceCode(db, challenge, { channel, code, pepper: config.settings.login.codePepper, now });
  await sendCodeAfterResponse(c, sendsTo, testRecord, channel, code);
  const sent = { ...challenge, channel, lastSentAt: now, sends: challenge.sends + 1 };
  return c.json(challengeBody(c, sent, now), 202);
}

export function registerClientAuth(app: App): void {
  app.openapi(loginRoute, login);

  app.openapi(resendRoute, (c) => sendAgain(c, c.req.valid("json").challenge_id, "whatsapp"));

  app.openapi(smsRoute, (c) => {
    if (!c.var.deps.codes.smsAvailable) return refuse(c, "not_found");
    return sendAgain(c, c.req.valid("json").challenge_id, "sms");
  });

  app.openapi(verifyRoute, async (c) => {
    const { deps, config, log } = c.var;
    const db = c.env.DB;
    const now = deps.now();
    const { challenge_id: challengeId, code } = c.req.valid("json");

    const verification = await verifyCode(db, { challengeId, code, pepper: config.settings.login.codePepper, now });
    if (verification.outcome === "closed") return refuse(c, "code_expired");
    if (verification.outcome === "mismatch") {
      log.info("login_code_mismatch", { attempts_left: verification.attemptsLeft });
      return c.json({ verified: false as const, attempts_left: verification.attemptsLeft }, 200);
    }

    // A code that verifies is never an erased person's: the erasure voids their codes.
    const name = (await liveContact(db, verification.personId))?.name;
    const token = await openSession(db, {
      kind: "client",
      subjectId: verification.personId,
      deviceLabel: deviceLabel(c.req.header("User-Agent")),
      now,
    });
    setClientCookie(c, token);
    log.info("client_logged_in", { person_id: verification.personId });
    return c.json({ verified: true as const, first_name: firstNameOf(name ?? "") }, 200);
  });

  app.openapi(logoutRoute, async (c) => {
    const session = await clientSessionOf(c);
    if (session !== null) await revokeSession(c.env.DB, session.id, c.var.deps.now());
    clearClientCookie(c);
    return c.body(null, 204);
  });
}
