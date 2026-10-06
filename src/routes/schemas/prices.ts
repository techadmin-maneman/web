// A row of the price book as the console reads it (src/routes/ops/prices.ts, services.ts).

import { z } from "@hono/zod-openapi";
import { PRICE_ITEMS } from "../../domain/money/price-book.ts";

export const PriceRowSchema = z
  .object({
    item: z.enum(PRICE_ITEMS),
    tier: z.string(),
    amount_ex_gst: z.number().int().openapi({ description: "In paise, before GST." }),
    gst_percent: z.number().int(),
    valid_from: z.iso.date().openapi({ description: "India's date it applies from." }),
    in_force: z.boolean(),
  })
  .strict()
  .openapi("Price");
