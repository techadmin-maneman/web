// Photographs of stock, behind Access (docs/decisions/0170-stock-photos.md):
//   POST /api/stock-photos         a JPEG or PNG the console made small, stored; its ID, for the write that uses it
//   GET  /api/stock-photos/{id}    the photograph
//
// Storing with Operations ACT, reading with VIEW.

import { createRoute, z } from "@hono/zod-openapi";
import { MAX_STOCK_PHOTO_BYTES, stockPhoto, storeStockPhoto } from "../../domain/inventory/stock-photos.ts";
import { mayUpload } from "../../domain/platform/storage-meter.ts";
import { cappedBody } from "../../http/capped-body.ts";
import type { App } from "../../http/context.ts";
import { errorResponse, refuse } from "../../http/errors.ts";
import { json } from "../../http/openapi.ts";

const storeRoute = createRoute({
  method: "post",
  path: "/api/stock-photos",
  summary: "A photograph of stock: the body a JPEG or PNG of at most 2 MB",
  responses: {
    201: {
      description: "Stored",
      ...json(z.object({ photo_id: z.uuid() }).openapi("StockPhotoStored")),
    },
    403: errorResponse("access_required"),
    422: errorResponse("photo_invalid_file: not a JPEG or PNG, or over 2 MB"),
    503: errorResponse("busy: the photographs' storage is past its runaway ceiling"),
  },
});

const readRoute = createRoute({
  method: "get",
  path: "/api/stock-photos/{id}",
  summary: "A photograph of stock, never cached",
  request: { params: z.object({ id: z.uuid() }) },
  responses: {
    200: {
      description: "The image",
      content: { "image/jpeg": { schema: z.string() }, "image/png": { schema: z.string() } },
    },
    403: errorResponse("access_required"),
    404: errorResponse("not_found: no such photograph"),
  },
});

export function registerOpsStockPhotos(app: App): void {
  app.openapi(storeRoute, async (c) => {
    const bytes = await cappedBody(c.req.raw, MAX_STOCK_PHOTO_BYTES);
    if (bytes === null || bytes.byteLength === 0) return refuse(c, "photo_invalid_file");
    const now = c.var.deps.now();
    const uploader = { scope: "photo_upload:stock", key: "stock", now, settings: c.var.config.settings } as const;
    if (!(await mayUpload(c.env.DB, c.var.deps.alertOnce, uploader))) return refuse(c, "busy");
    const id = await storeStockPhoto(c.env.DB, c.env.CLIENT_PHOTOS, bytes);
    if (id === null) return refuse(c, "photo_invalid_file");
    return c.json({ photo_id: id }, 201);
  });

  app.openapi(readRoute, async (c) => {
    const photo = await stockPhoto(c.env.CLIENT_PHOTOS, c.req.valid("param").id);
    if (photo === null) return refuse(c, "not_found");
    return new Response(photo.body, {
      headers: {
        "Content-Type": photo.httpMetadata?.contentType ?? "image/jpeg",
        "Cache-Control": "private, no-store",
      },
    });
  });
}
