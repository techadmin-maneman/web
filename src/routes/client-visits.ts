// The client app's visits and photographs (docs/prompts/phase2-backend.md,
// "Read endpoints"), read from the FSM mirror (docs/decisions/0032-fsm-mirror.md).
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
// to the client whose photograph it is.

import { createRoute, z } from "@hono/zod-openapi";
import type { App } from "../http/context.ts";
import { VISIT_TYPES } from "../config/visit-types.ts";
import { alertCeilingReached, takeFromCeiling } from "../domain/ceilings.ts";
import { clientHistory } from "../domain/client-history.ts";
import { clientTryOns, ownTryOnImage, TRY_ON_IMAGES, TRY_ON_TOKEN_PURPOSES } from "../domain/client-try-ons.ts";
import { listVisits, ownPhotoKey, photoSets, visitDetail } from "../domain/client-visits.ts";
import { VISIT_OUTCOMES } from "../domain/fsm-mirror.ts";
import { NO_SHOW_DECISIONS } from "../policy/no-show.ts";
import { ANGLES, PHASES } from "../domain/visit-photos.ts";
import { clientOf, requireClientSession } from "../http/client-session.ts";
import { errorBody, errorResponse } from "../http/errors.ts";
import { fileExtension, type ImageType } from "../lib/image-bytes.ts";
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
    thumbnail_url: z.union([z.string(), z.null()]).openapi({
      description:
        "Its small copy, for a row of thumbnails, likewise; null for a photograph with none, such as one copied from " +
        "FSM, which the row shows itself.",
    }),
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

/** A visit the client was not home for, as their visit page and their Payments say it (LIFE-07). */
export const NoShowNoteSchema = z
  .object({
    decision: z.enum(NO_SHOW_DECISIONS).openapi({
      description: "What ops ruled: undecided while they look at the evidence, charged, or waived.",
    }),
    waited_minutes: z.number().int().openapi({ description: "How long the technician waited at the door." }),
  })
  .strict()
  .openapi("NoShowNote");

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

const TryOnLinkSchema = z
  .object({
    url: z.string().openapi({ description: "Lasts 15 minutes; only the signed-in client can open it." }),
    kept_until: z.union([z.iso.datetime(), z.null()]).openapi({
      description:
        "When the try-on's retention rule lets it go: a photograph an hour after the last look asked of it, or its " +
        "small copy as long as the look; a look the days the site keeps it for (RESULT_RETENTION_DAYS, ADR 0039). " +
        "Deleted within minutes after. Null while the try-on is kept (ADR 0084): the photograph until the client " +
        "asks us to delete it, the look until their first fit is photographed.",
    }),
  })
  .strict()
  .openapi("TryOnLink");

