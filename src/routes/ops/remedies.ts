// Remedies, behind Access (Customer Care; docs/decisions/0143-remedies.md):
//   POST /api/clients/:id/remedies      free visits for a client, with why: at once within the limit, else awaiting
//   GET  /api/remedies                  those awaiting a manager, and the last 30 days' given or declined
//   POST /api/remedies/:id/approve      a Customer Care manager's yes, and the visits granted
//   POST /api/remedies/:id/decline      or no

import { createRoute, z } from "@hono/zod-openapi";
import type { Context } from "hono";
import type { App, AppEnv } from "../../http/context.ts";
import { errorResponse, refuse } from "../../http/errors.ts";
import { json } from "../../http/openapi.ts";
import { actorOf } from "../../http/audit.ts";
import { opsInputs } from "../../http/ops-inputs.ts";
import { decideRemedy, giveRemedy, listRemedies } from "../../domain/care/remedies.ts";
import { REASON_MAX_CHARS } from "../../policy/decision-reasons.ts";
import { MOST_REMEDY_VISITS, REMEDY_REASONS } from "../../policy/remedies.ts";

const RemedySchema = z
  .object({
    id: z.uuid(),
    person: z.object({ id: z.uuid(), name: z.string() }).strict(),
    visits: z.number().int(),
    reason: z.enum(REMEDY_REASONS),
    note: z.union([z.string(), z.null()]),
    given_by: z.string(),
    given_at: z.iso.datetime(),
    state: z.enum(["given", "awaiting", "declined"]),
  })
  .strict()
  .openapi("Remedy");

const giveRoute = createRoute({
  method: "post",
  path: "/api/clients/{id}/remedies",
  summary: "Give a client free service visits, with why: at once within the limit ops set, else for a manager",
  request: {
    params: z.object({ id: z.uuid() }),
    body: {
      required: true,
      ...json(
        z
          .object({
            visits: z.number().int().min(1).max(MOST_REMEDY_VISITS),
            reason: z.enum(REMEDY_REASONS),
            note: z.string().trim().min(1).max(REASON_MAX_CHARS),
          })
          .strict()
          .openapi("RemedyNew"),
      ),
    },
  },
  responses: {
    200: {
      description: "Given, or awaiting a manager",
      ...json(z.object({ id: z.uuid(), state: z.enum(["given", "awaiting"]) }).strict()),
    },
    403: errorResponse("access_required"),
    404: errorResponse("not_found: no such client, or their record is erased"),
  },
});

const listRoute = createRoute({
  method: "get",
  path: "/api/remedies",
  summary: "The remedies awaiting a manager, and those given or declined in the last 30 days",
  responses: {
    200: { description: "The remedies", ...json(z.object({ remedies: z.array(RemedySchema) }).strict()) },
    403: errorResponse("access_required"),
  },
});

const decided = {
  request: { params: z.object({ id: z.uuid() }) },
  responses: {
    200: { description: "Decided", ...json(z.object({ ok: z.literal(true) }).strict()) },
    403: errorResponse("access_required"),
    404: errorResponse("not_found: no such remedy awaiting a manager"),
  },
};

const approveRoute = createRoute({
  method: "post",
  path: "/api/remedies/{id}/approve",
  summary: "Approve a remedy: the visits are granted, and a note left in the client's chat",
  ...decided,
});

const declineRoute = createRoute({
  method: "post",
  path: "/api/remedies/{id}/decline",
  summary: "Decline a remedy",
  ...decided,
});

const changeOf = (c: Context<AppEnv>) => ({ actor: actorOf(c), requestId: c.var.requestId, now: c.var.deps.now() });

export function registerOpsRemedies(app: App): void {
  app.openapi(giveRoute, async (c) => {
    const body = c.req.valid("json");
    const { remedyLimit } = await opsInputs(c);
    const given = await giveRemedy(c.env.DB, {
      ...changeOf(c),
      ...body,
      personId: c.req.valid("param").id,
      limit: remedyLimit,
    });
    return given === null ? refuse(c, "not_found") : c.json(given, 200);
  });

  app.openapi(listRoute, async (c) => c.json({ remedies: await listRemedies(c.env.DB, c.var.deps.now()) }, 200));

  for (const [route, approve] of [
    [approveRoute, true],
    [declineRoute, false],
  ] as const) {
    app.openapi(route, async (c) => {
      const done = await decideRemedy(c.env.DB, { ...changeOf(c), id: c.req.valid("param").id, approve });
      return done ? c.json({ ok: true as const }, 200) : refuse(c, "not_found");
    });
  }
}
