// The technician's kit (docs/decisions/0164-the-kit-screen.md).
//
// Each is the technician's own kit alone, and no cost reaches the phone. The writes are made with signal, as a discount
// code is: the technician hears at once whether they landed, and they are no job's steps for the outbox to hold.

import { z } from "@hono/zod-openapi";
import type { Context } from "hono";
import { handBack, kitView } from "../../domain/inventory/kit.ts";
import { tellOfLowStock } from "../../domain/inventory/stock.ts";
import { receiveTransfer } from "../../domain/inventory/stock-transit.ts";
import type { App, AppEnv } from "../../http/context.ts";
import { errorResponse, refuse } from "../../http/errors.ts";
import { json } from "../../http/openapi.ts";
import { techRoute } from "../../http/session-routes.ts";
import { technicianOf } from "../../http/technician-session.ts";
import { isPieceCode } from "../../config/pieces.ts";
import { MAX_LABELLED } from "../../domain/inventory/stock-units.ts";
import { indiaDate } from "../../lib/india-time.ts";

/** A hair system's pieces by their labels, as scanned. */
const Labels = z.array(z.string().max(32).refine(isPieceCode)).min(1).max(MAX_LABELLED);

const Lot = z.object({ lot_code: z.string(), expires_on: z.union([z.iso.date(), z.null()]) }).strict();

const KitSchema = z
  .object({
    held: z.array(
      z
        .object({
          code: z.string(),
          name: z.string(),
          unit: z.string(),
          quantity: z.number().int(),
          hair_system: z.boolean(),
          lots: z
            .array(Lot.extend({ quantity: z.number().int() }).strict())
            .openapi({ description: "The lots it holds some of, soonest to expire first." }),
          units: z
            .array(
              z
                .object({
                  code: z.string(),
                  lot_code: z.union([z.string(), z.null()]),
                  expires_on: z.union([z.iso.date(), z.null()]),
                })
                .strict(),
            )
            .openapi({ description: "A hair system's pieces the kit holds labelled." }),
        })
        .strict(),
    ),
    coming: z
      .array(
        z
          .object({
            id: z.string(),
            code: z.string(),
            name: z.string(),
            unit: z.string(),
            quantity: z.number().int(),
            from: z.string().openapi({ description: "The place it was sent from, by name." }),
            sent_at: z.iso.datetime(),
            units: z.array(z.string()).openapi({ description: "The labels of a hair system's pieces on their way." }),
          })
          .strict(),
      )
      .openapi({ description: "Top-ups on their way, each to receive once in hand, the oldest first." }),
    returned: z
      .array(
        z
          .object({
            piece_code: z.string(),
            returned_at: z.iso.datetime(),
            reason: z.union([z.string(), z.null()]),
          })
          .strict(),
      )
      .openapi({ description: "Pieces that came off clients, held to hand back, the oldest first." }),
    today: z.iso.date(),
  })
  .strict()
  .openapi("TechnicianKit");

const KIT = { description: "The technician's kit", ...json(KitSchema) };
const SIGNED_IN = errorResponse("session_required; device_revoked");

const kitRoute = techRoute({
  method: "get",
  path: "/api/tech/kit",
  summary: "What the kit holds, what is on its way to it, and the pieces to hand back",
  responses: { 200: KIT, 401: SIGNED_IN },
});

const receiveRoute = techRoute({
  method: "post",
  path: "/api/tech/kit/transfers/{id}/receive",
  summary: "A top-up received: all of it, or of a hair system the pieces scanned, the rest still to come or missing",
  request: {
    params: z.object({ id: z.string().min(1).max(64) }),
    body: {
      required: true,
      ...json(
        z
          .object({
            units: Labels.optional(),
            rest: z.enum(["on_its_way", "missing"]).default("on_its_way").openapi({
              description:
                "Of a part received, whether the pieces not scanned are still to come or were lost on the way.",
            }),
          })
          .strict()
          .openapi("TechnicianKitReceipt"),
      ),
    },
  },
  responses: {
    200: KIT,
    400: errorResponse("invalid_request: fields names units for a label the top-up does not carry"),
    401: SIGNED_IN,
    404: errorResponse("not_found: no top-up on its way to this kit"),
    409: errorResponse("transfer_settled: it was received or sent back already"),
  },
});

