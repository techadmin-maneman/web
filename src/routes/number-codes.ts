// A WhatsApp code that proves a number typed into the site before a form acts on it: /book's consultation and fit
// in one visit, and /try's gate (src/policy/number-proof.ts).
//
//   POST /api/number-code          a code on WhatsApp to the number
//   POST /api/number-code/verify   the code, which proves the number for 30 minutes
//
// The code goes to whatever number is typed, so asking for one needs Turnstile and counts against the number's day
// and the address's hour, as a login code does, and against a day's ceiling of its own, so that codes asked for
// here never stop clients and technicians signing in.

import { createRoute, z, type RouteHandler } from "@hono/zod-openapi";
import type { App, AppEnv } from "../http/context.ts";
import { checkNumberCode, createNumberCode, mobileHashOf } from "../domain/number-codes.ts";
import { errorBody, errorResponse } from "../http/errors.ts";
import { json } from "../http/openapi.ts";
import { countCode, knownCode, mayAskForCode, sendCodeAfterResponse } from "../http/send-code.ts";
import { checkTurnstile, visitorOf } from "../http/visitor.ts";
import { toE164 } from "../lib/mobile.ts";
import { newLoginCode } from "../policy/one-time-code.ts";

const NumberCodeRequestSchema = z
  .object({
    mobile: z.string().max(20),
    name: z.string().trim().min(1).max(80).openapi({ description: "The name typed beside the number." }),
    turnstile_token: z.string().min(1).max(2048),
  })
  .strict()
  .openapi("NumberCodeRequest");

const NumberCodeSchema = z
  .object({ code_id: z.uuid() })
  .strict()
  .openapi("NumberCode", { description: "The code is on its way to the number on WhatsApp." });

const VerifyRequestSchema = z
  .object({ code_id: z.uuid(), code: z.string().regex(/^\d{6}$/) })
  .strict()
  .openapi("NumberCodeVerifyRequest");

export const NumberCodeVerifySchema = z
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

const ask: RouteHandler<typeof askRoute, AppEnv> = async (c) => {
  const body = c.req.valid("json");
  const { requestId, deps, config } = c.var;
  const { login, ipHashSalt } = config.settings;
  // Codes are hashed under the pepper; an environment without one proves no number.
  if (login.codePepper === "") return c.json(errorBody("unavailable", requestId), 503);

  const mobileE164 = toE164(body.mobile);
  if (mobileE164 === null) return c.json(errorBody("invalid_request", requestId, ["mobile"]), 400);
  const visitor = await visitorOf(c);
  const turnstile = await checkTurnstile(c, body.turnstile_token, visitor);
  if (turnstile === "rejected") return c.json(errorBody("turnstile_failed", requestId), 403);
  if (turnstile === "unavailable") return c.json(errorBody("unavailable", requestId), 503);

  const now = deps.now();
  const { ipHash } = visitor;
  const asked = await mayAskForCode(c, { surface: "form", mobileE164, ipHash, now, name: body.name });
  if (asked === "rate_limited") return c.json(errorBody("rate_limited", requestId), 429);
  if (asked === "busy") return c.json(errorBody("busy", requestId), 503);
  const counted = await countCode(c, mobileE164, body.name, ipHash, now, "form_code");
  if (!counted) return c.json(errorBody("busy", requestId), 503);

  const code = knownCode(login, body.name) ?? newLoginCode();
  const mobileHash = await mobileHashOf(ipHashSalt, mobileE164);
  const codeId = await createNumberCode(c.env.DB, { mobileHash, code, pepper: login.codePepper, now });
  await sendCodeAfterResponse(c, mobileE164, body.name, "whatsapp", code);
  return c.json({ code_id: codeId }, 202);
};

const verify: RouteHandler<typeof verifyRoute, AppEnv> = async (c) => {
  const { code_id: id, code } = c.req.valid("json");
  const { requestId, deps, config, log } = c.var;
  const pepper = config.settings.login.codePepper;

  const checked = await checkNumberCode(c.env.DB, { id, code, pepper, now: deps.now() });
  if (checked.outcome === "closed") return c.json(errorBody("code_expired", requestId), 410);
  if (checked.outcome === "mismatch") {
    log.info("number_code_mismatch", { attempts_left: checked.attemptsLeft });
    return c.json({ verified: false as const, attempts_left: checked.attemptsLeft }, 200);
  }
  log.info("number_proved", { code_id: id });
  return c.json({ verified: true as const }, 200);
};

export function registerNumberCodes(app: App): void {
  app.openapi(askRoute, ask);
  app.openapi(verifyRoute, verify);
}
