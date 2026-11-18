// A client's service-visit credits, as Home and Refer both say them (src/routes/client/me.ts, src/routes/client/refer.ts).

import { z } from "@hono/zod-openapi";
import type { Balance } from "../../domain/money/credits.ts";

export const CreditsSchema = z
  .object({
    visits: z.number().int().openapi({ description: "Service-visit credits left." }),
    earliest_expiry: z.union([z.iso.datetime(), z.null()]).openapi({ description: "When the soonest expire." }),
    expiring_visits: z.number().int().openapi({ description: "How many of them expire then." }),
  })
  .strict()
  .openapi("Credits");

export const creditsBody = (balance: Balance): z.infer<typeof CreditsSchema> => ({
  visits: balance.visits,
  earliest_expiry: balance.earliestExpiry,
  expiring_visits: balance.expiringFirst,
});
