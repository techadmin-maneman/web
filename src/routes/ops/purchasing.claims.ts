// Claims on suppliers and returned pieces, behind Access (docs/decisions/0169-supplier-claims.md):
//   GET  /api/supplier-claims                     open claims and the latest settled, and the pieces handed in to settle
//   POST /api/supplier-claims/{id}/send           a drafted claim marked sent to its supplier
//   POST /api/supplier-claims/{id}/withdraw       a drafted claim withdrawn, with why
//   POST /api/supplier-claims/{id}/decide         a sent claim settled: a credit, a replacement, or rejected
//   POST /api/returned-pieces/{id}/claim          a returned piece inside its warranty claimed on its supplier
//   POST /api/returned-pieces/{id}/write-off      a returned piece written off, with why
//
// Sending, withdrawing and settling pieces with Operations ACT; settling a claim with MANAGE. Each answers the whole of
// GET's answer.

import { createRoute, z } from "@hono/zod-openapi";
import type { Context } from "hono";
import { stockPhotoExists } from "../../domain/field/stock-photos.ts";
import { returnedPieces, claimReturn, writeOffReturn, type Settled } from "../../domain/field/returned-pieces.ts";
import {
  CLAIM_OUTCOMES,
  CLAIM_REASONS,
  CLAIM_STATES,
  decideClaim,
  sendClaim,
  supplierClaims,
  withdrawClaim,
  type ClaimAnswer,
  type ClaimChanged,
} from "../../domain/field/supplier-claims.ts";
import type { App, AppEnv } from "../../http/context.ts";
import { errorResponse, refuse } from "../../http/errors.ts";
import { json } from "../../http/openapi.ts";
import { Note, orderPath, written } from "./purchasing.ts";

const ClaimSchema = z.object({
  id: z.string(),
  number: z.number().int(),
  supplier_id: z.string(),
  consumable_code: z.string(),
  name: z.string(),
  quantity: z.number().int(),
  reason: z.enum(CLAIM_REASONS),
  order_number: z.number().int(),
  piece_code: z.string().nullable(),
  unit_price: z
    .number()
    .int()
    .openapi({ description: "One unit's price on the order, in its currency's smallest unit." }),
  currency: z.string(),
  state: z.enum(CLAIM_STATES),
  outcome: z.enum(CLAIM_OUTCOMES).nullable(),
  credit_amount: z.number().int().nullable(),
  note: z.string().nullable(),
  drafted_at: z.string(),
  sent_at: z.string().nullable(),
  decided_at: z.string().nullable(),
  photo_id: z.string().nullable().openapi({ description: "The photograph sent with it: GET /api/stock-photos/{id}." }),
});

const ReturnedPieceSchema = z.object({
  id: z.string(),
  piece_code: z.string(),
  name: z.string().nullable(),
  reason: z.string().nullable(),
  returned_at: z.string(),
  handed_in_at: z.string(),
  handed_in_to: z.string().nullable(),
  supplier_id: z.string().nullable(),
  warranty_ends_on: z.string().nullable(),
  in_warranty: z.boolean(),
});

const CLAIMS = {
  description: "The claims on suppliers, and the returned pieces to settle",
  ...json(z.object({ claims: z.array(ClaimSchema), returns: z.array(ReturnedPieceSchema) }).openapi("SupplierClaims")),
};
const ACCESS = errorResponse("access_required");

const listRoute = createRoute({
  method: "get",
  path: "/api/supplier-claims",
  summary: "Open claims on suppliers and the latest settled, and the returned pieces handed in to settle",
  responses: { 200: CLAIMS, 403: ACCESS },
});

const CLAIM_ANSWERS = {
  200: CLAIMS,
  403: ACCESS,
  404: errorResponse("not_found: no such claim"),
  409: errorResponse("claim_state: the claim is past the step asked"),
};

const sendRoute = createRoute({
  method: "post",
  path: "/api/supplier-claims/{id}/send",
  summary: "A drafted claim marked sent to its supplier",
  request: {
    ...orderPath,
    body: {
      required: true,
      ...json(
        z.object({ note: Note.nullable(), photo_id: z.uuid().nullable() }).strict().openapi("SupplierClaimSend"),
      ),
    },
  },
  responses: { ...CLAIM_ANSWERS, 400: errorResponse("invalid_request: fields names photo_id for no photograph stored") },
});

const withdrawRoute = createRoute({
  method: "post",
  path: "/api/supplier-claims/{id}/withdraw",
  summary: "A drafted claim withdrawn, with why",
  request: {
    ...orderPath,
    body: { required: true, ...json(z.object({ note: Note }).strict().openapi("SupplierClaimWithdraw")) },
  },
  responses: CLAIM_ANSWERS,
});

const decideRoute = createRoute({
  method: "post",
  path: "/api/supplier-claims/{id}/decide",
  summary: "A sent claim settled by the supplier's answer",
  request: {
    ...orderPath,
    body: {
      required: true,
      ...json(
        z
          .object({
            outcome: z.enum(["credit", "replacement", "rejected"]),
            credit_amount: z.number().int().min(1).max(10_000_000_000).nullable().openapi({
              description: "The credit, in the claim's currency's smallest unit; given for a credit, and only then.",
            }),
            note: Note.nullable(),
          })
          .strict()
          .openapi("SupplierClaimDecision"),
      ),
    },
  },
  responses: {
    ...CLAIM_ANSWERS,
    400: errorResponse("invalid_request: fields names credit_amount, missing on a credit or given on another answer"),
  },
});

