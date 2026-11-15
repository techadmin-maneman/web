// The photographs a client sent with their reports (src/domain/care/report-photos.ts;
// docs/decisions/0258-the-issue-log.md), as Care read them beside the client's chat: the list, and each one, never
// cached.

import { z } from "@hono/zod-openapi";
import { photosOfChat, reportPhotoFile } from "../../domain/care/report-photos.ts";
import type { App } from "../../http/context.ts";
import { errorResponse, refuse } from "../../http/errors.ts";
import { json } from "../../http/openapi.ts";
import { opsRoute } from "../../http/session-routes.ts";

const ReportPhotoSchema = z
  .object({
    report_id: z.string(),
    reference: z.string().openapi({ description: "The report's reference, as MM-ISS-0032." }),
    n: z.number().int(),
    at: z.iso.datetime(),
  })
  .strict()
  .openapi("ReportPhoto");

const listRoute = opsRoute({
  method: "get",
  path: "/api/conversations/{id}/report-photos",
  summary: "The photographs of the reports a client's chat holds, oldest report first",
  request: { params: z.object({ id: z.uuid() }) },
  responses: {
    200: {
      description: "The photographs",
      ...json(
        z
          .object({ photos: z.array(ReportPhotoSchema) })
          .strict()
          .openapi("ReportPhotos"),
      ),
    },
  },
});

const fileRoute = opsRoute({
  method: "get",
  path: "/api/conversations/{id}/report-photos/{report_id}/{n}",
  summary: "One photograph of a report the chat holds, never cached",
  request: {
    params: z.object({ id: z.uuid(), report_id: z.uuid(), n: z.coerce.number().int().min(1).max(3) }),
  },
  responses: {
    200: { description: "The image", content: { "image/jpeg": { schema: z.string() } } },
    404: errorResponse("not_found: no such photograph in this chat"),
  },
});

export function registerOpsReportPhotos(app: App): void {
  app.openapi(listRoute, async (c) => c.json({ photos: await photosOfChat(c.env.DB, c.req.valid("param").id) }, 200));

  app.openapi(fileRoute, async (c) => {
    const { id, report_id: reportId, n } = c.req.valid("param");
    const photo = await reportPhotoFile(c.env.DB, c.env.CLIENT_PHOTOS, { conversationId: id, reportId, n });
    if (photo === null) return refuse(c, "not_found");
    return new Response(photo.body, {
      headers: { "Content-Type": "image/jpeg", "Cache-Control": "private, no-store" },
    });
  });
}
