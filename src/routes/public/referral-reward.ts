// What a referral earns now, as ops set it in the console (docs/decisions/0107-referral-rewards-in-the-console.md).
// mm-site's Worker writes it into the invite's page and /book, as it writes the prices, and the landing's island
// asks for it itself where the Worker could not (docs/decisions/0073-prices-from-the-price-book.md).

import { createRoute, z } from "@hono/zod-openapi";
import type { App } from "../../http/context.ts";
import { opsInputs } from "../../http/ops-inputs.ts";
import { ReferralRewardSchema } from "../schemas/referral-reward.ts";

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
