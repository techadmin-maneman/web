// What a referral earns now, as the site, the invite and Home say it (docs/decisions/0107-referral-rewards-in-the-console.md).

import { z } from "@hono/zod-openapi";

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
