// A pincode as the service area lists it, which GET /api/service-area answers and the routes that add pincodes give
// back (src/routes/ops/service-area.ts, src/routes/ops/pincode-directory.ts).

import { z } from "@hono/zod-openapi";

export const AreaSchema = z
  .object({
    pincode: z.string(),
    area: z.string(),
    city: z.string(),
    served: z.boolean(),
    launch_on: z.union([z.iso.date(), z.null()]),
    waiting: z.number().int().openapi({ description: "How many are on its waitlist." }),
    to_alert: z.number().int().openapi({
      description: "How many of them serving it would tell now: those who asked, and have not been told yet.",
    }),
    paused_until: z.union([z.iso.date(), z.null()]).openapi({
      description: "The day a paused pincode takes new clients again; null when it is not paused.",
    }),
  })
  .strict()
  .openapi("ServedPincode");
