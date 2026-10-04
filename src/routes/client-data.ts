// A client's rights over their data (docs/decisions/0049-dpdp.md), on the client surface:
//   GET  /api/me/export       everything we hold about them, as a JSON file: the right of access, with who in ops
//                             opened their photographs and when (docs/open-points.md, item 68)
//   GET  /api/me/export.html  the same, as a page they can read, which the app's "Download my data" gives
//   POST /api/grievances      a grievance, for ops to answer: the right of redress. The same words,
//                             still open, are one grievance however often they are sent (ADR 0058),
//                             and a client may raise GRIEVANCES_PER_DAY new ones a day
// Correction is the profile itself (address, number change); erasure is the deletion request (ADR 0042).
// Each is audited under the client.

import { clientRoute } from "../http/session-routes.ts";
import { z } from "@hono/zod-openapi";
import type { Context } from "hono";
import type { App, AppEnv } from "../http/context.ts";
import { auditStatementIfWritten, recordAudit } from "../domain/audit.ts";
import { everythingHeldAbout } from "../domain/data-export.ts";
import { openGrievanceInWords } from "../domain/grievances.ts";
import { myDataPage } from "../domain/my-data-page.ts";
import { takeOne } from "../domain/rate-limit.ts";
import { clientOf } from "../http/client-session.ts";
import { errorResponse, refuse } from "../http/errors.ts";
import { GRIEVANCES_PER_DAY } from "../policy/grievances.ts";

const exportRoute = clientRoute({
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

const exportPageRoute = clientRoute({
  method: "get",
  path: "/api/me/export.html",
  summary: "Everything held about the client, as a page to download and read",
  responses: {
    200: {
      description: "An HTML file, maneman-my-data.html, labelled and in India's time",
      content: { "text/html": { schema: z.string() } },
    },
    401: errorResponse("session_required"),
  },
});

/** Everything held about the signed-in client, once the export is audited: one the log could not record is not given. */
async function auditedExport(c: Context<AppEnv>): Promise<{ held: Record<string, unknown>; now: Date }> {
  const id = clientOf(c).subjectId;
  const now = c.var.deps.now();
  await recordAudit(
    c.env.DB,
    {
      surface: "client",
      actor: { kind: "client", id },
      action: "data.export",
      subject: { kind: "person", id },
      requestId: c.var.requestId,
    },
    now,
  );
  return { held: await everythingHeldAbout(c.env.DB, id), now };
}

const grievanceRoute = clientRoute({
  method: "post",
  path: "/api/grievances",
  summary: `Raise a grievance about how the client's data is handled. The same words, still open, are one; ${String(GRIEVANCES_PER_DAY)} new ones a day`,
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
    429: errorResponse(`rate_limited: ${String(GRIEVANCES_PER_DAY)} new grievances a day`),
  },
});

export function registerClientData(app: App): void {
  app.openapi(exportRoute, async (c) => {
    const { held, now } = await auditedExport(c);
    return c.json({ exported_at: now.toISOString(), ...held }, 200, {
      "Content-Disposition": 'attachment; filename="maneman-my-data.json"',
      "Cache-Control": "private, no-store",
    });
  });

  app.openapi(exportPageRoute, async (c) => {
    const { held, now } = await auditedExport(c);
    return new Response(myDataPage(held, now), {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Content-Disposition": 'attachment; filename="maneman-my-data.html"',
        "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'",
        "Cache-Control": "private, no-store",
      },
    });
  });

  app.openapi(grievanceRoute, async (c) => {
    const session = clientOf(c);
    const db = c.env.DB;
    const now = c.var.deps.now();
    const { text } = c.req.valid("json");
    // One open grievance per client per wording: the same words, still unanswered, are the same
    // concern however many times Send is tapped, so they cost nothing of the day's allowance.
    const already = await openGrievanceInWords(db, session.subjectId, text);
    if (already !== null) return c.json({ id: already, state: "open" as const }, 201);

    const allowed = await takeOne(db, "grievance:person", session.subjectId, { now, settings: c.var.config.settings });
    if (!allowed) return refuse(c, "rate_limited");

    const id = crypto.randomUUID();
    // The write settles two taps in the same moment, not the read above: both could find nothing,
    // and only one may record a grievance.
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
    if (raised?.results.length === 1) return c.json({ id, state: "open" as const }, 201);
    // The tap that recorded nothing answers with the grievance the other raised, so both name one concern.
    const other = await openGrievanceInWords(db, session.subjectId, text);
    return c.json({ id: other ?? id, state: "open" as const }, 201);
  });
}
