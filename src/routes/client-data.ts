// A client's rights over their data (docs/decisions/0049-dpdp.md), on the client surface:
//   GET  /api/me/export     everything we hold about them, as a JSON file: the right of access
//   POST /api/grievances    a grievance, for ops to answer: the right of redress. The same words,
//                           still open, are one grievance however often they are sent (ADR 0058)
// Correction is the profile itself (address, number change); erasure is the deletion request (ADR 0042).
// Each is audited under the client.

import { createRoute, z } from "@hono/zod-openapi";
import type { App } from "../app.ts";
import { recordAudit } from "../domain/audit.ts";
import { requireClientSession } from "../http/client-session.ts";
import { errorBody, errorResponse } from "../http/errors.ts";

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
    const session = c.var.clientSession;
    if (session === undefined) return c.json(errorBody("session_required", c.var.requestId), 401);
    const db = c.env.DB;
    const id = session.subjectId;
    const all = (sql: string) =>
      db
        .prepare(sql)
        .bind(id)
        .all()
        .then((rows) => rows.results);
    const [person, addresses, consents, visits, payments, refunds, credits, referral, messages, grievances, tryOns] =
      await Promise.all([
        db.prepare("SELECT name, mobile_e164 AS mobile, email, created_at FROM people WHERE id = ?1").bind(id).first(),
        all(
          `SELECT line1, line2, locality, city, pincode, access_notes, created_at, replaced_at FROM addresses
           WHERE person_id = ?1 ORDER BY created_at`,
        ),
        all(
          `SELECT purpose, granted, notice_version, created_at FROM consents WHERE person_id = ?1
           ORDER BY created_at, rowid`,
        ),
        all(
          `SELECT a.type, a.window_start, a.status, t.name AS technician FROM appointments a
           LEFT JOIN technicians t ON t.id = a.technician_id
           WHERE a.person_id = ?1 AND a.deleted_at IS NULL ORDER BY a.window_start`,
        ),
        all(
          `SELECT created_at, amount, method, reference, status, refunded_amount FROM payments WHERE person_id = ?1
           ORDER BY created_at`,
        ),
        all(
          `SELECT r.created_at, r.amount, r.status FROM refunds r JOIN payments p ON p.id = r.payment_id
           WHERE p.person_id = ?1 ORDER BY r.created_at`,
        ),
        all("SELECT kind, visits, expires_at, created_at FROM credit_ledger WHERE person_id = ?1 ORDER BY created_at"),
        db.prepare("SELECT code, card_state FROM referral_codes WHERE person_id = ?1").bind(id).first(),
        all("SELECT kind, state, created_at FROM outbound_messages WHERE person_id = ?1 ORDER BY created_at"),
        all("SELECT text, state, response, created_at FROM grievances WHERE person_id = ?1 ORDER BY created_at"),
        all("SELECT state, created_at FROM tryon_jobs WHERE person_id = ?1 ORDER BY created_at"),
      ]);
    const now = c.var.deps.now();
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
    return c.json(
      {
        exported_at: now.toISOString(),
        person,
        addresses,
        consents,
        visits,
        payments,
        refunds,
        credits,
        referral,
        messages,
        grievances,
        try_ons: tryOns,
      },
      200,
      { "Content-Disposition": 'attachment; filename="maneman-my-data.json"', "Cache-Control": "private, no-store" },
    );
  });

  app.openapi(grievanceRoute, async (c) => {
    const session = c.var.clientSession;
    if (session === undefined) return c.json(errorBody("session_required", c.var.requestId), 401);
    const db = c.env.DB;
    const now = c.var.deps.now();
    const { text } = c.req.valid("json");
    const id = crypto.randomUUID();
    // One open grievance per client per wording. The same words, still unanswered, are the same
    // concern however many times Send is tapped, and each row ops see carries its own answer-time
    // clock. The write settles it rather than a read before it, so two requests in the same moment
    // cannot both find nothing and both record one (ADR 0058).
    const raised = await db
      .prepare(
        `INSERT INTO grievances (id, person_id, text, state, created_at)
         SELECT ?1, ?2, ?3, 'open', ?4
         WHERE NOT EXISTS (SELECT 1 FROM grievances WHERE person_id = ?2 AND text = ?3 AND state = 'open')
         RETURNING id`,
      )
      .bind(id, session.subjectId, text, now.toISOString())
      .first<string>("id");
    if (raised === null) {
      // The tap that recorded nothing answers with the grievance the other raised, so both name
      // one concern and ops are alerted about it once.
      const already = await db
        .prepare("SELECT id FROM grievances WHERE person_id = ?1 AND text = ?2 ORDER BY created_at DESC LIMIT 1")
        .bind(session.subjectId, text)
        .first<string>("id");
      return c.json({ id: already ?? id, state: "open" as const }, 201);
    }
    await recordAudit(
      db,
      {
        surface: "client",
        actor: { kind: "client", id: session.subjectId },
        action: "grievance.raise",
        subject: { kind: "grievance", id },
        requestId: c.var.requestId,
      },
      now,
    );
    // The alert names the grievance, never its words or the person.
    await c.var.deps.alert(`A client raised grievance ${id}; answer it in the ops console.`);
    return c.json({ id, state: "open" as const }, 201);
  });
}
