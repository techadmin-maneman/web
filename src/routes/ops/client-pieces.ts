// The pieces tab of a client's page (./field.ts): every piece fitted to them, with its lot.

import { createRoute, z } from "@hono/zod-openapi";
import { json } from "../../http/openapi.ts";
import { piecesOf } from "../../domain/field/pieces.ts";
import type { App } from "../../http/context.ts";
import { errorResponse, refuse } from "../../http/errors.ts";
import { withinRouteReach } from "../../http/staff-access.ts";
import { PieceSchema } from "../tech/pieces.ts";

const ClientPiecesSchema = z
  .object({ pieces: z.array(PieceSchema) })
  .strict()
  .openapi("ClientPieces");

const piecesRoute = createRoute({
  method: "get",
  path: "/api/clients/{id}/pieces",
  summary: "A client's pieces: code, base, fitted date, supplier lot, replacement due and any failure",
  request: { params: z.object({ id: z.uuid() }) },
  responses: {
    200: { description: "The pieces, newest fit first", ...json(ClientPiecesSchema) },
    403: errorResponse("access_required"),
    404: errorResponse("not_found: no such client, or the client is outside the caller's cities"),
  },
});

export function registerOpsClientPieces(app: App): void {
  app.openapi(piecesRoute, async (c) => {
    const { id } = c.req.valid("param");
    const client = await c.env.DB.prepare("SELECT id FROM people WHERE id = ?1 AND erased_at IS NULL")
      .bind(id)
      .first<{ id: string }>();
    if (client === null || !(await withinRouteReach(c, "client", id))) {
      return refuse(c, "not_found");
    }
    const pieces = await piecesOf(c.env.DB, id);
    return c.json(
      {
        pieces: pieces.map((piece) => ({
          piece_code: piece.piece_code,
          base: piece.base,
          supplier_lot: piece.supplier_lot,
          fitted_at: piece.fitted_at === null ? null : piece.fitted_at.slice(0, 10),
          replacement_due_at: piece.replacement_due_at === null ? null : piece.replacement_due_at.slice(0, 10),
          failed_at: piece.failed_at,
          failure_reason: piece.failure_reason,
        })),
      },
      200,
    );
  });
}
