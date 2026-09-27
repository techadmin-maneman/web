// Logging in to the technician app (src/policy/technician-login.ts):
//   POST /api/tech/auth/otp     a code on WhatsApp to a technician's number
//   POST /api/tech/auth/verify  the code and the phone, for a session bound to it
//   POST /api/tech/auth/logout
//   GET  /api/tech/me           who is signed in, and on which phone
//
// "Mobile number plus a one-time code, the same flow as clients but a separate
// role. A technician is recognised only if FSM lists him as an active field
// technician." A number FSM does not list gets the same answer as one it does,
// and no code opens it.
//
// The phone sends its own ID, which it keeps in its storage: the session is
// bound to it, so ops can revoke that phone and its cached jobs go with it.

import { createRoute, z } from "@hono/zod-openapi";
import type { App } from "../http/context.ts";
import { logDeactivated, syncTechnicians } from "../domain/fsm-mirror.ts";
import { takeOne } from "../domain/rate-limit.ts";
import { revokeSession, deviceLabel } from "../domain/sessions.ts";
import {
  createTechnicianChallenge,
  findFieldTechnician,
  openTechnicianSession,
  signedInTechnician,
  verifyTechnicianCode,
} from "../domain/technicians.ts";
import { errorBody, errorResponse } from "../http/errors.ts";
import { json } from "../http/openapi.ts";
import { firstNameOf, initialsOf } from "../lib/names.ts";
import { countCode, mayAskForCode, sendCodeAfterResponse } from "../http/send-code.ts";
import {
  clearTechnicianCookie,
  setTechnicianCookie,
  requireTechnicianSession,
  technicianOf,
} from "../http/technician-session.ts";
import { visitorOf } from "../http/visitor.ts";
import { INDIAN_MOBILE_PATTERN, toE164 } from "../lib/mobile.ts";
import { newLoginCode } from "../policy/one-time-code.ts";

/**
 * FSM's technicians are read for a number the mirror does not know at most once
 * in ten minutes, however many such numbers are tried: one window per ten UTC
 * minutes, "2026-09-21T06:3".
 */
function mayReadFsm(db: D1Database, now: Date): Promise<boolean> {
  return takeOne(db, { scope: "tech:fsm_read", key: "all", window: now.toISOString().slice(0, 15), limit: 1 });
}

/** The phone's own ID for itself, from its storage: never a hardware serial. */
const DeviceIdSchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]{8,64}$/)
  .openapi({ description: "The app's own ID for this phone, kept in its storage." });

const TechLoginRequestSchema = z
  .object({ mobile: z.string().regex(INDIAN_MOBILE_PATTERN), device_id: DeviceIdSchema })
  .strict()
  .openapi("TechnicianLoginRequest");

const TechChallengeSchema = z
  .object({
    challenge_id: z.uuid(),
    expires_in_s: z.number().int(),
  })
  .strict()
  .openapi("TechnicianChallenge");

const TechVerifyRequestSchema = z
  .object({ challenge_id: z.uuid(), code: z.string().regex(/^\d{6}$/), device_id: DeviceIdSchema })
  .strict()
  .openapi("TechnicianVerifyRequest");

const TechVerifySchema = z
  .discriminatedUnion("verified", [
    z.object({ verified: z.literal(true), first_name: z.string(), device_id: z.string() }).strict(),
    z.object({ verified: z.literal(false), attempts_left: z.number().int() }).strict(),
  ])
  .openapi("TechnicianVerify");

const otpRoute = createRoute({
  method: "post",
  path: "/api/tech/auth/otp",
  summary: "Send a login code on WhatsApp. The answer is the same whether or not FSM lists the number",
  request: { body: { required: true, ...json(TechLoginRequestSchema) } },
  responses: {
    202: { description: "A code is on its way, if FSM lists this number", ...json(TechChallengeSchema) },
    400: errorResponse("invalid_request"),
    429: errorResponse("rate_limited"),
    503: errorResponse("busy: today's ceiling on codes is reached"),
  },
});

const verifyRoute = createRoute({
  method: "post",
  path: "/api/tech/auth/verify",
  summary: "Check a code. The right one opens a session on this phone (the mm_tech cookie)",
  request: { body: { required: true, ...json(TechVerifyRequestSchema) } },
  responses: {
    200: { description: "Right, with a session; or wrong, with the attempts left", ...json(TechVerifySchema) },
    400: errorResponse("invalid_request"),
    410: errorResponse("code_expired: expired, used, or void after five wrong codes"),
  },
});

const logoutRoute = createRoute({
  method: "post",
  path: "/api/tech/auth/logout",
  summary: "End this session on this phone",
  responses: {
    204: { description: "Logged out" },
    401: errorResponse("session_required; device_revoked: there was no session here to end"),
  },
});

/**
 * The app asks this first, every time it opens. A 200 says the session is live
 * on this phone and names who is on it; a 401 tells an ended session from a
 * revoked phone by its code, and the app wipes what it holds either way
 * (docs/decisions/0052-technician-sessions.md).
 */
