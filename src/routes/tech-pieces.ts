// The label the technician scans (src/policy/in-job-steps.ts, step 4):
//   GET /api/tech/pieces/lookup?code=MM-STD-4417-B
//
// "Scan the label code (for example MM-STD-4417-B) or pick from the client's
// pieces in FSM." The lookup reads our own pieces, so it works with no signal; a
// code not among them is simply unknown, and the technician types the
// details on the piece step instead.
//
// No client's name or number here: a label says which piece, not whose.

import { techRoute } from "../http/session-routes.ts";
import { z } from "@hono/zod-openapi";
import type { App } from "../http/context.ts";
import { pieceWithOwner } from "../domain/pieces.ts";
import { errorResponse, refuse } from "../http/errors.ts";
import { technicianOf } from "../http/technician-session.ts";

export const PieceSchema = z
  .object({
    piece_code: z.string(),
    base: z.union([z.string(), z.null()]),
    supplier_lot: z.union([z.string(), z.null()]),
    fitted_at: z.union([z.iso.date(), z.null()]),
    replacement_due_at: z.union([z.iso.date(), z.null()]),
    failed_at: z.union([z.iso.datetime(), z.null()]),
    failure_reason: z.union([z.string(), z.null()]),
  })
  .strict()
  .openapi("Piece");

const LookupSchema = z
  .object({ piece: PieceSchema, belongs_to_this_job: z.boolean() })
  .strict()
  .openapi("PieceLookup", { description: "Whether the label is one of the job's client's pieces." });

const lookupRoute = techRoute({
  method: "get",
  path: "/api/tech/pieces/lookup",
  summary: "The piece a label names",
  request: { query: z.object({ code: z.string().min(3).max(40), job: z.uuid().optional() }) },
  responses: {
    200: { description: "The piece", content: { "application/json": { schema: LookupSchema } } },
    401: errorResponse("session_required; device_revoked"),
    404: errorResponse("not_found: no piece with that label"),
  },
});

export function registerTechPieces(app: App): void {
  app.openapi(lookupRoute, async (c) => {
    const { code, job } = c.req.valid("query");
    const found = await pieceWithOwner(c.env.DB, code.trim().toUpperCase());
    if (found === null) return refuse(c, "not_found");

    // Only a job of his own says whose the piece is: any other reads as none (FLD-18).
    const client =
      job === undefined
        ? null
        : await c.env.DB.prepare("SELECT person_id FROM appointments WHERE id = ?1 AND technician_id = ?2")
            .bind(job, technicianOf(c).technicianId)
            .first<{ person_id: string | null }>();
    return c.json(
      {
        piece: normalise(found.piece),
        belongs_to_this_job: (client?.person_id ?? null) !== null && client?.person_id === found.personId,
      },
      200,
    );
  });
}

/** Dates as the schema names them: the fitted and due dates are days, the failure an instant. */
function normalise(piece: {
  piece_code: string;
  base: string | null;
  supplier_lot: string | null;
  fitted_at: string | null;
  replacement_due_at: string | null;
  failed_at: string | null;
  failure_reason: string | null;
}) {
  return {
    piece_code: piece.piece_code,
    base: piece.base,
    supplier_lot: piece.supplier_lot,
    fitted_at: piece.fitted_at === null ? null : piece.fitted_at.slice(0, 10),
    replacement_due_at: piece.replacement_due_at === null ? null : piece.replacement_due_at.slice(0, 10),
    failed_at: piece.failed_at,
    failure_reason: piece.failure_reason,
  };
}
