// The client app's visits and photographs (docs/prompts/phase2-backend.md,
// "Read endpoints"), read from the FSM mirror (docs/decisions/0032-fsm-mirror.md).
//
//   GET /api/visits                 upcoming and past, with what they add up to
//   GET /api/visits/:id             one visit, with its photographs
//   GET /api/photos                 the timeline: each visit's photographs, newest first
//   GET /api/photos/compare         one angle from two visits, side by side
//   GET /api/photos/file/:token     a photograph itself, for the signed-in client
//
// Every photograph is served through a link that lasts 15 minutes, and only
// to the client whose photograph it is.

import { createRoute, z } from "@hono/zod-openapi";
import type { App } from "../app.ts";
import { VISIT_TYPES } from "../config/visit-types.ts";
import { clientHistory } from "../domain/client-history.ts";
import { listVisits, ownPhotoKey, photoSets, visitDetail } from "../domain/client-visits.ts";
import { VISIT_OUTCOMES } from "../domain/fsm-mirror.ts";
import { ANGLES, PHASES } from "../domain/visit-photos.ts";
import { requireClientSession } from "../http/client-session.ts";
import { errorBody, errorResponse } from "../http/errors.ts";
import { verifyToken } from "../lib/signed-token.ts";

const TechnicianSchema = z
  .object({ name: z.string(), initials: z.string() })
  .strict()
  .openapi("Technician", { description: "Display name and initials only." });

export const VisitSummarySchema = z
  .object({
    id: z.uuid(),
    date: z.iso.date().openapi({ description: "India's calendar date." }),
    window_label: z.enum(["morning", "afternoon", "evening"]),
    starts_at: z.iso.datetime(),
    ends_at: z.iso.datetime(),
    length_minutes: z.number().int(),
    type: z.union([z.enum(VISIT_TYPES), z.null()]),
    status: z.enum(["scheduled", "dispatched", "in_progress", "completed", "cancelled", "terminated", "other"]),
    stage: z.union([z.enum(["booked", "in_progress", "closing"]), z.null()]).openapi({
      description:
        "For a visit FSM has not closed: still to come, under way in its window, or over and waiting for FSM to " +
        "close it. Null once FSM has closed it.",
    }),
    prepaid: z.boolean().openapi({ description: "Paid for ahead, or covered by a visit credit: board C1's Prepaid." }),
    technician: z.union([TechnicianSchema, z.null()]),
    place: z
      .string()
      .openapi({ description: "The saved address's area, city and pincode, else FSM's city and pincode." }),
  })
  .strict()
  .openapi("VisitSummary");

const PhotoLinkSchema = z
  .object({
    angle: z.enum(ANGLES),
    url: z.string().openapi({ description: "Lasts 15 minutes; only the signed-in client can open it." }),
    width: z.union([z.number().int(), z.null()]),
    height: z.union([z.number().int(), z.null()]),
  })
  .strict()
  .openapi("PhotoLink");

const PhotoSetSchema = z
  .object({ before: z.array(PhotoLinkSchema), after: z.array(PhotoLinkSchema) })
  .strict()
  .openapi("PhotoSet", {
    description: "Each angle in the order front, top, left, right, hair; missing angles left out.",
  });