const PIECE_ANSWERS = {
  200: CLAIMS,
  403: ACCESS,
  404: errorResponse("not_found: no such returned piece"),
  409: errorResponse("return_settled: the piece is settled already, or not handed in"),
};

const claimRoute = createRoute({
  method: "post",
  path: "/api/returned-pieces/{id}/claim",
  summary: "A returned piece inside its supplier's warranty claimed on the supplier",
  request: orderPath,
  responses: {
    ...PIECE_ANSWERS,
    409: errorResponse(
      "return_settled: the piece is settled already, or not handed in; out_of_warranty: it came in on no receipt, or its supplier's warranty has ended",
    ),
  },
});

const writeOffRoute = createRoute({
  method: "post",
  path: "/api/returned-pieces/{id}/write-off",
  summary: "A returned piece written off, with why",
  request: {
    ...orderPath,
    body: {
      required: true,
      ...json(z.object({ reason: Note, photo_id: z.uuid() }).strict().openapi("ReturnedPieceWriteOff")),
    },
  },
  responses: { ...PIECE_ANSWERS, 400: errorResponse("invalid_request: fields names photo_id for no photograph stored") },
});

async function claimsAnswer(c: Context<AppEnv>) {
  const [claims, returns] = await Promise.all([supplierClaims(c.env.DB), returnedPieces(c.env.DB)]);
  return {
    claims: claims.map((claim) => ({
      id: claim.id,
      number: claim.number,
      supplier_id: claim.supplierId,
      consumable_code: claim.consumableCode,
      name: claim.name,
      quantity: claim.quantity,
      reason: claim.reason,
      order_number: claim.orderNumber,
      piece_code: claim.pieceCode,
      unit_price: claim.unitPrice,
      currency: claim.currency,
      state: claim.state,
      outcome: claim.outcome,
      credit_amount: claim.creditAmount,
      note: claim.note,
      drafted_at: claim.draftedAt,
      sent_at: claim.sentAt,
      decided_at: claim.decidedAt,
      photo_id: claim.photoId,
    })),
    returns: returns.map((piece) => ({
      id: piece.id,
      piece_code: piece.pieceCode,
      name: piece.name,
      reason: piece.reason,
      returned_at: piece.returnedAt,
      handed_in_at: piece.handedInAt,
      handed_in_to: piece.handedInTo,
      supplier_id: piece.supplierId,
      warranty_ends_on: piece.warrantyEndsOn,
      in_warranty: piece.inWarranty,
    })),
  };
}

async function afterClaim(c: Context<AppEnv>, changed: ClaimChanged) {
  if (!changed.ok) return "missing" in changed ? refuse(c, "not_found") : refuse(c, "claim_state");
  return c.json(await claimsAnswer(c), 200);
}

async function afterPiece(c: Context<AppEnv>, settled: Settled) {
  if (!settled.ok) {
    if ("missing" in settled) return refuse(c, "not_found");
    return refuse(c, "outOfWarranty" in settled ? "out_of_warranty" : "return_settled");
  }
  return c.json(await claimsAnswer(c), 200);
}

export function registerOpsClaims(app: App): void {
  app.openapi(listRoute, async (c) => c.json(await claimsAnswer(c), 200));

  app.openapi(sendRoute, async (c) => {
    const { note, photo_id: photoId } = c.req.valid("json");
    if (photoId !== null && !(await stockPhotoExists(c.env.DB, photoId))) {
      return refuse(c, "invalid_request", ["photo_id"]);
    }
    return afterClaim(c, await sendClaim(c.env.DB, c.req.valid("param").id, { note, photoId }, written(c)));
  });

  app.openapi(withdrawRoute, async (c) =>
    afterClaim(c, await withdrawClaim(c.env.DB, c.req.valid("param").id, c.req.valid("json").note, written(c))),
  );

  app.openapi(decideRoute, async (c) => {
    const { outcome, credit_amount: creditAmount, note } = c.req.valid("json");
    if ((outcome === "credit") !== (creditAmount !== null)) return refuse(c, "invalid_request", ["credit_amount"]);
    const answer: ClaimAnswer = outcome === "credit" ? { outcome, creditAmount: creditAmount ?? 0 } : { outcome };
    return afterClaim(c, await decideClaim(c.env.DB, c.req.valid("param").id, { ...answer, note }, written(c)));
  });

  app.openapi(claimRoute, async (c) => afterPiece(c, await claimReturn(c.env.DB, c.req.valid("param").id, written(c))));

  app.openapi(writeOffRoute, async (c) => {
    const { reason, photo_id: photoId } = c.req.valid("json");
    if (!(await stockPhotoExists(c.env.DB, photoId))) return refuse(c, "invalid_request", ["photo_id"]);
    return afterPiece(c, await writeOffReturn(c.env.DB, c.req.valid("param").id, { reason, photoId }, written(c)));
  });
}
