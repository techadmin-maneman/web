// A client's photographs in the console (./clients.ts): which exist, by visit; opening them, which is logged; and one
// photograph, served only within a logged opening (docs/decisions/0031-access-and-audit.md).

import { createRoute, z } from "@hono/zod-openapi";
import { VISIT_TYPES } from "../../config/visit-types.ts";
import { PHOTO_VIEW_MINUTES, earlierViews, logPhotoView, viewInForce } from "../../domain/field/photo-views.ts";
import { ANGLES, PHASES } from "../../domain/field/visit-photos.ts";
import { ownPhotoKey } from "../../domain/visits/client-visits.ts";
import { actorOf } from "../../http/audit.ts";
import type { App } from "../../http/context.ts";
import { errorResponse, refuse } from "../../http/errors.ts";
import { json } from "../../http/openapi.ts";
import { clientInReach } from "../../http/staff-access.ts";
import { indiaDate } from "../../lib/india-time.ts";
import { clientId, unknownClient } from "../schemas/clients.ts";

const PhotoSchema = z
  .object({
    id: z.uuid().openapi({ description: "For GET /api/clients/{id}/photos/{photo_id}, which is audited." }),
    phase: z.enum(PHASES),
    angle: z.enum(ANGLES),
    width: z.union([z.number().int(), z.null()]),
    height: z.union([z.number().int(), z.null()]),
    taken_at: z.iso.datetime(),
  })
  .strict()
  .openapi("ClientPhoto");

const ClientPhotosSchema = z
  .object({
    visits: z.array(
      z
        .object({
          visit_id: z.uuid(),
          date: z.iso.date(),
          type: z.union([z.enum(VISIT_TYPES), z.null()]),
          technician: z.union([z.object({ name: z.string(), initials: z.string() }).strict(), z.null()]),
          photos: z.array(PhotoSchema).openapi({ description: "Before then after, each in the design's angle order." }),
        })
        .strict(),
    ),
  })
  .strict()
  .openapi("ClientPhotos");

interface PhotoListRow {
  id: string;
  appointment_id: string;
  window_start: string;
  type: (typeof VISIT_TYPES)[number] | null;
  technician_name: string | null;
  technician_initials: string | null;
  phase: (typeof PHASES)[number];
  angle: (typeof ANGLES)[number];
  width: number | null;
  height: number | null;
  taken_at: string;
}

const photoOf = (row: PhotoListRow) => ({
  id: row.id,
  phase: row.phase,
  angle: row.angle,
  width: row.width,
  height: row.height,
  taken_at: row.taken_at,
});

const photosRoute = createRoute({
  method: "get",
  path: "/api/clients/{id}/photos",
  summary: "Which photographs the client has, by visit, newest first. No image is served here",
  request: { params: clientId },
  responses: { 200: { description: "Visits that have photographs", ...json(ClientPhotosSchema) }, 404: unknownClient },
});

const viewRoute = createRoute({
  method: "post",
  path: "/api/clients/{id}/photos/view",
  summary: "Open the client's photographs: one audit entry, written before any image is served",
  request: { params: clientId },
  responses: {
    200: {
      description: "Logged",
      ...json(
        z
          .object({
            logged_at: z.iso.datetime().openapi({ description: "When the opening was logged, by our clock." }),
            before: z
              .array(z.object({ by: z.string(), at: z.iso.datetime() }).strict())
              .openapi({ description: "Who opened them before, and when, the latest first." }),
          })
          .strict()
          .openapi("PhotoView"),
      ),
    },
    404: unknownClient,
    503: errorResponse("unavailable: the opening could not be logged, so nothing is shown"),
  },
});

const photoRoute = createRoute({
  method: "get",
  path: "/api/clients/{id}/photos/{photo_id}",
  summary: `One of the client's photographs, within an opening logged in the last ${String(PHOTO_VIEW_MINUTES)} minutes; asked for outside one, it logs one first`,
  request: { params: clientId.extend({ photo_id: z.uuid() }) },
  responses: {
    200: {
      description: "The image",
      content: { "image/jpeg": { schema: z.string() }, "image/png": { schema: z.string() } },
    },
    404: errorResponse("not_found: no such photograph of this client's"),
    503: errorResponse("unavailable: the view could not be audited, so no photograph is served"),
  },
});