const TryOnSchema = z
  .object({
    id: z.uuid(),
    made_on: z.iso.date().openapi({ description: "India's date the look was asked for." }),
    kept: z.boolean().openapi({
      description:
        "The client's kept try-on (ADR 0084): they have booked a visit, and it is the oldest of theirs kept, or " +
        "whose look was held when they booked.",
    }),
    photo: z.union([TryOnLinkSchema, z.null()]).openapi({
      description:
        "The photograph the client uploaded on the site, as the small copy the site sent with it where there is " +
        "one, while it is held; null once deleted, and on a second look of the same photograph, which shows it once.",
    }),
    look: z.union([TryOnLinkSchema, z.null()]).openapi({
      description:
        "The look made from it, once made and until it is deleted; null while it is still being made, and once a " +
        "kept try-on's first fit is photographed.",
    }),
  })
  .strict()
  .openapi("TryOn", {
    description: "A try-on the site's gate claimed with the client's number (ADR 0082). A failed one is left out.",
  });

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
    try_ons: z.array(TryOnSchema).openapi({
      description: "The client's try-ons with a photograph or a look still held, newest first.",
    }),
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
  summary: "The client's photographs, by visit, newest first, and their try-ons",
  responses: {
    200: {
      description: "Visits that have photographs, and try-ons still held",
      content: { "application/json": { schema: TimelineSchema } },
    },
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

const photoSmallRoute = createRoute({
  method: "get",
  path: "/api/photos/small/{token}",
  summary: "A photograph's small copy, through a link that lasts 15 minutes; the photograph itself if the copy is gone",
  request: { params: z.object({ token: z.string() }) },
  responses: {
    200: { description: "The image", content: { "image/jpeg": { schema: z.string() }, "image/png": { schema: z.string() } } },
    401: errorResponse("session_required"),
    404: errorResponse("not_found: the link is wrong, expired, or not this client's"),
  },
});

const tryOnFileRoute = createRoute({
  method: "get",
  path: "/api/photos/try-on/{image}/{token}",
  summary: "A try-on's photograph or look, through a link that lasts 15 minutes",
  request: { params: z.object({ image: z.enum(TRY_ON_IMAGES), token: z.string() }) },
  responses: {
    200: {
      description: "The image",
      content: { "image/jpeg": { schema: z.string() }, "image/png": { schema: z.string() } },
    },
    401: errorResponse("session_required"),
    404: errorResponse("not_found: the link is wrong, expired, or not this client's, or the image is deleted"),
    503: errorResponse("busy: today's result-read ceiling is reached"),
  },
});

export function registerClientVisits(app: App): void {
  for (const path of ["/api/visits", "/api/visits/*", "/api/photos", "/api/photos/*"]) {
    app.use(path, requireClientSession);
  }

  app.openapi(visitsRoute, async (c) => {
    const session = clientOf(c);
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
    const session = clientOf(c);
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
    const session = clientOf(c);
    const signingKey = c.var.config.settings.tryon.linkSigningKey;
    const now = c.var.deps.now();
    const { past } = await listVisits(c.env.DB, session.subjectId, now);
    const sets = await photoSets(
      c.env.DB,
      past.map((visit) => visit.id),
      signingKey,
      now,
    );
    const visits = past.flatMap((visit) => {
      const photos = sets.get(visit.id);
      return photos === undefined ? [] : [{ visit_id: visit.id, date: visit.date, type: visit.type, photos }];
    });
    const tryOns = await clientTryOns(c.env.DB, session.subjectId, signingKey, now);
    return c.json({ visits, try_ons: tryOns }, 200);
  });

  app.openapi(compareRoute, async (c) => {
    const session = clientOf(c);
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
    const session = clientOf(c);
    const photoId = await verifyToken(
      c.var.config.settings.tryon.linkSigningKey,
      "photo",
      c.req.valid("param").token,
      c.var.deps.now(),
    );
    const photo = photoId === null ? null : await ownPhotoKey(c.env.DB, session.subjectId, photoId);
    const object = photo === null ? null : await c.env.CLIENT_PHOTOS.get(photo.key);
    if (photo === null || object === null) return c.json(errorBody("not_found", c.var.requestId), 404);
    return imageResponse(object.body, photo.contentType);
  });

  app.openapi(photoSmallRoute, async (c) => {
    const session = clientOf(c);
    const photoId = await verifyToken(
      c.var.config.settings.tryon.linkSigningKey,
      "photo_small",
      c.req.valid("param").token,
      c.var.deps.now(),
    );
    const photo = photoId === null ? null : await ownPhotoKey(c.env.DB, session.subjectId, photoId);
    if (photo === null) return c.json(errorBody("not_found", c.var.requestId), 404);
    const small = photo.thumbnailKey === null ? null : await c.env.CLIENT_PHOTOS.get(photo.thumbnailKey);
    if (small !== null) return imageResponse(small.body, "image/jpeg");
    const whole = await c.env.CLIENT_PHOTOS.get(photo.key);
    if (whole === null) return c.json(errorBody("not_found", c.var.requestId), 404);
    return imageResponse(whole.body, photo.contentType);
  });

  registerTryOnImages(app);
}

const imageResponse = (body: ReadableStream, contentType: string) =>
  new Response(body, { headers: { "Content-Type": contentType, "Cache-Control": "private, max-age=900" } });

/** A try-on's photograph or look, through a link signed and checked against the session as a visit's photograph is. */
function registerTryOnImages(app: App): void {
  app.openapi(tryOnFileRoute, async (c) => {
    const session = clientOf(c);
    const { image, token } = c.req.valid("param");
    const { deps, requestId } = c.var;
    const { tryon } = c.var.config.settings;
    const now = deps.now();
    const jobId = await verifyToken(tryon.linkSigningKey, TRY_ON_TOKEN_PURPOSES[image], token, now);
    const held = jobId === null ? null : await ownTryOnImage(c.env.DB, session.subjectId, jobId, image, now);
    if (held === null) return c.json(errorBody("not_found", requestId), 404);

    // Counted as the site's result links are, so every read of the try-on's buckets stays under a ceiling (ADR 0014).
    if (!(await takeFromCeiling(c.env.DB, "result_read", tryon.resultReadDailyCeiling, now))) {
      await alertCeilingReached(c.env.DB, deps.alert, "result_read", tryon.resultReadDailyCeiling, now);
      return c.json(errorBody("busy", requestId), 503);
    }
    const object = await c.env[held.bucket].get(held.key);
    if (object === null) return c.json(errorBody("not_found", requestId), 404);
    // Each bucket holds only JPEG and PNG, each checked on its way in (src/domain/photo.ts, src/queues/render.ts).
    const type: ImageType = object.httpMetadata?.contentType === "image/png" ? "image/png" : "image/jpeg";
    // The app names the download the same, less the extension, which only the file's type gives.
    const filename = `mane-man-${held.madeOn}-try-on-${image}.${fileExtension(type)}`;
    return new Response(object.body, {
      headers: {
        "Content-Type": type,
        "Content-Disposition": `inline; filename="${filename}"`,
        "Cache-Control": "private, max-age=900",
      },
    });
  });
}
