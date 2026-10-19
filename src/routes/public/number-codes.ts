// A WhatsApp code that proves a number typed into the site before a form acts on it: /book's consultation and fit
// in one visit, and /try's gate (src/policy/number-proof.ts).
//
// The code goes to whatever number is typed, so asking for one needs Turnstile and counts against the number's day
// and the address's hour, as a login code does, and against a day's ceiling of its own, so that codes asked for
// here never stop clients and technicians signing in.
//
// A number proved here that a booking holds may also be signed in to the client app, so a visitor who has just
// booked goes on into it: the app finishes the sign-in with the challenge and code this answers (ADR 0214).

import { createRoute, z, type RouteHandler } from "@hono/zod-openapi";
import type { App, AppEnv } from "../../http/context.ts";
import { checkNumberCode, createNumberCode, mobileHashOf } from "../../domain/clients/number-codes.ts";
import { findEligiblePerson } from "../../domain/sign-in/login.ts";
import { createChallenge } from "../../domain/sign-in/one-time-codes.ts";
import { provedNumber } from "../../http/number-proof.ts";
import { errorResponse, refuse } from "../../http/errors.ts";
import { json, PersonNameSchema } from "../../http/openapi.ts";
import { countCode, knownCode, mayAskForCode, sendCodeAfterResponse } from "../../http/send-code.ts";
import { checkTurnstile, visitorOf } from "../../http/visitor.ts";
import { isTestNumber } from "../../domain/platform/test-records.ts";
import { toE164 } from "../../lib/mobile.ts";
import { CODE_TEXT, newLoginCode } from "../../policy/one-time-code.ts";

const NumberCodeRequestSchema = z
  .object({
    mobile: z.string().max(20),
    name: PersonNameSchema,
    turnstile_token: z.string().min(1).max(2048),
  })
  .strict()
  .openapi("NumberCodeRequest");

const NumberCodeSchema = z
  .object({ code_id: z.uuid() })
  .strict()
  .openapi("NumberCode", { description: "The code is on its way to the number on WhatsApp." });

const VerifyRequestSchema = z
  .object({ code_id: z.uuid(), code: z.string().regex(CODE_TEXT) })
  .strict()
  .openapi("NumberCodeVerifyRequest");

const NumberCodeVerifySchema = z
  .discriminatedUnion("verified", [
    z.object({ verified: z.literal(true) }).strict(),
    z
      .object({
        verified: z.literal(false),
        attempts_left: z.number().int().openapi({ description: "0 means the code is now void." }),
      })
      .strict(),
  ])
  .openapi("NumberCodeVerify");

/** The ID of a code that proved the number, which /book's one visit and /try's gate need. */
export const NumberCodeIdSchema = z.uuid().openapi({
  description:
    "The code that proved the number (POST /api/number-code/verify). It proves it for 30 minutes after it was entered.",
});

const SignInRequestSchema = z
  .object({ code_id: NumberCodeIdSchema, mobile: z.string().max(20) })
  .strict()
  .openapi("NumberSignInRequest");

const NumberSignInSchema = z
  .object({
    challenge_id: z.uuid(),
    code: z.string().regex(CODE_TEXT),
  })
  .strict()
  .openapi("NumberSignIn", {
    description: "A sign-in the client app finishes once, within ten minutes, at POST /api/auth/verify.",
  });

const askRoute = createRoute({
  method: "post",
  path: "/api/number-code",
  summary: "Send a code on WhatsApp to prove a number typed into the site",
  request: { body: { required: true, ...json(NumberCodeRequestSchema) } },
  responses: {
    202: { description: "The code is on its way", ...json(NumberCodeSchema) },
    400: errorResponse("invalid_request"),
    403: errorResponse("turnstile_failed"),
    429: errorResponse("rate_limited: too many codes for this number today, or from this address this hour"),
    503: errorResponse("busy: today's ceiling on codes is reached; unavailable: Turnstile could not be reached"),
  },
});

const verifyRoute = createRoute({
  method: "post",
  path: "/api/number-code/verify",
  summary: "Check a code. The right one proves its number for 30 minutes",
  request: { body: { required: true, ...json(VerifyRequestSchema) } },
  responses: {
    200: { description: "Right; or wrong, with the attempts left", ...json(NumberCodeVerifySchema) },
    400: errorResponse("invalid_request"),
    410: errorResponse("code_expired: expired, already entered, or void after five wrong codes"),
  },
});

