// Ops' side of grievances (docs/decisions/0049-dpdp.md), on the ops surface behind Access:
// Each answer is audited under the member of staff who gave it. Both keep to the caller's cities.

import { opsRoute } from "../../http/session-routes.ts";
import { z } from "@hono/zod-openapi";
import { written } from "../../http/audit.ts";
import type { App } from "../../http/context.ts";
import { errorResponse, refuse } from "../../http/errors.ts";
import { json } from "../../http/openapi.ts";
import { capped, More } from "../../http/paging.ts";
import { opsInputs } from "../../http/ops-inputs.ts";
import { queueMessage } from "../../http/queue-message.ts";
import { openGrievances, resolveGrievance } from "../../domain/ops/grievances.ts";
import { routeReach, withinRouteReach } from "../../http/staff-access.ts";
import { dueAt } from "../../policy/tasks.ts";

/** As many open grievances as the page can usefully hold, the oldest first. */
const LIMIT = 200;

const openRoute = opsRoute({
  method: "get",
  path: "/api/grievances",
  summary: "Open grievances in the caller's cities, oldest first, as Tasks counts them: none of an erased client's",
  responses: {
    200: {
      description: "Open grievances",
      ...json(
        z
          .object({
            grievances: z.array(
              z
                .object({
                  id: z.uuid(),
                  person_id: z.string(),
                  name: z.string(),
                  mobile: z.string(),
                  text: z.string(),
                  raised_at: z.iso.datetime(),
                  due: z.iso.datetime().openapi({
                    description:
                      "When ops should have answered: the Tasks board's allowance for a grievance, the 30 days the app promises until ops set another.",
                  }),
                })
                .strict(),
            ),
            more: More(LIMIT),
          })
          .strict(),
      ),
    },
  },
});

const resolveRoute = opsRoute({
  method: "post",
  path: "/api/grievances/{id}/resolve",
  summary: "Record ops' answer to a grievance, and close it",
  request: {
    params: z.object({ id: z.uuid() }),
    body: {
      required: true,
      ...json(
        z
          .object({ response: z.string().trim().min(1).max(2000) })
          .strict()
          .openapi("GrievanceAnswer"),
      ),
    },
  },
  responses: {
    200: { description: "Closed", ...json(z.object({ state: z.literal("resolved") }).strict()) },
    404: errorResponse("not_found: no open grievance by that ID in the caller's cities"),
  },
});

export function registerOpsGrievances(app: App): void {
  app.openapi(openRoute, async (c) => {
    const results = await openGrievances(c.env.DB, await routeReach(c), LIMIT + 1);
    const sla = (await opsInputs(c)).taskSlaHours;
    const { rows, more } = capped(results, LIMIT);
    return c.json(
      {
        more,
        grievances: rows.map((row) => ({
          id: row.id,
          person_id: row.person_id,
          name: row.name,
          mobile: row.mobile_e164,
          text: row.text,
          raised_at: row.created_at,
          due: dueAt(new Date(row.created_at), "grievance", sla).toISOString(),
        })),
      },
      200,
    );
  });

  app.openapi(resolveRoute, async (c) => {
    const { id } = c.req.valid("param");
    if (!(await withinRouteReach(c, "grievance", id))) return refuse(c, "not_found");
    const told = await resolveGrievance(c.env.DB, { id, response: c.req.valid("json").response }, written(c));
    if (told === null) return refuse(c, "not_found");
    await queueMessage(c, told);
    return c.json({ state: "resolved" as const }, 200);
  });
}
