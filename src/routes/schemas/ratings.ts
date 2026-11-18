// A client's rating of a visit done (docs/decisions/0260-ratings.md), as the rating route answers it and the visit's
// page reads it.

import { z } from "@hono/zod-openapi";
import { STARS_MAX, STARS_MIN } from "../../policy/ratings.ts";

export const RatingSchema = z
  .object({
    stars: z.number().int().min(STARS_MIN).max(STARS_MAX),
    at: z.iso.datetime().openapi({ description: "When the client gave it." }),
    low: z.boolean().openapi({ description: "Under the stars Care call about (ratings.low_below) when given." }),
  })
  .strict()
  .openapi("Rating");
