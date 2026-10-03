// What goes wrong in the client, ops and technician apps, as their pages report it (packages/web-kit/client-errors.ts):
//
//   POST /api/client-errors   a script error, a promise nobody caught, a screen that could not draw, or a write the
//                             technician app's outbox gave up on
//
// Each report is one `client_error` log line, redacted like every other; nothing is stored. No session is asked
// for, since a page can fail before anyone signs in: the same-origin rule of every app surface keeps other sites
// out, and the hourly limits keep a page stuck in a loop from flooding the logs.

import { createRoute, z } from "@hono/zod-openapi";
import { takeOne } from "../domain/rate-limit.ts";
import type { App } from "../http/context.ts";
import { errorBody, errorResponse } from "../http/errors.ts";
import { json } from "../http/openapi.ts";
import { visitorOf } from "../http/visitor.ts";
import { indiaHour } from "../lib/india-time.ts";

const REPORTS_PER_ADDRESS_HOURLY = 20;
const REPORTS_PER_HOUR = 300;

const ReportSchema = z
  .object({
    kind: z.enum(["error", "unhandled_rejection", "render", "outbox_gave_up"]),
    message: z.string().max(500),
    path: z.string().max(300).openapi({ description: "The page's path, with no query or fragment." }),
    stack: z.string().max(4000).optional(),
    source: z.string().max(500).optional().openapi({ description: "The script the error was thrown in." }),
    line: z.number().int().nonnegative().optional(),
    column: z.number().int().nonnegative().optional(),
    step: z.string().max(40).optional().openapi({ description: "outbox_gave_up: the write's kind, as `checklist`." }),
    code: z.string().max(60).optional().openapi({ description: "outbox_gave_up: the code the API refused it with." }),
    status: z.number().int().optional().openapi({ description: "outbox_gave_up: the refusal's HTTP status." }),
    request_id: z
      .string()
      .max(64)
      .optional()
      .openapi({ description: "outbox_gave_up: the refusal's request ID, which its own log lines carry." }),
  })
  .strict()
  .openapi("ClientErrorReport");

const reportRoute = createRoute({
  method: "post",
  path: "/api/client-errors",
  summary: "Report an error in the app's own page",
  request: { body: { required: true, ...json(ReportSchema) } },
  responses: {
    204: { description: "Logged" },
    400: errorResponse("invalid_request"),
    429: errorResponse("rate_limited: this address has sent its reports for the hour, or every address has"),
  },
});

export function registerClientErrors(app: App): void {
  app.openapi(reportRoute, async (c) => {
    const db = c.env.DB;
    const window = indiaHour(c.var.deps.now());
    const { ipHash } = await visitorOf(c);
    const withinAddress = await takeOne(db, {
      scope: "client_error:ip",
      key: ipHash,
      window,
      limit: REPORTS_PER_ADDRESS_HOURLY,
    });
    const within =
      withinAddress && (await takeOne(db, { scope: "client_error:all", key: "all", window, limit: REPORTS_PER_HOUR }));
    if (!within) return c.json(errorBody("rate_limited", c.var.requestId), 429);

    const { request_id: refusedRequestId, ...report } = c.req.valid("json");
    c.var.log.error("client_error", {
      app: c.var.surface,
      ...report,
      refused_request_id: refusedRequestId,
      browser: c.req.header("User-Agent")?.slice(0, 200),
    });
    return c.body(null, 204);
  });
}
