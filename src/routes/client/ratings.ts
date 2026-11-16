// The client rates a visit done (docs/decisions/0260-ratings.md): one to five stars, once, on a visit of theirs that
// closed with something done. Under four opens a Care task on Tasks.

import { z } from "@hono/zod-openapi";
import { rateVisit, type RatingRefusal } from "../../domain/visits/ratings.ts";
import { clientOf } from "../../http/client-session.ts";
import type { App } from "../../http/context.ts";
import { errorResponse, refuse } from "../../http/errors.ts";
import { json } from "../../http/openapi.ts";
import { clientRoute } from "../../http/session-routes.ts";
import { STARS_MAX, STARS_MIN } from "../../policy/ratings.ts";
import { RatingSchema } from "../schemas/ratings.ts";

const rateRoute = clientRoute({
  method: "post",
  path: "/api/visits/{id}/rating",
  summary: "Rate a visit done, once",
  request: {
    params: z.object({ id: z.uuid().openapi({ description: "The visit's ID." }) }),
    body: {
      required: true,
      ...json(
        z
          .object({ stars: z.number().int().min(STARS_MIN).max(STARS_MAX) })
          .strict()
          .openapi("RateVisit"),
      ),
    },
  },
  responses: {
    201: { description: "Kept; under four, Care call the client", ...json(RatingSchema) },
    400: errorResponse("invalid_request: see error.fields"),
    401: errorResponse("session_required"),
    404: errorResponse("not_found: no such visit of this client's"),
    409: errorResponse("already_rated: the visit has its rating; visit_not_done: not closed, or nothing was done"),
  },
});

const REFUSALS: Readonly<Record<Exclude<RatingRefusal, "not_found">, "already_rated" | "visit_not_done">> = {
  rated: "already_rated",
  not_done: "visit_not_done",
};

export function registerClientRatings(app: App): void {
  app.openapi(rateRoute, async (c) => {
    const rated = await rateVisit(c.env.DB, {
      personId: clientOf(c).subjectId,
      visitId: c.req.valid("param").id,
      stars: c.req.valid("json").stars,
      now: c.var.deps.now(),
    });
    if (rated === "not_found") return refuse(c, "not_found");
    return typeof rated === "string" ? refuse(c, REFUSALS[rated]) : c.json(rated, 201);
  });
}
