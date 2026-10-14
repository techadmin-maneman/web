// Something wrong with a client's hair system, or with a visit, told to Care from the app
// (src/domain/care/app-reports.ts):
//
//   POST /api/me/problems   { about, visit_id, text }: filed in the client's Care thread, a note for Care beside it
//
// It sends nothing; Care answer on WhatsApp, where the client's photographs follow.

import { z } from "@hono/zod-openapi";
import { reportProblem } from "../../domain/care/app-reports.ts";
import { takeOne } from "../../domain/sign-in/rate-limit.ts";
import { clientOf } from "../../http/client-session.ts";
import type { App } from "../../http/context.ts";
import { errorResponse, refuse } from "../../http/errors.ts";
import { json } from "../../http/openapi.ts";
import { clientRoute } from "../../http/session-routes.ts";
import { PROBLEM_ABOUT, PROBLEM_MAX_CHARS, PROBLEMS_PER_DAY } from "../../policy/problems.ts";

const ProblemSchema = z
  .object({
    about: z.enum(PROBLEM_ABOUT),
    visit_id: z.union([z.uuid(), z.null()]).default(null).openapi({ description: "The visit it is about, if one." }),
    text: z.string().trim().min(1).max(PROBLEM_MAX_CHARS).openapi({ description: "What is wrong, in their words." }),
  })
  .strict()
  .openapi("ProblemReport");

const problemRoute = clientRoute({
  method: "post",
  path: "/api/me/problems",
  summary: "Tell Care something is wrong with the hair system or a visit",
  request: { body: { required: true, ...json(ProblemSchema) } },
  responses: {
    201: {
      description: "Filed for Care, who answer on WhatsApp",
      ...json(z.object({ state: z.literal("sent") }).strict().openapi("ProblemReported")),
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
    const report = { personId: subjectId, mobileE164: mobile, about: body.about, text: body.text, at: now };
    if (!(await reportProblem(db, { ...report, visitId: body.visit_id }))) return refuse(c, "not_found");
    return c.json({ state: "sent" as const }, 201);
  });
}
