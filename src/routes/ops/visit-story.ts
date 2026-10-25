// What happened on a visit, step by step, for its drawer on the dispatch board, behind Access (Operations · View).
//
// It keeps to the caller's cities: a visit elsewhere is answered as one that does not exist.

import { opsRoute } from "../../http/session-routes.ts";
import { z } from "@hono/zod-openapi";
import { visitStory } from "../../domain/visits/visit-story.ts";
import type { App } from "../../http/context.ts";
import { errorResponse, refuse } from "../../http/errors.ts";
import { json } from "../../http/openapi.ts";
import { withinRouteReach } from "../../http/staff-access.ts";
import { JOB_EVENT_KINDS } from "../../policy/in-job-steps.ts";

const StorySchema = z
  .object({
    steps: z.array(
      z
        .object({
          kind: z.enum(JOB_EVENT_KINDS),
          at: z.iso.datetime().openapi({ description: "The phone's clock when the step was taken." }),
          technician: z.union([z.string(), z.null()]),
          outcome: z.union([z.string(), z.null()]).openapi({
            description: 'How the visit ended, on its outcome step: "done", "partial", "no_show"; else null.',
          }),
          door: z
            .union([
              z.object({ case_id: z.uuid(), note: z.union([z.string(), z.null()]), photo: z.boolean() }).strict(),
              z.null(),
            ])
            .openapi({
              description:
                "On a no-show's outcome, its case, and the note and photograph of the door it was closed with; " +
                "the photograph is GET /api/no-shows/{id}/door-photo. Null on every other step.",
            }),
        })
        .strict(),
    ),
  })
  .strict()
  .openapi("VisitStory");

const storyRoute = opsRoute({
  method: "get",
  path: "/api/visits/{id}/story",
  summary: "What happened on a visit: each step the technician's phone landed, in order, and how it ended",
  request: { params: z.object({ id: z.uuid() }) },
  responses: {
    200: { description: "The steps, the first taken first; none before the technician arrives", ...json(StorySchema) },
    404: errorResponse("not_found: no visit by this id in the caller's cities"),
  },
});

export function registerOpsVisitStory(app: App): void {
  app.openapi(storyRoute, async (c) => {
    const visitId = c.req.valid("param").id;
    if (!(await withinRouteReach(c, "visit", visitId))) return refuse(c, "not_found");
    const steps = await visitStory(c.env.DB, visitId);
    if (steps === null) return refuse(c, "not_found");
    return c.json({ steps }, 200);
  });
}
