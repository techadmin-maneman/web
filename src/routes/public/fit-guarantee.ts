// How long the fit guarantee runs, as ops set it in the console (docs/decisions/0256-fit-guarantee-setting.md).
// mm-site's Worker writes it into the terms, as it writes the referral reward into /book.

import { createRoute, z } from "@hono/zod-openapi";
import type { App } from "../../http/context.ts";
import { opsInputs } from "../../http/ops-inputs.ts";

const FitGuaranteeSchema = z
  .object({
    days: z
      .number()
      .int()
      .openapi({ description: "Days after a first fit in which the client may ask for a refit or a refund." }),
  })
  .strict()
  .openapi("FitGuarantee");

const fitGuaranteeRoute = createRoute({
  method: "get",
  path: "/api/fit-guarantee",
  summary: "How long the fit guarantee runs, as ops set it. Cacheable for a minute.",
  responses: {
    200: { description: "The guarantee", content: { "application/json": { schema: FitGuaranteeSchema } } },
  },
});

export function registerFitGuarantee(app: App): void {
  app.openapi(fitGuaranteeRoute, async (c) => {
    const days = (await opsInputs(c)).guaranteeDays;
    return c.json({ days }, 200, { "Cache-Control": "public, max-age=60" });
  });
}
