// What goes wrong in the site and the client, ops and technician apps, as their pages report it
// (packages/web-kit/client-errors.ts), and in the site's own Worker, which reports as a page does (site/src/worker.ts).
//
// Each report is one `client_error` log line, redacted like every other; nothing is stored. No session is asked
// for, since a page can fail before anyone signs in: the same-origin rule of every app surface keeps other sites
// out, and the hourly limits keep a page stuck in a loop from flooding the logs.

import { checkoutUnavailable } from "../domain/money/checkout-alerts.ts";
import { createRoute, z } from "@hono/zod-openapi";
import { INVITE_CODE } from "../config/invite-codes.ts";
import { takeOne } from "../domain/sign-in/rate-limit.ts";
import type { App } from "../http/context.ts";
import { errorResponse, refuse } from "../http/errors.ts";
import { json } from "../http/openapi.ts";
import { visitorOf } from "../http/visitor.ts";
import { isForeignError } from "../policy/client-errors.ts";

/**
 * An invite's landing, "/r/MM4417": its code is a person's own, so it is taken out of every part of a report that can
 * name the page, the path, the message, the stack and the script, before the report is logged and sent on to Sentry,
 * whichever page or Worker sent it (site/src/lib/invite.ts keeps it out of what the site's own tags are given). In a
 * stack the code is followed by the line and column, "https://maneman.in/r/MM4417:1:2048", and in a message by a quote
 * or a full stop: wherever it ends, it is taken out.
 */
const INVITE_LANDING = new RegExp(`^/r/${INVITE_CODE}/?$`);
const INVITE_IN_TEXT = new RegExp(`/r/${INVITE_CODE}(?![A-Za-z0-9])`, "g");

/** Text from a report with any invite's code taken out. */
const withoutCode = (text: string | undefined): string | undefined => text?.replace(INVITE_IN_TEXT, "/r/");

const ReportSchema = z
  .object({
    kind: z.enum(["error", "unhandled_rejection", "render", "outbox_gave_up", "checkout_unavailable"]).openapi({
      description: "checkout_unavailable: Razorpay Checkout's script did not load, so no payment could be made.",
    }),
    message: z.string().max(500),
    path: z.string().max(300).openapi({ description: "The page's path, with no query or fragment." }),
    version: z.string().max(40).optional().openapi({ description: "The build the page runs, as its mm-version." }),
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
    const at = { now: c.var.deps.now(), settings: c.var.config.settings };
    const { ipHash } = await visitorOf(c);
    const within =
      (await takeOne(db, "client_error:ip", ipHash, at)) && (await takeOne(db, "client_error:all", "all", at));
    if (!within) return refuse(c, "rate_limited");

    const { request_id: refusedRequestId, ...report } = c.req.valid("json");
    // Thrown by code the browser put into the page, not ours: kept, but out of Sentry's errors.
    const foreign = isForeignError(report, new URL(c.req.url).origin);
    c.var.log[foreign ? "info" : "error"](foreign ? "client_error_foreign" : "client_error", {
      app: c.var.surface,
      ...report,
      path: report.path.replace(INVITE_LANDING, "/r/"),
      message: withoutCode(report.message),
      stack: withoutCode(report.stack),
      source: withoutCode(report.source),
      refused_request_id: refusedRequestId,
      browser: c.req.header("User-Agent")?.slice(0, 200),
    });
    if (report.kind === "checkout_unavailable") await checkoutUnavailable(c.var.deps.alertOnce);
    return c.body(null, 204);
  });
}
