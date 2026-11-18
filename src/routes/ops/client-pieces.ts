// The pieces tab of a client's page (./field.ts): every piece fitted to them, with its lot, and the reasons one may have
// failed for, which Care mark one failed with, or take a failure back (docs/decisions/0273-why-a-hair-system-failed.md).

import { opsRoute } from "../../http/session-routes.ts";
import { z } from "@hono/zod-openapi";
import type { Context } from "hono";
import { json } from "../../http/openapi.ts";
import { piecesOf } from "../../domain/inventory/pieces.ts";
import { markFailed, undoFailure } from "../../domain/inventory/piece-failures.ts";
import { jobSheet } from "../../domain/field/job-sheet-settings.ts";
import type { App, AppEnv } from "../../http/context.ts";
import { actorOf } from "../../http/audit.ts";
import { errorResponse, refuse } from "../../http/errors.ts";
import { clientInReach } from "../../http/staff-access.ts";
import { PieceSchema } from "../tech/pieces.ts";

const ClientPiecesSchema = z
  .object({
    pieces: z.array(PieceSchema),
    failure_reasons: z
      .array(z.object({ code: z.string(), label: z.string() }).strict())
      .openapi({ description: "Why a hair system may have failed, as ops set them, in their order (ADR 0273)." }),
  })
  .strict()
  .openapi("ClientPieces");

const PIECES = { description: "The pieces, newest fit first", ...json(ClientPiecesSchema) };
const NOT_FOUND = errorResponse(
  "not_found: no such client or piece of theirs, or the client is outside the caller's cities",
);
const Piece = z.object({ id: z.uuid(), code: z.string().min(1).max(40) });

const piecesRoute = opsRoute({
  method: "get",
  path: "/api/clients/{id}/pieces",
  summary: "A client's pieces: code, base, fitted date, supplier lot, replacement due and any failure",
  request: { params: z.object({ id: z.uuid() }) },
  responses: { 200: PIECES, 404: NOT_FOUND },
});

const failRoute = opsRoute({
  method: "post",
  path: "/api/clients/{id}/pieces/{code}/failure",
  summary: "Mark a client's hair system failed, on a day, for a reason on the failure list",
  request: {
    params: Piece,
    body: {
      required: true,
      ...json(
        z
          .object({
            failure_reason: z
              .string()
              .min(1)
              .max(64)
              .openapi({ description: "By a code of the job sheet's failure_reasons." }),
            failed_on: z.iso
              .date()
              .openapi({ description: "The day in India it failed: not before its fit, nor after today." }),
          })
          .strict()
          .openapi("PieceFailure"),
      ),
    },
  },
  responses: {
    200: PIECES,
    400: errorResponse(
      "invalid_request: failure_reason not on the failure list, or failed_on before the fit or after today",
    ),
    404: NOT_FOUND,
    409: errorResponse("not_changeable: the piece is marked failed already"),
  },
});

const undoRoute = opsRoute({
  method: "delete",
  path: "/api/clients/{id}/pieces/{code}/failure",
  summary: "Take back a client's hair system's failure; one fitted over since is replaced when it came off",
  request: { params: Piece },
  responses: {
    204: { description: "Taken back" },
    404: NOT_FOUND,
    409: errorResponse("not_changeable: the piece is not marked failed"),
  },
});

/** The tab as it stands. */
async function piecesBody(c: Context<AppEnv>, personId: string) {
  const [pieces, sheet] = await Promise.all([piecesOf(c.env.DB, personId), jobSheet(c.env.DB)]);
  return {
    pieces: pieces.map((piece) => ({
      piece_code: piece.piece_code,
      base: piece.base,
      supplier_lot: piece.supplier_lot,
      fitted_at: piece.fitted_at === null ? null : piece.fitted_at.slice(0, 10),
      replacement_due_at: piece.replacement_due_at === null ? null : piece.replacement_due_at.slice(0, 10),
      failed_at: piece.failed_at,
      failure_reason: piece.failure_reason,
      replaced_at: piece.replaced_at,
    })),
    failure_reasons: sheet.failureReasons.items.map((item) => ({ code: item.id, label: item.label })),
  };
}

const written = (c: Context<AppEnv>) => ({ actor: actorOf(c), requestId: c.var.requestId, now: c.var.deps.now() });

export function registerOpsClientPieces(app: App): void {
  app.openapi(piecesRoute, async (c) => {
    const { id } = c.req.valid("param");
    if ((await clientInReach(c, id)) === null) return refuse(c, "not_found");
    return c.json(await piecesBody(c, id), 200);
  });

  app.openapi(failRoute, async (c) => {
    const { id, code } = c.req.valid("param");
    if ((await clientInReach(c, id)) === null) return refuse(c, "not_found");
    const { failure_reason: reason, failed_on: on } = c.req.valid("json");
    const marked = await markFailed(c.env.DB, { personId: id, pieceCode: code, reason, on }, written(c));
    if (!marked.ok) return refuse(c, marked.code, marked.fields);
    return c.json(await piecesBody(c, id), 200);
  });

  app.openapi(undoRoute, async (c) => {
    const { id, code } = c.req.valid("param");
    if ((await clientInReach(c, id)) === null) return refuse(c, "not_found");
    const undone = await undoFailure(c.env.DB, { personId: id, pieceCode: code }, written(c));
    if (!undone.ok) return refuse(c, undone.code);
    return c.body(null, 204);
  });
}
