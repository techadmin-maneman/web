// A client's rights over their data (docs/decisions/0049-dpdp.md), on the client surface:
//   GET  /api/me/export     everything we hold about them, as a JSON file: the right of access, with who in ops
//                           opened their photographs and when (docs/open-points.md, item 68)
//   POST /api/grievances    a grievance, for ops to answer: the right of redress. The same words,
//                           still open, are one grievance however often they are sent (ADR 0058)
// Correction is the profile itself (address, number change); erasure is the deletion request (ADR 0042).
// Each is audited under the client.

import { createRoute, z } from "@hono/zod-openapi";
import type { App } from "../http/context.ts";
import { auditStatementIfWritten, recordAudit } from "../domain/audit.ts";
import { everythingHeldAbout } from "../domain/data-export.ts";
import { clientOf, requireClientSession } from "../http/client-session.ts";
import { errorResponse } from "../http/errors.ts";

const exportRoute = createRoute({
  method: "get",
  path: "/api/me/export",
  summary: "Everything held about the client, to download",
  responses: {
    200: {
      description: "A JSON file, maneman-my-data.json",
      content: { "application/json": { schema: z.record(z.string(), z.unknown()) } },
    },
    401: errorResponse("session_required"),
  },
});

const grievanceRoute = createRoute({
  method: "post",
  path: "/api/grievances",
  summary: "Raise a grievance about how the client's data is handled. The same words, still open, are one",
  request: {
    body: {
      required: true,
      content: {
        "application/json": { schema: z.object({ text: z.string().trim().min(1).max(2000) }).strict() },
      },
    },
  },
  responses: {
    201: {
      description: "Received",
      content: {
        "application/json": {
          schema: z
            .object({ id: z.uuid(), state: z.literal("open") })
            .strict()
            .openapi("Grievance"),
        },
      },
    },
    401: errorResponse("session_required"),
  },
});

export function registerClientData(app: App): void {
  app.use("/api/me/export", requireClientSession);
  app.use("/api/grievances", requireClientSession);

  app.openapi(exportRoute, async (c) => {
    const session = clientOf(c);
    const db = c.env.DB;
    const id = session.subjectId;
    const now = c.var.deps.now();
    // Written before anything is read: an export the log could not record is not given.
    await recordAudit(
      db,
      {
        surface: "client",
        actor: { kind: "client", id },
        action: "data.export",
        subject: { kind: "person", id },
        requestId: c.var.requestId,
      },
      now,
    );
    return c.json({ exported_at: now.toISOString(), ...(await everythingHeldAbout(db, id)) }, 200, {
      "Content-Disposition": 'attachment; filename="maneman-my-data.json"',
      "Cache-Control": "private, no-store",
    });
  });

  app.openapi(grievanceRoute, async (c) => {
    const session = clientOf(c);
    const db = c.env.DB;
    const now = c.var.deps.now();
    const { text } = c.req.valid("json");
    const id = crypto.randomUUID();
    // One open grievance per client per wording. The same words, still unanswered, are the same
    // concern however many times Send is tapped, and each row ops see carries its own answer-time
    // clock. The write settles it rather than a read before it, so two requests in the same moment
    // cannot both find nothing and both record one (ADR 0058).
    const [raised] = await db.batch([
      db
        .prepare(
          `INSERT INTO grievances (id, person_id, text, state, created_at)
           SELECT ?1, ?2, ?3, 'open', ?4
           WHERE NOT EXISTS (SELECT 1 FROM grievances WHERE person_id = ?2 AND text = ?3 AND state = 'open')
           RETURNING id`,
        )
        .bind(id, session.subjectId, text, now.toISOString()),
      // Recorded only if the grievance above was, in the same batch (src/domain/audit.ts).
      auditStatementIfWritten(
        db,
        {
          surface: "client",
          actor: { kind: "client", id: session.subjectId },
          action: "grievance.raise",
          subject: { kind: "grievance", id },
          requestId: c.var.requestId,
        },
        now,
        { table: "grievances", id },
      ),
    ]);
    if (raised?.results.length !== 1) {
      // The tap that recorded nothing answers with the grievance the other raised, so both name
      // one concern and ops are alerted about it once.
      const already = await db
        .prepare("SELECT id FROM grievances WHERE person_id = ?1 AND text = ?2 ORDER BY created_at DESC LIMIT 1")
        .bind(session.subjectId, text)
        .first<string>("id");
      return c.json({ id: already ?? id, state: "open" as const }, 201);
    }
    // The alert names the grievance, never its words or the person.
    await c.var.deps.alert(`A client raised grievance ${id}; answer it in the ops console.`);
    return c.json({ id, state: "open" as const }, 201);
  });
}
