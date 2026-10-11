// Where a visitor to the booking forms came from, as the page saw it: the campaign's tags, the ad's click, the page
// before and the one they landed on. /book sends it with its first step and with what it books
// (src/routes/public/lead.ts, src/routes/public/consultations.ts).

import { z } from "@hono/zod-openapi";

export const AttributionSchema = z
  .object({
    utm_source: z.string().max(200).optional(),
    utm_medium: z.string().max(200).optional(),
    utm_campaign: z.string().max(200).optional(),
    utm_content: z.string().max(200).optional(),
    gclid: z.string().max(200).optional(),
    fbclid: z.string().max(200).optional(),
    referrer: z.string().max(500).optional(),
    landing_path: z.string().max(500).optional(),
  })
  .strict()
  .optional();
