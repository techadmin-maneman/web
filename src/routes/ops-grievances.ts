// Ops' side of grievances (docs/decisions/0049-dpdp.md), on the ops surface behind Access:
//   GET  /api/grievances               open grievances, oldest first, with who raised them
//   POST /api/grievances/:id/resolve   the answer ops gave, which closes it
// Each answer is audited under the member of staff who gave it. Both keep to the caller's cities.

import { createRoute, z } from "@hono/zod-openapi";
import { actorOf } from "../http/audit.ts";
import type { App } from "../http/context.ts";
import { auditStatement } from "../domain/audit.ts";
import { reachBinding, withinReach } from "../domain/places.ts";
import { errorResponse, refuse } from "../http/errors.ts";
import { json } from "../http/openapi.ts";
import { opsInputs } from "../http/ops-inputs.ts";
import { routeReach, withinRouteReach } from "../http/staff-access.ts";
import { dueAt } from "../policy/tasks.ts";

const openRoute = createRoute({
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
          })
          .strict(),
      ),
    },
  },
});

const resolveRoute = createRoute({
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
    const reached = await routeReach(c);
    const { results } = await c.env.DB.prepare(
      `SELECT g.id, g.person_id, p.name, p.mobile_e164, g.text, g.created_at FROM grievances g
       JOIN people p ON p.id = g.person_id
       WHERE g.state = 'open' AND p.erased_at IS NULL AND ${withinReach("grievance", "g", "?1")}
       ORDER BY g.created_at`,
    )
      .bind(reachBinding(reached))
      .all<{ id: string; person_id: string; name: string; mobile_e164: string; text: string; created_at: string }>();
    const sla = (await opsInputs(c)).taskSlaHours;
    return c.json(
      {
        grievances: results.map((row) => ({
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
    const staff = actorOf(c);
    const now = c.var.deps.now();
    const db = c.env.DB;
    const open = await db.prepare("SELECT 1 FROM grievances WHERE id = ?1 AND state = 'open'").bind(id).first();
    if (open === null || !(await withinRouteReach(c, "grievance", id))) {
      return refuse(c, "not_found");
    }
    // The answer and its audit entry, together or not at all (src/domain/audit.ts).
    await db.batch([
      db
        .prepare(
          `UPDATE grievances SET state = 'resolved', response = ?2, resolved_by = ?3, resolved_at = ?4
           WHERE id = ?1 AND state = 'open'`,
        )
        .bind(id, c.req.valid("json").response, staff.id, now.toISOString()),
      auditStatement(
        db,
        {
          surface: "ops",
          actor: staff,
          action: "grievance.resolve",
          subject: { kind: "grievance", id },
          requestId: c.var.requestId,
        },
        now,
      ),
    ]);
    return c.json({ state: "resolved" as const }, 200);
  });
}
