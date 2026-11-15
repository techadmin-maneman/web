// The client's issue log (src/domain/care/issue-log.ts; docs/decisions/0258-the-issue-log.md): every report with its
// state and its thread, beside their grievances and missed-visit disputes; and, on a report of theirs, an update, a
// reopening, or their word that it is sorted.

import { z } from "@hono/zod-openapi";
import { addToReport, markReportSorted, reportOf } from "../../domain/care/app-reports.ts";
import { issueLogOf } from "../../domain/care/issue-log.ts";
import { takeOne } from "../../domain/sign-in/rate-limit.ts";
import { clientOf } from "../../http/client-session.ts";
import type { App } from "../../http/context.ts";
import { errorResponse, refuse } from "../../http/errors.ts";
import { json } from "../../http/openapi.ts";
import { clientRoute } from "../../http/session-routes.ts";
import { PROBLEM_ADDS_PER_DAY, PROBLEM_CATEGORIES, PROBLEM_MAX_CHARS, reportNumberOf } from "../../policy/problems.ts";

const EventSchema = z
  .object({
    at: z.iso.datetime(),
    kind: z.enum(["you", "care", "city", "visits", "closed", "sorted", "ruled"]).openapi({
      description:
        "you: the client's words; care: a reply; city: passed to their city team; visits: free visits given (text: " +
        "how many); closed: Care closed it; sorted: the client marked it sorted; ruled: the answer to a grievance or " +
        "a dispute (text: its words, or refunded or upheld).",
    }),
    name: z.union([z.string(), z.null()]).openapi({ description: "The first name a reply came from." }),
    text: z.union([z.string(), z.null()]),
  })
  .strict()
  .openapi("IssueEvent");

const IssueSchema = z
  .object({
    kind: z.enum(["report", "grievance", "dispute"]),
    id: z.string(),
    reference: z.union([z.string(), z.null()]).openapi({ description: "A report's, as MM-ISS-0032." }),
    category: z.union([z.enum(PROBLEM_CATEGORIES), z.null()]),
    state: z.enum(["open", "in_progress", "resolved"]),
    raised_at: z.iso.datetime(),
    visit_id: z.union([z.string(), z.null()]),
    text: z.union([z.string(), z.null()]),
    photos: z.number().int(),
    events: z.array(EventSchema).openapi({ description: "The issue's thread, oldest first." }),
  })
  .strict()
  .openapi("Issue");

const SIGNED_IN = errorResponse("session_required");
const reference = z.object({
  reference: z.string().openapi({ description: "The report's reference, as MM-ISS-0032." }),
});
const NO_REPORT = errorResponse("not_found: no report of this client's by that reference");
const LIMITED = errorResponse(`rate_limited: ${String(PROBLEM_ADDS_PER_DAY)} a day`);

const logRoute = clientRoute({
  method: "get",
  path: "/api/me/problems",
  summary: "The client's issue log: their reports, grievances and missed-visit disputes, newest first",
  responses: {
    200: {
      description: "The log",
      ...json(
        z
          .object({ issues: z.array(IssueSchema) })
          .strict()
          .openapi("IssueLog"),
      ),
    },
    401: SIGNED_IN,
  },
});

const WordsSchema = z
  .object({ text: z.string().trim().min(1).max(PROBLEM_MAX_CHARS) })
  .strict()
  .openapi("IssueWords");

const updateRoute = clientRoute({
  method: "post",
  path: "/api/me/problems/{reference}/updates",
  summary: "Add the client's words to a report of theirs, which opens it again where it was settled",
  request: { params: reference, body: { required: true, ...json(WordsSchema) } },
  responses: {
    204: { description: "Filed in its Care chat" },
    400: errorResponse("invalid_request"),
    401: SIGNED_IN,
    404: NO_REPORT,
    429: LIMITED,
  },
});

const reopenRoute = clientRoute({
  method: "post",
  path: "/api/me/problems/{reference}/reopen",
  summary: "Reopen a settled report of the client's: it is happening again",
  request: { params: reference, body: { required: true, ...json(WordsSchema) } },
  responses: {
    204: { description: "Reopened, and filed in its Care chat" },
    400: errorResponse("invalid_request"),
    401: SIGNED_IN,
    404: NO_REPORT,
    429: LIMITED,
  },
});

const sortedRoute = clientRoute({
  method: "post",
  path: "/api/me/problems/{reference}/sorted",
  summary: "The client says a report of theirs is sorted",
  request: { params: reference },
  responses: { 204: { description: "Marked sorted" }, 401: SIGNED_IN, 404: NO_REPORT },
});

type Ctx = Parameters<Parameters<App["openapi"]>[1]>[0];

/** The report the path names, where it is the signed-in client's. */
async function theirReport(c: Ctx, given: string) {
  const number = reportNumberOf(given);
  return number === null ? null : reportOf(c.env.DB, clientOf(c).subjectId, number);
}

export function registerClientProblemLog(app: App): void {
  app.openapi(logRoute, async (c) => c.json({ issues: await issueLogOf(c.env.DB, clientOf(c).subjectId) }, 200));

  for (const [route, reopening] of [
    [updateRoute, false],
    [reopenRoute, true],
  ] as const) {
    app.openapi(route, async (c) => {
      const { subjectId } = clientOf(c);
      const now = c.var.deps.now();
      const report = await theirReport(c, c.req.valid("param").reference);
      const mobile = await c.env.DB.prepare("SELECT mobile_e164 FROM people WHERE id = ?1 AND erased_at IS NULL")
        .bind(subjectId)
        .first<string>("mobile_e164");
      if (report === null || mobile === null) return refuse(c, "not_found");
      if (!(await takeOne(c.env.DB, "problem_add:person", subjectId, { now, settings: c.var.config.settings }))) {
        return refuse(c, "rate_limited");
      }
      await addToReport(c.env.DB, { report, mobileE164: mobile, text: c.req.valid("json").text, reopening, at: now });
      return c.body(null, 204);
    });
  }

  app.openapi(sortedRoute, async (c) => {
    const report = await theirReport(c, c.req.valid("param").reference);
    if (report === null) return refuse(c, "not_found");
    await markReportSorted(c.env.DB, report.id, c.var.deps.now());
    return c.body(null, 204);
  });
}