const handBackRoute = techRoute({
  method: "post",
  path: "/api/tech/kit/hand-back",
  summary: "Returned pieces, and the kit's expired stock, back to the place the kit hangs from",
  request: {
    body: {
      required: true,
      ...json(
        z
          .object({
            pieces: z.array(z.string().min(1).max(32)).max(100).default([]),
            expired: z.boolean().default(false).openapi({ description: "Whether every expired lot goes back too." }),
          })
          .strict()
          .openapi("TechnicianKitHandBack"),
      ),
    },
  },
  responses: {
    200: KIT,
    400: errorResponse("invalid_request: fields names pieces for a label not of a piece the kit holds as returned"),
    401: SIGNED_IN,
  },
});

async function kitAnswer(c: Context<AppEnv>, kit: string) {
  const view = await kitView(c.env.DB, kit);
  return {
    held: view.held.map((item) => ({
      code: item.code,
      name: item.name,
      unit: item.unit,
      quantity: item.quantity,
      hair_system: item.hairSystem,
      lots: item.lots.map((lot) => ({ lot_code: lot.lotCode, expires_on: lot.expiresOn, quantity: lot.quantity })),
      units: item.units.map((unit) => ({ code: unit.code, lot_code: unit.lotCode, expires_on: unit.expiresOn })),
    })),
    coming: view.coming.map((each) => ({
      id: each.id,
      code: each.code,
      name: each.name,
      unit: each.unit,
      quantity: each.quantity,
      from: each.from,
      sent_at: each.sentAt,
      units: [...each.units],
    })),
    returned: view.returned.map((piece) => ({
      piece_code: piece.pieceCode,
      returned_at: piece.returnedAt,
      reason: piece.reason,
    })),
    today: indiaDate(c.var.deps.now()),
  };
}

const written = (c: Context<AppEnv>, technicianId: string) =>
  ({
    actor: { kind: "technician", id: technicianId },
    requestId: c.var.requestId,
    now: c.var.deps.now(),
  }) as const;

export function registerTechKit(app: App): void {
  app.openapi(kitRoute, async (c) => c.json(await kitAnswer(c, technicianOf(c).technicianId), 200));

  app.openapi(receiveRoute, async (c) => {
    const { technicianId } = technicianOf(c);
    const { id } = c.req.valid("param");
    const transfer = await c.env.DB.prepare("SELECT to_place FROM stock_transfers WHERE id = ?1")
      .bind(id)
      .first<string>("to_place");
    if (transfer !== technicianId) return refuse(c, "not_found");
    const body = c.req.valid("json");
    const settled = await receiveTransfer(
      c.env.DB,
      id,
      { received: null, note: null, units: body.units ?? null, restOnItsWay: body.rest === "on_its_way" },
      written(c, technicianId),
    );
    if (!settled.ok) {
      if ("missing" in settled) return refuse(c, "not_found");
      if ("settled" in settled) return refuse(c, "transfer_settled");
      return refuse(c, "invalid_request", settled.fields);
    }
    await tellOfLowStock(c.env.DB, c.var.deps, { touched: [technicianId], lowered: [] });
    return c.json(await kitAnswer(c, technicianId), 200);
  });

  app.openapi(handBackRoute, async (c) => {
    const { technicianId } = technicianOf(c);
    const body = c.req.valid("json");
    const handed = await handBack(c.env.DB, technicianId, body, written(c, technicianId));
    if (!handed.ok) return refuse(c, "invalid_request", handed.fields);
    await tellOfLowStock(c.env.DB, c.var.deps, { touched: [technicianId], lowered: [technicianId] });
    return c.json(await kitAnswer(c, technicianId), 200);
  });
}
