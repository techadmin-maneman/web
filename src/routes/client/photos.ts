// The client app's photographs (./visits.ts): the timeline, two visits compared, and each photograph, its small
// copy and a try-on's image, served through a signed link that lasts 15 minutes, to the client whose it is.

import { z } from "@hono/zod-openapi";
import { VISIT_TYPES } from "../../config/visit-types.ts";
import { ANGLES, PHASES } from "../../domain/field/visit-photos.ts";
import { takeOne } from "../../domain/sign-in/rate-limit.ts";
import {
  TRY_ON_IMAGES,
  TRY_ON_TOKEN_PURPOSES,
  clientTryOns,
  ownTryOnImage,
} from "../../domain/try-on/client-try-ons.ts";
import { listVisits, ownPhotoKey, photoSets } from "../../domain/visits/client-visits.ts";
import { clientOf } from "../../http/client-session.ts";
import type { App } from "../../http/context.ts";
import { errorResponse, refuse } from "../../http/errors.ts";
import { clientRoute } from "../../http/session-routes.ts";
import { type ImageType, fileExtension } from "../../lib/image-bytes.ts";
import { verifyToken } from "../../lib/signed-token.ts";
import { PhotoLinkSchema, PhotoSetSchema } from "../schemas/visits.ts";

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

const timelineRoute = clientRoute({
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

const compareRoute = clientRoute({
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

const photoFileRoute = clientRoute({
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

const photoSmallRoute = clientRoute({
  method: "get",
  path: "/api/photos/small/{token}",
  summary: "A photograph's small copy, through a link that lasts 15 minutes; the photograph itself if the copy is gone",
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

const tryOnFileRoute = clientRoute({
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
    429: errorResponse("rate_limited: this client's try-on images for today"),
  },
});

export function registerClientPhotos(app: App): void {
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
    if (first === undefined || second === undefined) return refuse(c, "not_found");
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
    if (photo === null || object === null) return refuse(c, "not_found");
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
    if (photo === null) return refuse(c, "not_found");
    const small = photo.thumbnailKey === null ? null : await c.env.CLIENT_PHOTOS.get(photo.thumbnailKey);
    if (small !== null) return imageResponse(small.body, "image/jpeg");
    const whole = await c.env.CLIENT_PHOTOS.get(photo.key);
    if (whole === null) return refuse(c, "not_found");
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
    const { deps } = c.var;
    const { tryon } = c.var.config.settings;
    const now = deps.now();
    const jobId = await verifyToken(tryon.linkSigningKey, TRY_ON_TOKEN_PURPOSES[image], token, now);
    const held =
      jobId === null ? null : await ownTryOnImage({ db: c.env.DB, personId: session.subjectId, jobId, image, now });
    if (held === null) return refuse(c, "not_found");

    if (!(await takeOne(c.env.DB, "tryon_image:person", session.subjectId, { now, settings: c.var.config.settings }))) {
      return refuse(c, "rate_limited");
    }
    const object = await c.env[held.bucket].get(held.key);
    if (object === null) return refuse(c, "not_found");
    // Each bucket holds only JPEG and PNG, each checked on its way in (src/domain/try-on/photo.ts, src/queues/render.ts).
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
