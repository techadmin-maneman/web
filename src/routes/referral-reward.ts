// What a referral earns now, as ops set it in the console (docs/decisions/0107-referral-rewards-in-the-console.md).
// mm-site's Worker writes it into the invite's page and /book, as it writes the prices, and the landing's island
// asks for it itself where the Worker could not (docs/decisions/0073-prices-from-the-price-book.md).
//
//   GET /api/referral-reward    each side's free service visits and how long they last

import { createRoute, z } from "@hono/zod-openapi";
import type { App } from "../http/context.ts";
import { opsInputs } from "../http/ops-inputs.ts";

export const ReferralRewardSchema = z
  .object({
    referrer_visits: z
      .number()
      .int()
      .openapi({ description: "The free service visits the client who sent the invite gets; 0 for none." }),
    friend_visits: z
      .number()
      .int()
      .openapi({ description: "The free service visits the friend they invited gets; 0 for none." }),
    valid_days: z.number().int().openapi({ description: "How many days the credits last from the grant." }),
  })
  .strict()
  .openapi("ReferralReward", {
    description:
      "What each side is given when a friend's first fit is done, as it stands now. A grant is given what is in " +
      "force when the friend is fitted, and keeps it.",
  });

const referralRewardRoute = createRoute({
  method: "get",
  path: "/api/referral-reward",
  summary: "What a referral earns now, as ops set it. Cacheable for a minute.",
  responses: {
    200: { description: "The reward", content: { "application/json": { schema: ReferralRewardSchema } } },
  },
});

export function registerReferralReward(app: App): void {
  app.openapi(referralRewardRoute, async (c) => {
    const reward = (await opsInputs(c)).referralReward;
    return c.json(reward, 200, { "Cache-Control": "public, max-age=60" });
  });
}