const TechMeSchema = z
  .object({
    name: z.string(),
    first_name: z.string(),
    initials: z.string().openapi({ description: "For the chip at the head of Today: the first and last initials." }),
    device: z
      .object({
        device_id: z.string().openapi({ description: "The phone's own ID, as it sent it at sign-in." }),
        label: z.union([z.string(), z.null()]).openapi({ description: "Ours, from the User-Agent at sign-in." }),
        enrolled_at: z.iso.datetime(),
      })
      .strict(),
  })
  .strict()
  .openapi("TechnicianMe");

const meRoute = createRoute({
  method: "get",
  path: "/api/tech/me",
  summary: "Who is signed in, and the phone this session is bound to",
  responses: {
    200: { description: "The signed-in technician", ...json(TechMeSchema) },
    401: errorResponse("session_required; device_revoked: ops revoked this phone, so drop the cached jobs"),
  },
});

export function registerTechAuth(app: App): void {
  app.use("/api/tech/auth/logout", requireTechnicianSession);
  app.use(meRoute.path, requireTechnicianSession);

  app.openapi(otpRoute, async (c) => {
    const { requestId, deps, config } = c.var;
    const { login: limits } = config.settings;
    const db = c.env.DB;
    const now = deps.now();

    const mobileE164 = toE164(c.req.valid("json").mobile);
    if (mobileE164 === null) return c.json(errorBody("invalid_request", requestId, ["mobile"]), 400);

    const visitor = await visitorOf(c);
    const asked = await mayAskForCode(c, { surface: "tech", mobileE164, ipHash: visitor.ipHash, now });
    if (asked === "rate_limited") return c.json(errorBody("rate_limited", requestId), 429);
    if (asked === "busy") return c.json(errorBody("busy", requestId), 503);

    // A technician FSM listed since the last sync is unknown to the mirror; read it, then look again.
    let technician = await findFieldTechnician(db, mobileE164);
    if (technician === null && config.providers.FSM_PROVIDER !== "none" && (await mayReadFsm(db, now))) {
      const deactivated = await syncTechnicians(db, deps.fsm, now.toISOString()).catch((error: unknown) => {
        c.var.log.warn("technician_sync_failed", { error });
        return [];
      });
      logDeactivated(c.var.log, deactivated);
      technician = await findFieldTechnician(db, mobileE164);
    }
    const sendsTo = technician?.mobileE164 ?? null;
    if (!(await countCode(c, sendsTo, visitor.ipHash, now))) return c.json(errorBody("busy", requestId), 503);

    const code = limits.fixedCode ?? newLoginCode();
    const challenge = await createTechnicianChallenge(db, {
      technicianId: technician?.id ?? null,
      code,
      pepper: limits.codePepper,
      now,
    });
    await sendCodeAfterResponse(c, sendsTo, "whatsapp", code);
    return c.json(
      { challenge_id: challenge.id, expires_in_s: Math.ceil((challenge.expiresAt.getTime() - now.getTime()) / 1000) },
      202,
    );
  });

  app.openapi(verifyRoute, async (c) => {
    const { requestId, deps, config, log } = c.var;
    const db = c.env.DB;
    const now = deps.now();
    const { challenge_id: challengeId, code, device_id: deviceId } = c.req.valid("json");

    const verification = await verifyTechnicianCode(db, {
      challengeId,
      code,
      pepper: config.settings.login.codePepper,
      now,
    });
    if (verification.outcome === "closed") return c.json(errorBody("code_expired", requestId), 410);
    if (verification.outcome === "mismatch") {
      log.info("technician_code_mismatch", { attempts_left: verification.attemptsLeft });
      return c.json({ verified: false as const, attempts_left: verification.attemptsLeft }, 200);
    }

    const name = await db
      .prepare("SELECT name FROM technicians WHERE id = ?1")
      .bind(verification.technicianId)
      .first<string>("name");
    const token = await openTechnicianSession(db, {
      technicianId: verification.technicianId,
      deviceId,
      label: deviceLabel(c.req.header("User-Agent")),
      now,
    });
    setTechnicianCookie(c, token);
    log.info("technician_logged_in", { technician_id: verification.technicianId, device_id: deviceId });
    return c.json({ verified: true as const, first_name: firstNameOf(name ?? ""), device_id: deviceId }, 200);
  });

  app.openapi(logoutRoute, async (c) => {
    const session = technicianOf(c);
    await revokeSession(c.env.DB, session.sessionId, c.var.deps.now());
    clearTechnicianCookie(c);
    return c.body(null, 204);
  });

  app.openapi(meRoute, async (c) => {
    const { technicianId, deviceRowId } = technicianOf(c);
    const signedIn = await signedInTechnician(c.env.DB, { technicianId, deviceRowId });
    // The middleware found the device, so this is a technician deleted between the two reads.
    if (signedIn === null) return c.json(errorBody("session_required", c.var.requestId), 401);
    return c.json(
      {
        name: signedIn.name,
        first_name: firstNameOf(signedIn.name),
        initials: initialsOf(signedIn.name),
        device: { device_id: signedIn.deviceId, label: signedIn.label, enrolled_at: signedIn.enrolledAt },
      },
      200,
    );
  });
}
