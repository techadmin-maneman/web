// The client app's visits and photographs (docs/prompts/phase2-backend.md,
// "Read endpoints").
//
//   GET /api/visits                 upcoming and past, with what they add up to
//   GET /api/visits/:id             one visit, with its photographs
//   GET /api/photos                 the timeline: each visit's photographs, newest first, and the try-ons
//   GET /api/photos/compare         one angle from two visits, side by side
//   GET /api/photos/file/:token     a photograph itself, for the signed-in client
//   GET /api/photos/small/:token    its small copy, for the rows, or the photograph where it has none (ADR 0093)
//   GET /api/photos/try-on/:image/:token   a try-on's photograph or look (ADR 0082, ADR 0084)
//
// Every photograph is served through a link that lasts 15 minutes, and only
// to the client whose photograph it is. The visits are here; the photographs are ./photos.ts.

import { z } from "@hono/zod-openapi";
import { clientHistory } from "../../domain/visits/client-history.ts";
import { listVisits, visitDetail } from "../../domain/visits/client-visits.ts";
import { VISIT_OUTCOMES } from "../../domain/visits/visit-status.ts";
import { clientOf } from "../../http/client-session.ts";
import type { App } from "../../http/context.ts";
import { errorResponse, refuse } from "../../http/errors.ts";
import { clientRoute } from "../../http/session-routes.ts";
import { HISTORY_FIGURES, NoShowNoteSchema, PhotoSetSchema, VisitSummarySchema } from "../schemas/visits.ts";

const VisitDetailSchema = VisitSummarySchema.extend({
  duration_minutes: z.union([z.number().int(), z.null()]).openapi({ description: "From start to finish, once done." }),
  outcome: z
    .union([z.enum(VISIT_OUTCOMES), z.null()])
    .openapi({ description: "Done, partly done, or a no-show: the client was not home. Null until it is closed." }),
  what_was_done: z.union([z.array(z.string()), z.null()]).openapi({
    description:
      "The job sheet's checklist items the technician ticked, in the sheet's order; null when no checklist was " +
      "recorded.",
  }),
  photos: PhotoSetSchema,
  document_id: z
    .union([z.uuid(), z.null()])
    .openapi({ description: "The visit's invoice, for GET /api/documents/{id}, once Books has issued it." }),
  invoice_expected: z.boolean().openapi({
    description:
      "Whether this visit is billed at all: false for a free visit, and for one that is not finished. " +
      "With no document_id and this false, no invoice will ever exist.",
  }),
  invoice_held: z.union([z.enum(["credit", "checking"]), z.null()]).openapi({
    description:
      "Why a finished visit's invoice is held back rather than still to come (ADR 0070): credit, a visit credit " +
      "paid for it and its invoice waits on the accountant's ruling; checking, a draft ops are checking before it " +
      "is sent. Null otherwise.",
  }),
  no_show: z.union([NoShowNoteSchema, z.null()]).openapi({
    description: "The client was not home for this visit: how long we waited, and what ops ruled. Null otherwise.",
  }),
}).openapi("VisitDetail");

const ClientHistorySchema = z
  .object({
    ...HISTORY_FIGURES,
    replacement_due: z.union([z.object({ month: z.string().regex(/^\d{4}-\d{2}$/) }).strict(), z.null()]).openapi({
      description:
        "The month the piece now in wear falls due, and null when no piece is in wear. " +
        "A month, not a day (ADR 0059).",
    }),
  })
  .strict()
  .openapi("ClientHistory");

const VisitsSchema = z
  .object({
    upcoming: z.array(VisitSummarySchema),
    past: z.array(VisitSummarySchema),
    history: ClientHistorySchema.openapi({ description: "What the client's record adds up to, derived at read time." }),
  })
  .strict()
  .openapi("Visits");

const visitsRoute = clientRoute({
  method: "get",
  path: "/api/visits",
  summary: "The client's visits, upcoming and past",
  responses: {
    200: {
      description: "Upcoming soonest first; past newest first, a visit cancelled among them",
      content: { "application/json": { schema: VisitsSchema } },
    },
    401: errorResponse("session_required"),
  },
});

const visitRoute = clientRoute({
  method: "get",
  path: "/api/visits/{id}",
  summary: "One of the client's visits, with its photographs",
  request: { params: z.object({ id: z.uuid() }) },
  responses: {
    200: { description: "The visit", content: { "application/json": { schema: VisitDetailSchema } } },
    401: errorResponse("session_required"),
    404: errorResponse("not_found: no such visit of this client's"),
  },
});

export function registerClientVisits(app: App): void {
  app.openapi(visitsRoute, async (c) => {
    const session = clientOf(c);
    const [visits, history] = await Promise.all([
      listVisits(c.env.DB, session.subjectId, c.var.deps.now(), { withCancelled: true }),
      clientHistory(c.env.DB, session.subjectId),
    ]);
    // The client is told the month and never the day: see ClientHistorySchema.
    const { replacement_due: due, ...figures } = history;
    const replacementDue = due === null ? null : { month: due.month };
    return c.json({ ...visits, history: { ...figures, replacement_due: replacementDue } }, 200);
  });

  app.openapi(visitRoute, async (c) => {
    const session = clientOf(c);
    const visit = await visitDetail({
      db: c.env.DB,
      personId: session.subjectId,
      visitId: c.req.valid("param").id,
      signingKey: c.var.config.settings.tryon.linkSigningKey,
      now: c.var.deps.now(),
    });
    if (visit === null) return refuse(c, "not_found");
    return c.json(visit, 200);
  });
}
