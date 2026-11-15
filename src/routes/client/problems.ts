// Something wrong, told to Care from the app (src/domain/care/app-reports.ts; docs/decisions/0258-the-issue-log.md):
// recorded with its reference for the client's issue log, and filed in their Care thread. It sends nothing; Care answer
// in the app and on WhatsApp.

import { z } from "@hono/zod-openapi";
import { reportProblem } from "../../domain/care/app-reports.ts";
import { takeOne } from "../../domain/sign-in/rate-limit.ts";
import { clientOf } from "../../http/client-session.ts";
import type { App } from "../../http/context.ts";
import { errorResponse, refuse } from "../../http/errors.ts";
import { json } from "../../http/openapi.ts";
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
  request: { body: { required: true, ...json(ProblemSchema) } },
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
    429: errorResponse(`rate_limited: ${String(PROBLEMS_PER_DAY)} a day`),
  },
});

export function registerClientProblems(app: App): void {
  app.openapi(problemRoute, async (c) => {
    const { subjectId } = clientOf(c);
    const db = c.env.DB;
    const now = c.var.deps.now();
    const body = c.req.valid("json");
    const mobile = await db
      .prepare("SELECT mobile_e164 FROM people WHERE id = ?1 AND erased_at IS NULL")
      .bind(subjectId)
      .first<string>("mobile_e164");
    if (mobile === null) return refuse(c, "not_found");
    if (!(await takeOne(db, "problem:person", subjectId, { now, settings: c.var.config.settings }))) {
      return refuse(c, "rate_limited");
    }
    const report = {
      personId: subjectId,
      mobileE164: mobile,
      category: categoryOf(body.about),
      text: body.text,
      at: now,
    };
    const reported = await reportProblem(db, { ...report, visitId: body.visit_id });
    if (reported === null) return refuse(c, "not_found");
    return c.json({ state: "sent" as const, reference: reportReference(reported.number) }, 201);
  });
}
