// A number change (./profile.ts): a code to each number, one number's code checked, and the change withdrawn before
// ops decide. Each step is audited as it is made; the change itself comes with ops' decision
// (src/routes/ops/profile.ts).

import { z } from "@hono/zod-openapi";
import {
  openNumberChange,
  startNumberChange,
  verifyNumberChange,
  withdrawNumberChange,
} from "../../domain/clients/number-change.ts";
import { liveContact } from "../../domain/clients/profile.ts";
import { takeOne } from "../../domain/sign-in/rate-limit.ts";
import { clientAudit } from "../../http/audit.ts";
import { clientOf } from "../../http/client-session.ts";
import type { App } from "../../http/context.ts";
import { errorResponse, refuse } from "../../http/errors.ts";
import { json } from "../../http/openapi.ts";
import { numberChangeCodes, sendCodeAfterResponse, withinCodeCeiling } from "../../http/send-code.ts";
import { clientRoute, signedIn } from "../../http/session-routes.ts";
import { INDIAN_MOBILE_PATTERN, toE164 } from "../../lib/mobile.ts";
import { CODE_TEXT } from "../../policy/one-time-code.ts";
import { NumberChangeSchema, numberChangeBody } from "../schemas/number-change.ts";

const numberChangeRoute = clientRoute({
  method: "post",
  path: "/api/number-change",
  summary: "Start a number change: a code goes to both numbers. Starting again withdraws the last one",
  request: {
    body: {
      required: true,
      ...json(
        z
          .object({ new_mobile: z.string().regex(INDIAN_MOBILE_PATTERN) })
          .strict()
          .openapi("NumberChangeStart"),
      ),
    },
  },
  responses: {
    202: {
      description: "Codes on their way to both numbers",
      ...json(z.object({ request_id: z.uuid(), expires_in_s: z.number().int() }).strict()),
    },
    400: errorResponse("invalid_request: not an Indian mobile number, or the number already in use here"),
    429: errorResponse("rate_limited: three changes a day"),
    503: errorResponse("busy"),
    ...signedIn,
  },
});

const numberChangeWithdrawRoute = clientRoute({
  method: "delete",
  path: "/api/number-change",
  summary: "Withdraw the number change under way, before ops decide it. With none under way, nothing happens",
  responses: { 204: { description: "Withdrawn, or there was none" }, ...signedIn },
});

const numberChangeVerifyRoute = clientRoute({
  method: "post",
  path: "/api/number-change/verify",
  summary: "One number's code. With both numbers proven, the change waits for ops to confirm",
  request: {
    body: {
      required: true,
      ...json(
        z
          .object({ request_id: z.uuid(), number: z.enum(["old", "new"]), code: z.string().regex(CODE_TEXT) })
          .strict()
          .openapi("NumberChangeVerify"),
      ),
    },
  },
  responses: {
    200: {
      description: "Checked. attempts_left is null when the code was right",
      ...json(NumberChangeSchema.extend({ attempts_left: z.number().int().nullable() }).strict()),
    },
    410: errorResponse("code_expired: the code or the change is closed; start again"),
    ...signedIn,
  },
});

export function registerClientNumberChange(app: App): void {
  app.openapi(numberChangeRoute, async (c) => {
    const { requestId, deps, config } = c.var;
    const personId = clientOf(c).subjectId;
    const db = c.env.DB;
    const now = deps.now();

    const newMobile = toE164(c.req.valid("json").new_mobile);
    // A live session's person is never erased: the erasure ends their sessions.
    const contact = await liveContact(db, personId);
    const current = contact?.mobileE164 ?? null;
    if (newMobile === null || newMobile === current) return refuse(c, "invalid_request", ["new_mobile"]);

    const allowed = await takeOne(db, "number_change:person", personId, { now, settings: config.settings });
    if (!allowed) return refuse(c, "rate_limited");
    if (!(await withinCodeCeiling(c, now)) || !(await withinCodeCeiling(c, now))) {
      return refuse(c, "busy");
    }

    const testRecord = contact?.testRecord ?? false;
    const started = await startNumberChange(db, {
      personId,
      sessionId: clientOf(c).id,
      newMobileE164: newMobile,
      pepper: config.settings.login.codePepper,
      audit: clientAudit(personId, requestId, { action: "number_change.request" }),
      now,
      knownCodes: numberChangeCodes(config.settings.login, testRecord),
    });
    await sendCodeAfterResponse({
      c,
      mobileE164: current,
      testRecord,
      channel: "whatsapp",
      code: started.codes.old.code,
    });
    await sendCodeAfterResponse({
      c,
      mobileE164: newMobile,
      testRecord,
      channel: "whatsapp",
      code: started.codes.new.code,
    });
    const expiresIn = Math.round((started.codes.new.challenge.expiresAt.getTime() - now.getTime()) / 1000);
    return c.json({ request_id: started.change.id, expires_in_s: expiresIn }, 202);
  });

  app.openapi(numberChangeWithdrawRoute, async (c) => {
    const personId = clientOf(c).subjectId;
    await withdrawNumberChange(c.env.DB, {
      personId,
      audit: clientAudit(personId, c.var.requestId, { action: "number_change.withdraw" }),
      now: c.var.deps.now(),
    });
    return c.body(null, 204);
  });

  app.openapi(numberChangeVerifyRoute, async (c) => {
    const { deps, config } = c.var;
    const personId = clientOf(c).subjectId;
    const { request_id: id, number, code } = c.req.valid("json");
    const change = await openNumberChange(c.env.DB, personId);
    if (change?.id !== id) return refuse(c, "code_expired");

    const result = await verifyNumberChange(c.env.DB, {
      change,
      which: number,
      code,
      pepper: config.settings.login.codePepper,
      now: deps.now(),
    });
    if (result.verification.outcome === "closed") return refuse(c, "code_expired");
    const attemptsLeft = result.verification.outcome === "mismatch" ? result.verification.attemptsLeft : null;
    return c.json({ ...numberChangeBody(result.change), attempts_left: attemptsLeft }, 200);
  });
}
