// Logging in to the technician app (src/domain/dispatch/technicians.ts).
//
// "Mobile number plus a one-time code, the same flow as clients but a separate
// role." A technician is recognised only while ops have them switched on. A
// number that is not their gets the same answer as one that is, and no code
// opens it.
//
// The phone sends its own ID, which it keeps in its storage: the session is
// bound to it, so ops can revoke that phone and its cached jobs go with it.
//
// Technicians' codes have a day's ceiling of their own, so client traffic never
// stops one signing in, and ops are told when an active technician is refused.

import { techRoute } from "../../http/session-routes.ts";
import { createRoute, z } from "@hono/zod-openapi";
import type { Context } from "hono";
import type { LoginSettings } from "../../config/settings.ts";
import type { App, AppEnv } from "../../http/context.ts";
import { mobileHashOf } from "../../domain/clients/number-codes.ts";
import { createChallenge } from "../../domain/sign-in/one-time-codes.ts";
import { revokeSession, deviceLabel } from "../../domain/sign-in/sessions.ts";
import {
  findFieldTechnician,
  openTechnicianSession,
  signedInTechnician,
  verifyTechnicianCode,
} from "../../domain/dispatch/technicians.ts";
import { errorResponse, refuse } from "../../http/errors.ts";
import { json } from "../../http/openapi.ts";
import { firstNameOf, initialsOf } from "../../lib/names.ts";
import { afterResponse } from "../../http/after-response.ts";
import { countCode, knownCode, mayAskForCode, sendCodeAfterResponse, type CodeGate } from "../../http/send-code.ts";
import { clearTechnicianCookie, setTechnicianCookie, technicianOf } from "../../http/technician-session.ts";
import { visitorOf } from "../../http/visitor.ts";
import { INDIAN_MOBILE_PATTERN, toE164 } from "../../lib/mobile.ts";
import { CODE_TEXT, newLoginCode, whatsappResendAt } from "../../policy/one-time-code.ts";
import { ALERT_WORDS } from "../../config/alert-words.ts";

/** Why an active technician was refused a code, and what they can do, in ops' words. */
function refusalReason(refusal: Exclude<CodeGate, "open">, login: LoginSettings): string {
  if (refusal === "number_spent") {
    return (
      `their number has had its ${String(login.codeMobileDailyLimit)} codes for today. If they asked for them, give them ` +
      "back on their Phones tab to let them sign in now. If not, someone else is asking for codes for their number."
    );
  }
  if (refusal === "address_spent") {
    return (
      `their network has asked for ${String(login.codeIpHourlyLimit)} codes this hour. They can sign in on mobile data ` +
      "now, or on this network from the next hour."
    );
  }
  return (
    `today's ${String(login.techCodeDailyCeiling)} technician login codes are spent, so no technician can sign in ` +
    "on a new phone until midnight IST."
  );
}

/**
 * Ops' alert that an active technician was refused a code: raised when they are, and closed once they are given one.
 * Kept after the response, so a technician's number is answered no slower than anyone else's.
 */
async function keepRefusalAlert(
  c: Context<AppEnv>,
  technician: { readonly id: string; readonly name: string },
  asked: CodeGate,
): Promise<void> {
  const { deps, log, config } = c.var;
  const key = `technician_code_refused:${technician.id}`;
  const work =
    asked === "open"
      ? deps.resolveAlert(key)
      : deps.alertOnce({
          key,
          message: ALERT_WORDS.technician_code_refused({
            technician: technician.name,
            reason: refusalReason(asked, config.settings.login),
          }),
          link: `/technicians/${technician.id}/phones`,
        });
  await afterResponse(
    c,
    work.catch((error: unknown) => {
      log.error("technician_refusal_alert_error", { error });
    }),
  );
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
    resend_in_s: z.number().int().openapi({ description: "Seconds until a new code may be asked for." }),
  })
  .strict()
  .openapi("TechnicianChallenge");

const TechVerifyRequestSchema = z
  .object({ challenge_id: z.uuid(), code: z.string().regex(CODE_TEXT), device_id: DeviceIdSchema })
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
  summary: "Send a login code on WhatsApp. The answer is the same whether or not the number is a technician's",
  request: { body: { required: true, ...json(TechLoginRequestSchema) } },
  responses: {
    202: { description: "A code is on its way, if the number is a technician's", ...json(TechChallengeSchema) },
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
    403: errorResponse("sign_in_stopped: ops revoked a phone of theirs, and have not yet let them sign in again"),
    410: errorResponse("code_expired: expired, used, or void after five wrong codes"),
  },
});