export function registerOpsClientPhotos(app: App): void {
  app.openapi(photosRoute, async (c) => {
    const { id } = c.req.valid("param");
    const db = c.env.DB;
    if ((await clientInReach(c, id)) === null) return refuse(c, "not_found");

    const { results } = await db
      .prepare(
        `SELECT p.id, s.appointment_id, s.phase, p.angle, p.width, p.height, p.taken_at,
           a.window_start, a.type, t.name AS technician_name, t.initials AS technician_initials
         FROM photos p
         JOIN photo_sets s ON s.id = p.photo_set_id
         JOIN appointments a ON a.id = s.appointment_id
         LEFT JOIN technicians t ON t.id = a.technician_id
         WHERE a.person_id = ?1 AND a.deleted_at IS NULL AND a.window_start IS NOT NULL
         ORDER BY a.window_start DESC`,
      )
      .bind(id)
      .all<PhotoListRow>();

    // The rows arrive newest visit first; each visit keeps that order, and its
    // photographs are sorted before then after, each in the design's angle order.
    const byVisit = new Map<string, { visit: PhotoListRow; photos: PhotoListRow[] }>();
    for (const row of results) {
      const group = byVisit.get(row.appointment_id) ?? { visit: row, photos: [] };
      group.photos.push(row);
      byVisit.set(row.appointment_id, group);
    }
    const order = (row: PhotoListRow) => PHASES.indexOf(row.phase) * ANGLES.length + ANGLES.indexOf(row.angle);

    return c.json(
      {
        visits: [...byVisit.values()].map(({ visit, photos }) => ({
          visit_id: visit.appointment_id,
          date: indiaDate(new Date(visit.window_start)),
          type: visit.type,
          technician:
            visit.technician_name === null || visit.technician_initials === null
              ? null
              : { name: visit.technician_name, initials: visit.technician_initials },
          photos: photos.sort((a, b) => order(a) - order(b)).map(photoOf),
        })),
      },
      200,
    );
  });

  app.openapi(viewRoute, async (c) => {
    const { id } = c.req.valid("param");
    const db = c.env.DB;
    if ((await clientInReach(c, id)) === null) return refuse(c, "not_found");
    const now = c.var.deps.now();
    try {
      await logPhotoView(db, { personId: id, actor: actorOf(c), requestId: c.var.requestId, now });
    } catch (error) {
      c.var.log.error("audit_write_failed", { action: "photo.view", error });
      return refuse(c, "unavailable");
    }
    return c.json({ logged_at: now.toISOString(), before: await earlierViews(db, id, now) }, 200);
  });

  app.openapi(photoRoute, async (c) => {
    const { id, photo_id: photoId } = c.req.valid("param");
    const db = c.env.DB;
    if ((await clientInReach(c, id)) === null) return refuse(c, "not_found");
    // The same lookup the client's own photographs go through: a photograph of
    // anyone else is not found, whatever ID is asked for.
    const photo = await ownPhotoKey(db, id, photoId);
    if (photo === null) return refuse(c, "not_found");

    // Within an opening already logged, the image goes; outside one, the opening
    // is logged first, and a failure serves no photograph (ADR 0031).
    const staff = actorOf(c);
    const now = c.var.deps.now();
    if (!(await viewInForce(db, id, staff, now))) {
      try {
        await logPhotoView(db, { personId: id, actor: staff, requestId: c.var.requestId, now });
      } catch (error) {
        c.var.log.error("audit_write_failed", { action: "photo.view", error });
        return refuse(c, "unavailable");
      }
    }

    const object = await c.env.CLIENT_PHOTOS.get(photo.key);
    if (object === null) return refuse(c, "not_found");
    return new Response(object.body, {
      headers: { "Content-Type": photo.contentType, "Cache-Control": "private, no-store" },
    });
  });
}
