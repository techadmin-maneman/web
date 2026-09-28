// What Phase 2's photographs and referral cards hold in R2, behind Access
// (docs/decisions/0093-the-storage-meter.md):
//   GET /api/storage    the storage meter's figure, beside the share and the runaway ceiling
//
// Settings shows it, so ops can see how near the share is before the alerts
// at 50% and 80% tell them. It reads one row, never the buckets.

import { createRoute, z } from "@hono/zod-openapi";
import type { App } from "../http/context.ts";
import { errorResponse } from "../http/errors.ts";
import { json } from "../http/openapi.ts";
import { readMeter } from "../domain/storage-meter.ts";
import { PHASE_2_SHARE_BYTES, RUNAWAY_CEILING_BYTES } from "../policy/storage-share.ts";

const StorageSchema = z
  .object({
    held_bytes: z.number().int().openapi({ description: "What the client-photos and referral-cards buckets hold." }),
    share_bytes: z.number().int().openapi({
      description: "Phase 2's share of R2's free 10 GB (ADR 0039); past it R2 bills, as the owner accepted.",
    }),
    ceiling_bytes: z
      .number()
      .int()
      .openapi({ description: "Past this the technician app's photographs are refused and wait on the phones." }),
  })
  .strict()
  .openapi("Storage");

const storageRoute = createRoute({
  method: "get",
  path: "/api/storage",
  summary: "What the photographs and referral cards hold in R2, against their share",
  responses: {
    200: { description: "The storage meter", ...json(StorageSchema) },
    403: errorResponse("access_required"),
  },
});

export function registerOpsStorage(app: App): void {
  app.openapi(storageRoute, async (c) => {
    const { bytes } = await readMeter(c.env.DB);
    return c.json({ held_bytes: bytes, share_bytes: PHASE_2_SHARE_BYTES, ceiling_bytes: RUNAWAY_CEILING_BYTES }, 200);
  });
}