const logoutRoute = techRoute({
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
    id: z.uuid().openapi({ description: "Whose work the phone holds: it keeps work it set aside only for them." }),
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

const meRoute = techRoute({
  method: "get",
  path: "/api/tech/me",
  summary: "Who is signed in, and the phone this session is bound to",
  responses: {
    200: { description: "The signed-in technician", ...json(TechMeSchema) },
    401: errorResponse(
      "session_required; device_revoked: ops revoked this phone, so drop the cached jobs; technician_inactive: ops " +
        "switched them off, so drop the cards and set aside the work not yet sent",
    ),
  },
});

export function registerTechAuth(app: App): void {
  app.openapi(otpRoute, async (c) => {
    const { deps, config } = c.var;
    const { login: limits, ipHashSalt } = config.settings;
    const db = c.env.DB;
    const now = deps.now();

    const mobileE164 = toE164(c.req.valid("json").mobile);
    if (mobileE164 === null) return refuse(c, "invalid_request", ["mobile"]);

    const visitor = await visitorOf(c);
    const technician = await findFieldTechnician(db, mobileE164);
    // Marked when they were added, never read from a name a rename could give (src/policy/staging-test-records.ts).
    const testRecord = technician?.testRecord ?? false;
    const mobileHash = await mobileHashOf(ipHashSalt, mobileE164);
    const asked = await mayAskForCode(c, { surface: "tech", mobileHash, ipHash: visitor.ipHash, now, testRecord });
    if (technician !== null) await keepRefusalAlert(c, technician, asked);
    if (asked === "busy") return refuse(c, "busy");
    if (asked !== "open") return refuse(c, "rate_limited");

    const sendsTo = technician?.mobileE164 ?? null;
    if (!(await countCode({ c, surface: "tech", sendsTo, testRecord, now }))) return refuse(c, "busy");

    const code = knownCode({ login: limits, testRecord }) ?? newLoginCode();
    const challenge = await createChallenge(db, {
      holder: "technician",
      holderId: technician?.id ?? null,
      code,
      pepper: limits.codePepper,
      now,
    });
    await sendCodeAfterResponse({ c, mobileE164: sendsTo, testRecord, channel: "whatsapp", code });
    const secondsUntil = (instant: Date) => Math.max(0, Math.ceil((instant.getTime() - now.getTime()) / 1000));
    return c.json(
      {
        challenge_id: challenge.id,
        expires_in_s: secondsUntil(challenge.expiresAt),
        resend_in_s: secondsUntil(whatsappResendAt(challenge.lastSentAt)),
      },
      202,
    );
  });

  app.openapi(verifyRoute, async (c) => {
    const { deps, config, log } = c.var;
    const db = c.env.DB;
    const now = deps.now();
    const { challenge_id: challengeId, code, device_id: deviceId } = c.req.valid("json");

    const verification = await verifyTechnicianCode(db, {
      challengeId,
      code,
      pepper: config.settings.login.codePepper,
      now,
    });
    if (verification.outcome === "closed") return refuse(c, "code_expired");
    if (verification.outcome === "mismatch") {
      log.info("technician_code_mismatch", { attempts_left: verification.attemptsLeft });
      return c.json({ verified: false as const, attempts_left: verification.attemptsLeft }, 200);
    }

    const technician = await db
      .prepare("SELECT name, sign_in_stopped_at FROM technicians WHERE id = ?1")
      .bind(verification.technicianId)
      .first<{ name: string; sign_in_stopped_at: string | null }>();
    // A revoke sticks: the code reaches whoever has their WhatsApp, a lost phone included.
    if (technician !== null && technician.sign_in_stopped_at !== null) {
      log.warn("technician_sign_in_stopped", { technician_id: verification.technicianId });
      return refuse(c, "sign_in_stopped");
    }
    const name = technician?.name ?? null;
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

  registerTechSession(app);
}

/** The technician signed in: signing out, and who they are. */
function registerTechSession(app: App): void {
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
    if (signedIn === null) return refuse(c, "session_required");
    return c.json(
      {
        id: technicianId,
        name: signedIn.name,
        first_name: firstNameOf(signedIn.name),
        initials: initialsOf(signedIn.name),
        device: { device_id: signedIn.deviceId, label: signedIn.label, enrolled_at: signedIn.enrolledAt },
      },
      200,
    );
  });
}
