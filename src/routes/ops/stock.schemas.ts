// The shapes the Stock routes share (src/routes/ops/stock.ts and its stock.*.ts): a place, what every place holds, and
// the figures, notes, lots and labels a movement takes.

import { z } from "@hono/zod-openapi";
import { CONSUMABLE_BOUNDS, MAX_NOTE } from "../../config/consumables.ts";
import { isPieceCode } from "../../config/pieces.ts";
import { MOVEMENT_REASONS } from "../../domain/field/stock.ts";
import { PLACE_KINDS } from "../../domain/field/stock-places.ts";
import { MAX_LABELLED } from "../../domain/field/stock-units.ts";
import { json } from "../../http/openapi.ts";

/** A place, by its ID: "central" for the warehouse, a technician's ID for their kit. */
export const PlaceId = z
  .string()
  .min(1)
  .max(64)
  .openapi({ description: "A place by its ID: central for the warehouse, a kit by its technician's ID." });

const StockSchema = z
  .object({
    consumables: z.array(
      z
        .object({
          code: z.string(),
          name: z.string(),
          unit: z.string(),
          retired: z.boolean().openapi({ description: "No longer offered, and still held somewhere." }),
          hair_system: z.boolean().openapi({ description: "A hair system, whose pieces are each labelled." }),
          reorder_kit: z.union([z.number().int(), z.null()]),
          reorder_central: z.union([z.number().int(), z.null()]),
          reorder_store: z.union([z.number().int(), z.null()]),
        })
        .strict(),
    ),
    places: z
      .array(
        z
          .object({
            id: PlaceId,
            kind: z.enum(PLACE_KINDS),
            name: z.string().openapi({ description: "A kit's is its technician's name." }),
            parent_id: z
              .union([PlaceId, z.null()])
              .openapi({ description: "The place it hangs from; null for the warehouse." }),
            zone: z.union([z.string(), z.null()]),
            city: z.union([z.string(), z.null()]),
            active: z.boolean().openapi({ description: "Open; a kit is open while its technician is." }),
          })
          .strict(),
      )
      .openapi({
        description:
          "Every open place down the tree, the warehouse first, and any closed one still holding stock: those in the caller's cities, a hub with every city of its zone, and the warehouse only with a national grant.",
      }),
    other_places: z
      .array(
        z
          .object({
            id: PlaceId,
            kind: z.enum(PLACE_KINDS),
            name: z.string().openapi({ description: "A kit's is its technician's name." }),
            parent_id: z
              .union([PlaceId, z.null()])
              .openapi({ description: "The place it hangs from; null for the warehouse." }),
            zone: z.union([z.string(), z.null()]),
            city: z.union([z.string(), z.null()]),
            active: z.boolean().openapi({ description: "Open; a kit is open while its technician is." }),
          })
          .strict(),
      )
      .openapi({
        description:
          "The places the latest movements name that places does not hold: a kit of a technician who left, or a closed room, so each movement says where it was.",
      }),
    holdings: z.array(
      z
        .object({
          consumable_code: z.string(),
          place_id: PlaceId,
          quantity: z.number().int().openapi({ description: "The sum of the place's rows; below nought is a gap." }),
          low: z.boolean().openapi({ description: "At or below the level for its kind of place." }),
          counted_at: z.union([z.iso.datetime(), z.null()]).openapi({ description: "When it was last counted there." }),
          lots: z
            .array(
              z
                .object({
                  id: z.string(),
                  lot_code: z
                    .string()
                    .openapi({ description: "The supplier's lot, or R- and the day it was received." }),
                  expires_on: z.union([z.iso.date(), z.null()]),
                  quantity: z.number().int(),
                })
                .strict(),
            )
            .openapi({ description: "The lots the place holds some of, soonest to expire first." }),
        })
        .strict(),
    ),
    movements: z
      .array(
        z
          .object({
            at: z.iso.datetime(),
            consumable_code: z.string(),
            place_id: PlaceId,
            quantity: z.number().int().openapi({ description: "Into the place, positive; out of it, negative." }),
            reason: z.enum(MOVEMENT_REASONS),
            by: z.string().openapi({
              description:
                "Who: ops' Access identity, a service token by its label on the Staff list, or the technician's ID " +
                "for a job's use.",
            }),
            note: z.union([z.string(), z.null()]),
          })
          .strict(),
      )
      .openapi({ description: "The latest movements, newest first." }),
    today: z.iso.date(),
    expiry_warning_days: z
      .number()
      .int()
      .openapi({ description: "How many days before it expires a lot is listed as expiring, as ops set it." }),
    max_quantity: z.number().int(),
    in_transit: z
      .array(
        z
          .object({
            id: z.string(),
            consumable_code: z.string(),
            quantity: z.number().int(),
            from: PlaceId,
            to: PlaceId,
            sent_at: z.iso.datetime(),
            sent_by: z.string(),
          })
          .strict(),
      )
      .openapi({ description: "Transfers on their way, the oldest first: those either end of which is within reach." }),
    zones: z.array(z.string()).openapi({ description: "The zones a hub may be for." }),
    cities: z.array(z.string()).openapi({ description: "The active cities a stockroom may be in." }),
  })
  .strict()
  .openapi("Stock");

export const STOCK = { description: "What every place holds", ...json(StockSchema) };

export const Code = z.string().min(1).max(64);
export const Quantity = z.number().int().min(1).max(CONSUMABLE_BOUNDS.maxQuantity);
export const Note = z
  .string()
  .trim()
  .min(1)
  .max(MAX_NOTE)
  .regex(/^[^\p{Cc}]+$/u);

/** A hair system's pieces by their labels, as scanned: one movement takes as many as one delivery labels. */
export const Labels = z
  .array(z.string().max(32).refine(isPieceCode))
  .min(1)
  .max(MAX_LABELLED)
  .openapi({ description: "A hair system's pieces by their labels, as scanned; as many as the quantity." });

export const LotCode = z
  .string()
  .trim()
  .min(1)
  .max(40)
  .regex(/^[^\p{Cc}]+$/u)
  .openapi({ description: "The supplier's lot, as printed on the stock." });
