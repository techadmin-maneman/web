// Where a visitor to the site came from, as the page saw it (docs/decisions/0288-attribution-and-conversions.md): the
// campaign's tags, the ad's click, Meta's cookies, the page before and the one they landed on, any code of ours the
// landing carried, and their answer to the cookie bar. /book sends it with its first step and with what it books, and
// every page with a new campaign's landing (src/routes/public/visits.ts).

import { z } from "@hono/zod-openapi";

const tag = z.string().max(200).optional();
const clickId = z.string().max(500).optional();

export const TouchSchema = z
  .object({
    utm_source: tag,
    utm_medium: tag,
    utm_campaign: tag,
    utm_content: tag,
    utm_term: tag,
    gclid: clickId,
    gbraid: clickId,
    wbraid: clickId,
    fbclid: clickId,
    fbc: clickId.openapi({ description: "Meta's _fbc cookie, as the browser had it." }),
    fbp: clickId.openapi({ description: "Meta's _fbp cookie, as the browser had it." }),
    referrer: z.string().max(500).optional(),
    landing_path: z.string().max(500).optional(),
    ref: z.string().max(20).optional().openapi({ description: "A friend's or a partner's code, from ?ref." }),
    soc: z.string().max(20).optional().openapi({ description: "A society activation's code, from its link." }),
    offer: z.string().max(20).optional().openapi({ description: "An offer link's code." }),
    ad_consent: z
      .enum(["granted", "denied"])
      .optional()
      .openapi({ description: "The visitor's answer to the cookie bar; none while they have not answered." }),
  })
  .strict()
  .openapi("Attribution");

export type TouchBody = z.infer<typeof TouchSchema>;

export const AttributionSchema = TouchSchema.optional();
