// The audit log, read by ops (docs/decisions/0031-access-and-audit.md), on the ops surface behind Access:
//   GET /api/activity   every entry, newest first, fifty at a time, narrowed by who, what, a client, a visit or days
// Admin's View reads it, nationally: it shows what everyone did, everywhere. Reading it is an ops call like any other,
// written to the log it reads.

import { createRoute, z } from "@hono/zod-openapi";
import { SURFACES } from "../../config/environments.ts";
import { activity } from "../../domain/ops/activity.ts";
import { AUDIT_ACTIONS, type AuditActor } from "../../domain/ops/audit.ts";
import type { App } from "../../http/context.ts";
import { json } from "../../http/openapi.ts";

const ACTOR_KINDS = [
  "staff",
  "service",
  "client",
  "technician",
  "system",
] as const satisfies readonly AuditActor["kind"][];

const EntrySchema = z
  .object({
    id: z.number().int(),
    at: z.iso.datetime(),
    surface: z.enum(SURFACES),
    actor: z
      .object({
        kind: z.enum(ACTOR_KINDS),
        id: z.string().openapi({
          description:
            "A member of staff's e-mail, a service token's client ID, a client's or a technician's ID, or a job's name.",
        }),
        name: z.string().nullable().openapi({
          description: "A client's name, unless they were erased, a technician's, or a service token's label.",
        }),
      })
      .strict(),
    action: z.enum(AUDIT_ACTIONS),
    subject: z.object({ kind: z.string(), id: z.string() }).strict().nullable(),
    detail: z
      .record(z.string(), z.unknown())
      .nullable()
      .openapi({ description: "IDs, counts and codes; for a call, its method, route and path, IDs only." }),
  })
  .strict()
  .openapi("ActivityEntry");

const listRoute = createRoute({
  method: "get",
  path: "/api/activity",
  summary: "The audit log, newest first: who did what, on which record, when",
  request: {
    query: z.object({
      actor_kind: z.enum(ACTOR_KINDS).optional(),
      actor: z.string().trim().min(1).max(320).optional(),
      action: z.enum(AUDIT_ACTIONS).optional(),
      person: z.string().trim().min(1).max(64).optional().openapi({
        description: "A client's ID: what they did, and what was done to their record, visits, holds and requests.",
      }),
      visit: z.string().trim().min(1).max(64).optional(),
      from: z.iso.date().optional().openapi({ description: "India's date, the first included." }),
      to: z.iso.date().optional().openapi({ description: "India's date, the last included." }),
      before: z.coerce.number().int().positive().optional().openapi({
        description: "The page after the one whose `next_before` this is.",
      }),
    }),
  },
  responses: {
    200: {
      description: "A page of the log",
      ...json(
        z
          .object({
            entries: z.array(EntrySchema),
            next_before: z.number().int().nullable().openapi({
              description: "Asked as `before`, the next page; null when this one reaches the log's start.",
            }),
          })
          .strict(),
      ),
    },
  },
});

export function registerOpsActivity(app: App): void {
  app.openapi(listRoute, async (c) => {
    const query = c.req.valid("query");
    const page = await activity(c.env.DB, {
      actorKind: query.actor_kind,
      actor: query.actor,
      action: query.action,
      person: query.person,
      visit: query.visit,
      from: query.from,
      to: query.to,
      before: query.before,
    });
    return c.json(
      {
        entries: page.entries.map((entry) => ({
          ...entry,
          detail: entry.detail === null ? null : { ...entry.detail },
        })),
        next_before: page.nextBefore,
      },
      200,
    );
  });
}