const signInRoute = createRoute({
  method: "post",
  path: "/api/number-code/sign-in",
  summary: "Sign a number proved here in to the client app, once a booking holds it",
  request: { body: { required: true, ...json(SignInRequestSchema) } },
  responses: {
    201: { description: "The sign-in, for the app to finish", ...json(NumberSignInSchema) },
    400: errorResponse("invalid_request"),
    403: errorResponse("number_not_proved: the code did not prove this number, or proved it over 30 minutes ago"),
    404: errorResponse("not_found: no booking holds the number"),
    503: errorResponse("unavailable: this environment proves no number"),
  },
});

const ask: RouteHandler<typeof askRoute, AppEnv> = async (c) => {
  const body = c.req.valid("json");
  const { deps, config } = c.var;
  const { login, ipHashSalt } = config.settings;
  // Codes are hashed under the pepper; an environment without one proves no number.
  if (login.codePepper === "") return refuse(c, "unavailable");

  const mobileE164 = toE164(body.mobile);
  if (mobileE164 === null) return refuse(c, "invalid_request", ["mobile"]);
  const visitor = await visitorOf(c);
  const turnstile = await checkTurnstile(c, body.turnstile_token, visitor);
  if (turnstile === "rejected") return refuse(c, "turnstile_failed");
  if (turnstile === "unavailable") return refuse(c, "unavailable");

  const now = deps.now();
  const mobileHash = await mobileHashOf(ipHashSalt, mobileE164);
  const testRecord = await isTestNumber(c.env.DB, c.var.config.environment, mobileE164, body.name);
  const asked = await mayAskForCode(c, { surface: "form", mobileHash, ipHash: visitor.ipHash, now, testRecord });
  if (asked === "busy") return refuse(c, "busy");
  if (asked !== "open") return refuse(c, "rate_limited");
  const counted = await countCode({ c, surface: "form", sendsTo: mobileE164, testRecord, now });
  if (!counted) return refuse(c, "busy");

  const code = knownCode({ login, testRecord }) ?? newLoginCode();
  const codeId = await createNumberCode(c.env.DB, { mobileHash, code, pepper: login.codePepper, now });
  await sendCodeAfterResponse({ c, mobileE164, testRecord, channel: "whatsapp", code });
  return c.json({ code_id: codeId }, 202);
};

const verify: RouteHandler<typeof verifyRoute, AppEnv> = async (c) => {
  const { code_id: id, code } = c.req.valid("json");
  const { deps, config, log } = c.var;
  const pepper = config.settings.login.codePepper;

  const checked = await checkNumberCode(c.env.DB, { id, code, pepper, now: deps.now() });
  if (checked.outcome === "closed") return refuse(c, "code_expired");
  if (checked.outcome === "mismatch") {
    log.info("number_code_mismatch", { attempts_left: checked.attemptsLeft });
    return c.json({ verified: false as const, attempts_left: checked.attemptsLeft }, 200);
  }
  log.info("number_proved", { code_id: id });
  return c.json({ verified: true as const }, 200);
};

/** The number proved: a sign-in to the app for whoever its booking is, with no message sent. */
const signIn: RouteHandler<typeof signInRoute, AppEnv> = async (c) => {
  const { code_id: codeId, mobile } = c.req.valid("json");
  const { login, ipHashSalt } = c.var.config.settings;
  if (login.codePepper === "") return refuse(c, "unavailable");
  const mobileE164 = toE164(mobile);
  if (mobileE164 === null) return refuse(c, "invalid_request", ["mobile"]);
  if (!(await provedNumber(c, codeId, mobileE164))) return refuse(c, "number_not_proved");
  const person = await findEligiblePerson(c.env.DB, mobileE164);
  if (person === null) return refuse(c, "not_found");

  const code = newLoginCode();
  const challenge = await createChallenge(c.env.DB, {
    holder: "person",
    holderId: person.id,
    mobileHash: await mobileHashOf(ipHashSalt, mobileE164),
    code,
    pepper: login.codePepper,
    now: c.var.deps.now(),
  });
  c.var.log.info("app_sign_in_handed_over", { person_id: person.id });
  return c.json({ challenge_id: challenge.id, code }, 201);
};

export function registerNumberCodes(app: App): void {
  app.openapi(askRoute, ask);
  app.openapi(verifyRoute, verify);
  app.openapi(signInRoute, signIn);
}
