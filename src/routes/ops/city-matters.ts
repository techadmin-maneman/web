// A matter sent from a chat to its client's city, behind Access (Customer Care Act; docs/decisions/0135-city-matters.md):
// The city closes it from Tasks, with what was done (POST /api/tasks/city_matter/:id/close).

import { createRoute, z } from "@hono/zod-openapi";
import type { App } from "../../http/context.ts";
import { errorResponse, refuse } from "../../http/errors.ts";
import { json } from "../../http/openapi.ts";
import { actorOf } from "../../http/audit.ts";
import { raiseCityMatter } from "../../domain/care/city-matters.ts";
import { REASON_MAX_CHARS } from "../../policy/decision-reasons.ts";

const raiseRoute = createRoute({
  method: "post",
  path: "/api/conversations/{id}/city-matter",
  summary: "Send a matter from a chat to its client's city, as a City matter on their Tasks",
  request: {
    params: z.object({ id: z.uuid() }),
    body: {
      required: true,
      ...json(
        z
          .object({
            note: z.string().trim().min(1).max(REASON_MAX_CHARS).openapi({
              description: "What the city team need to know, in Care's words; blanked if the client is erased.",
            }),
          })
          .strict()
          .openapi("CityMatter"),
      ),
    },
  },
  responses: {
    200: { description: "Sent, and to which city", ...json(z.object({ city: z.string() }).strict()) },
    400: errorResponse("invalid_request: fields names city when we know no city for the client"),
    403: errorResponse("access_required"),
    404: errorResponse("not_found: no such chat, a number we don't know, or an erased client"),
  },
});

export function registerOpsCityMatters(app: App): void {
  app.openapi(raiseRoute, async (c) => {
    const raised = await raiseCityMatter(c.env.DB, {
      conversationId: c.req.valid("param").id,
      note: c.req.valid("json").note,
      actor: actorOf(c),
      requestId: c.var.requestId,
      now: c.var.deps.now(),
    });
    if (raised === "not_found") return refuse(c, "not_found");
    if (raised === "no_city") return refuse(c, "invalid_request", ["city"]);
    return c.json(raised, 200);
  });
}