const VisitDetailSchema = VisitSummarySchema.extend({
  duration_minutes: z.union([z.number().int(), z.null()]).openapi({ description: "From start to finish, once done." }),
  outcome: z
    .union([z.enum(VISIT_OUTCOMES), z.null()])
    .openapi({ description: "Done, partly done, or a no-show: the client was not home. Null until FSM closes it." }),
  what_was_done: z.union([z.array(z.string()), z.null()]).openapi({
    description:
      "The job sheet's checklist items the technician ticked, in the sheet's order; null when no checklist was " +
      "recorded, as for a visit closed in FSM's own screens.",
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
}).openapi("VisitDetail");

/**
 * The figures src/domain/client-history.ts derives, which the client and ops
 * read from the one derivation. Each surface names its own replacement date
 * beside them: ops act on the day, the client is told only the month.
 */
export const HISTORY_FIGURES = {
  visits: z.number().int().openapi({ description: "Every visit done: a completed visit with a window." }),
  services: z.number().int(),
  replacements: z.number().int(),
  first_fit_on: z
    .union([z.iso.date(), z.null()])
    .openapi({ description: "India's date. Null when no first fit is on record, which is not the same as none." }),
  last_visit_on: z.union([z.iso.date(), z.null()]).openapi({ description: "India's date of the latest visit done." }),
  spend: z
    .number()
    .int()
    .openapi({ description: "In paise: every payment captured, less what has gone back. A credit adds nothing." }),
};

const ClientHistorySchema = z
  .object({
    ...HISTORY_FIGURES,
    replacement_due: z.union([z.object({ month: z.string().regex(/^\d{4}-\d{2}$/) }).strict(), z.null()]).openapi({
      description:
        "The month the piece now in wear falls due, and null when no piece is in wear. " +
        "A month, not a day: FSM's install date is read again on every sync, so the day can move (ADR 0059).",
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

const TimelineSchema = z
  .object({
    visits: z.array(
      z
        .object({
          visit_id: z.uuid(),
          date: z.iso.date(),
          type: z.union([z.enum(VISIT_TYPES), z.null()]),
          photos: PhotoSetSchema,
        })
        .strict(),
    ),
  })
  .strict()
  .openapi("PhotoTimeline");

const ComparedSchema = z
  .object({ visit_id: z.uuid(), date: z.iso.date(), photo: z.union([PhotoLinkSchema, z.null()]) })
  .strict();
const CompareSchema = z
  .object({ angle: z.enum(ANGLES), phase: z.enum(PHASES), from: ComparedSchema, to: ComparedSchema })
  .strict()
  .openapi("PhotoCompare");

const visitsRoute = createRoute({
  method: "get",
  path: "/api/visits",
  summary: "The client's visits, upcoming and past",
  responses: {
    200: {
      description: "Upcoming soonest first; past newest first",
      content: { "application/json": { schema: VisitsSchema } },
    },
    401: errorResponse("session_required"),
  },
});

const visitRoute = createRoute({
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

const timelineRoute = createRoute({
  method: "get",
  path: "/api/photos",
  summary: "The client's photographs, by visit, newest first",
  responses: {
    200: { description: "Visits that have photographs", content: { "application/json": { schema: TimelineSchema } } },
    401: errorResponse("session_required"),
  },
});

const compareRoute = createRoute({
  method: "get",
  path: "/api/photos/compare",
  summary: "One angle from two of the client's visits, to compare",
  request: {
    query: z.object({
      from: z.uuid(),
      to: z.uuid(),
      angle: z.enum(ANGLES),
      phase: z.enum(PHASES).default("after"),
    }),
  },
  responses: {
    200: {
      description: "Both photographs, or null where a visit has none of that angle",
      content: { "application/json": { schema: CompareSchema } },
    },
    401: errorResponse("session_required"),
    404: errorResponse("not_found: a visit that is not this client's"),
  },
});

const photoFileRoute = createRoute({
  method: "get",
  path: "/api/photos/file/{token}",
  summary: "A photograph, through a link that lasts 15 minutes",
  request: { params: z.object({ token: z.string() }) },
  responses: {
    200: {
      description: "The image",
      content: { "image/jpeg": { schema: z.string() }, "image/png": { schema: z.string() } },
    },
    401: errorResponse("session_required"),
    404: errorResponse("not_found: the link is wrong, expired, or not this client's"),
  },
});

export function registerClientVisits(app: App): void {
  for (const path of ["/api/visits", "/api/visits/*", "/api/photos", "/api/photos/*"]) {
    app.use(path, requireClientSession);
  }

  app.openapi(visitsRoute, async (c) => {
    const session = c.var.clientSession;
    if (session === undefined) return c.json(errorBody("session_required", c.var.requestId), 401);
    const [visits, history] = await Promise.all([
      listVisits(c.env.DB, session.subjectId, c.var.deps.now()),
      clientHistory(c.env.DB, session.subjectId),
    ]);
    // The client is told the month and never the day: see ClientHistorySchema.
    const { replacement_due: due, ...figures } = history;
    const replacementDue = due === null ? null : { month: due.month };
    return c.json({ ...visits, history: { ...figures, replacement_due: replacementDue } }, 200);
  });

  app.openapi(visitRoute, async (c) => {
    const session = c.var.clientSession;
    if (session === undefined) return c.json(errorBody("session_required", c.var.requestId), 401);
    const visit = await visitDetail(
      c.env.DB,
      session.subjectId,
      c.req.valid("param").id,
      c.var.config.settings.tryon.linkSigningKey,
      c.var.deps.now(),
    );
    if (visit === null) return c.json(errorBody("not_found", c.var.requestId), 404);
    return c.json(visit, 200);
  });

  app.openapi(timelineRoute, async (c) => {
    const session = c.var.clientSession;
    if (session === undefined) return c.json(errorBody("session_required", c.var.requestId), 401);
    const { past } = await listVisits(c.env.DB, session.subjectId, c.var.deps.now());
    const sets = await photoSets(
      c.env.DB,
      past.map((visit) => visit.id),
      c.var.config.settings.tryon.linkSigningKey,
      c.var.deps.now(),
    );
    const visits = past.flatMap((visit) => {
      const photos = sets.get(visit.id);
      return photos === undefined ? [] : [{ visit_id: visit.id, date: visit.date, type: visit.type, photos }];
    });
    return c.json({ visits }, 200);
  });

  app.openapi(compareRoute, async (c) => {
    const session = c.var.clientSession;
    if (session === undefined) return c.json(errorBody("session_required", c.var.requestId), 401);
    const { from, to, angle, phase } = c.req.valid("query");
    const { past } = await listVisits(c.env.DB, session.subjectId, c.var.deps.now());
    const [first, second] = [from, to].map((id) => past.find((visit) => visit.id === id));
    if (first === undefined || second === undefined) return c.json(errorBody("not_found", c.var.requestId), 404);
    const sets = await photoSets(
      c.env.DB,
      [first.id, second.id],
      c.var.config.settings.tryon.linkSigningKey,
      c.var.deps.now(),
    );
    const pick = (visit: typeof first) => ({
      visit_id: visit.id,
      date: visit.date,
      photo: sets.get(visit.id)?.[phase].find((link) => link.angle === angle) ?? null,
    });
    return c.json({ angle, phase, from: pick(first), to: pick(second) }, 200);
  });

  app.openapi(photoFileRoute, async (c) => {
    const session = c.var.clientSession;
    if (session === undefined) return c.json(errorBody("session_required", c.var.requestId), 401);
    const photoId = await verifyToken(
      c.var.config.settings.tryon.linkSigningKey,
      "photo",
      c.req.valid("param").token,
      c.var.deps.now(),
    );
    const photo = photoId === null ? null : await ownPhotoKey(c.env.DB, session.subjectId, photoId);
    const object = photo === null ? null : await c.env.CLIENT_PHOTOS.get(photo.key);
    if (photo === null || object === null) return c.json(errorBody("not_found", c.var.requestId), 404);
    return new Response(object.body, {
      headers: { "Content-Type": photo.contentType, "Cache-Control": "private, max-age=900" },
    });
  });
}
