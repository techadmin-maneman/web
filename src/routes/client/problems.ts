// Something wrong, told to Care from the app (src/domain/care/app-reports.ts; docs/decisions/0259-the-issue-log.md):
// recorded with its reference for the client's issue log, and filed in their Care thread. It sends nothing; Care answer
// in the app and on WhatsApp.

import { z } from "@hono/zod-openapi";
import { reportProblem } from "../../domain/care/app-reports.ts";
import { takeOne } from "../../domain/sign-in/rate-limit.ts";
import { clientOf } from "../../http/client-session.ts";
import type { App } from "../../http/context.ts";
import { errorResponse } from "../../http/errors.ts";
import { answerKeyed, IdempotencyKeyHeaderSchema, onceForKey } from "../../http/idempotency.ts";
import { json } from "../../http/openapi.ts";
import { opsInputs } from "../../http/ops-inputs.ts";
import { clientRoute } from "../../http/session-routes.ts";
import {
  categoryOf,
  PROBLEM_CATEGORIES,
  PROBLEM_MAX_CHARS,
  PROBLEMS_PER_DAY,
  reportReference,
} from "../../policy/problems.ts";

const ProblemSchema = z
  .object({
    about: z.enum([...PROBLEM_CATEGORIES, "hair_system"]).openapi({
      description: `What it is about: ${PROBLEM_CATEGORIES.join(", ")}; hair_system, an older app's, reads fit_comfort.`,
    }),
    visit_id: z.union([z.uuid(), z.null()]).default(null).openapi({ description: "The visit it is about, if one." }),
    text: z.string().trim().min(1).max(PROBLEM_MAX_CHARS).openapi({ description: "What is wrong, in their words." }),
  })
  .strict()
  .openapi("ProblemReport");

const problemRoute = clientRoute({
  method: "post",
  path: "/api/me/problems",
  summary: "Tell Care something is wrong: answered with the report's reference for the issue log",
  request: { headers: IdempotencyKeyHeaderSchema, body: { required: true, ...json(ProblemSchema) } },
  responses: {
    201: {
      description: "Filed for Care, who answer in the app and on WhatsApp",
      ...json(
        z
          .object({
            state: z.literal("sent"),
            reference: z.string().openapi({ description: "The report's reference, as MM-ISS-0032." }),
          })
          .strict()
          .openapi("ProblemReported"),
      ),
    },
    400: errorResponse(`invalid_request: empty, or over ${String(PROBLEM_MAX_CHARS)} characters`),
    401: errorResponse("session_required"),
    404: errorResponse("not_found: no visit of this client's"),
    409: errorResponse("idempotency_in_progress: the first report with this key is still being filed"),
    422: errorResponse("idempotency_key_reused: the key came before with a different report"),
    429: errorResponse(`rate_limited: ${String(PROBLEMS_PER_DAY)} a day`),
  },
});

export function registerClientProblems(app: App): void {
  app.openapi(problemRoute, async (c) => {
    const { subjectId } = clientOf(c);
    const db = c.env.DB;
    const now = c.var.deps.now();
    const body = c.req.valid("json");
    // A report sent again whose answer never came is answered with the first, not filed twice; the key is the
    // client's own, so another's report under it is refused as a different one.
    const keyed = {
      route: "POST /api/me/problems",
      key: c.req.valid("header")["idempotency-key"],
      request: { person: subjectId, ...body },
    };
    const run = await onceForKey(c, keyed, async () => {
      const mobile = await db
        .prepare("SELECT mobile_e164 FROM people WHERE id = ?1 AND erased_at IS NULL")
        .bind(subjectId)
        .first<string>("mobile_e164");
      if (mobile === null) return { ok: false as const, code: "not_found" as const };
      if (!(await takeOne(db, "problem:person", subjectId, { now, settings: c.var.config.settings }))) {
        return { ok: false as const, code: "rate_limited" as const };
      }
      const report = { personId: subjectId, mobileE164: mobile, category: categoryOf(body.about), text: body.text };
      const { guaranteeDays } = await opsInputs(c);
      const reported = await reportProblem(db, { ...report, at: now, visitId: body.visit_id, guaranteeDays });
      if (reported === null) return { ok: false as const, code: "not_found" as const };
      return { ok: true as const, body: { state: "sent" as const, reference: reportReference(reported.number) } };
    });
    return answerKeyed(c, run);
  });
}
