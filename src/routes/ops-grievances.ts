// Ops' side of grievances (docs/decisions/0049-dpdp.md), on the ops surface behind Access:
//   GET  /api/grievances               open grievances, oldest first, with who raised them
//   POST /api/grievances/:id/resolve   the answer ops gave, which closes it
// Each answer is audited under the member of staff who gave it.

import { createRoute, z } from "@hono/zod-openapi";
import type { App } from "../app.ts";
import { actorOf, recordAudit } from "../domain/audit.ts";
import { errorBody, errorResponse } from "../http/errors.ts";

const json = <T extends z.ZodType>(schema: T) => ({ content: { "application/json": { schema } } });

const openRoute = createRoute({
  method: "get",
  path: "/api/grievances",
  summary: "Open grievances, oldest first",
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
    404: errorResponse("not_found: no open grievance by that ID"),
  },
});

export function registerOpsGrievances(app: App): void {
  app.openapi(openRoute, async (c) => {
    const { results } = await c.env.DB.prepare(
      `SELECT g.id, g.person_id, p.name, p.mobile_e164, g.text, g.created_at FROM grievances g
       JOIN people p ON p.id = g.person_id WHERE g.state = 'open' ORDER BY g.created_at`,
    ).all<{ id: string; person_id: string; name: string; mobile_e164: string; text: string; created_at: string }>();
    return c.json(
      {
        grievances: results.map((row) => ({
          id: row.id,
          person_id: row.person_id,
          name: row.name,
          mobile: row.mobile_e164,
          text: row.text,
          raised_at: row.created_at,
        })),
      },
      200,
    );
  });

  app.openapi(resolveRoute, async (c) => {
    const { id } = c.req.valid("param");
    const identity = c.var.accessIdentity;
    if (identity === undefined) throw new Error("ops routes run after requireAccess");
    const staff = actorOf(identity);
    const now = c.var.deps.now();
    const closed = await c.env.DB.prepare(
      `UPDATE grievances SET state = 'resolved', response = ?2, resolved_by = ?3, resolved_at = ?4
       WHERE id = ?1 AND state = 'open' RETURNING id`,
    )
      .bind(id, c.req.valid("json").response, staff.id, now.toISOString())
      .first();
    if (closed === null) return c.json(errorBody("not_found", c.var.requestId), 404);
    await recordAudit(
      c.env.DB,
      {
        surface: "ops",
        actor: staff,
        action: "grievance.resolve",
        subject: { kind: "grievance", id },
        requestId: c.var.requestId,
      },
      now,
    );
    return c.json({ state: "resolved" as const }, 200);
  });
}
