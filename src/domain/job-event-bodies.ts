// The bodies of the technician's steps that are read again after they land: what was ticked, what was used, the
// piece, and how the job closed.
// The route checks a step against these on the way in (src/routes/tech/jobs.ts) and stores it as it came, and the
// domain reads the stored body back through the same schema, so the two cannot drift apart.

import { z } from "@hono/zod-openapi";
import { CONSUMABLE_BOUNDS } from "../config/consumables.ts";

const QUANTITY = z.number().int().min(1).max(CONSUMABLE_BOUNDS.maxExpected);

export const ChecklistRequestSchema = z
  .object({ done: z.array(z.string().min(1).max(64)).max(20) })
  .strict()
  .openapi("ChecklistRequest");

export const PieceFittedSchema = z
  .object({
    piece_code: z.string().min(3).max(40),
    base: z.string().min(1).max(60).nullable().optional(),
    supplier_lot: z.string().min(1).max(60).nullable().optional(),
    failure_reason: z.string().min(1).max(200).nullable().optional(),
    old_piece: z
      .object({ piece_code: z.string().min(3).max(40), failure_reason: z.string().min(1).max(200) })
      .strict()
      .nullable()
      .optional()
      .openapi({ description: "On a replacement: the piece that came off, and why it failed." }),
    product: z.string().min(1).max(32).optional().openapi({
      description:
        "On a one visit, and only there: the product the client chose, by its tier from the card's products.",
    }),
  })
  .strict()
  .openapi("PieceFitted", {
    description:
      "The piece fitted, with its base and lot, and on a replacement the one that came off. A failure_reason on the piece itself marks it as failed and fits nothing.",
  });

export const PieceDeclinedSchema = z
  .object({ declined: z.literal(true) })
  .strict()
  .openapi("PieceDeclined", {
    description:
      "On a one visit, and only there: the client decided against the fit, so nothing was fitted, and closing the " +
      "visit as done makes it a consultation.",
  });

export const PieceRequestSchema = z.union([PieceFittedSchema, PieceDeclinedSchema]).openapi("PieceRequest");

export type PieceBody = z.infer<typeof PieceRequestSchema>;

export const ConsumablesRequestSchema = z
  .object({
    items: z
      .array(
        z.union([
          z.object({ code: z.string().min(1).max(64), quantity: QUANTITY }).strict(),
          z
            .object({ name: z.string().min(1).max(80), quantity: QUANTITY })
            .strict()
            .openapi({
              description: "A consumable by the name the technician gave it, as a phone queued it before codes.",
            }),
        ]),
      )
      .max(30),
  })
  .strict()
  .openapi("ConsumablesRequest", {
    description:
      "What was used, each by the code the job's card gave it. None used is an empty list. A code the " +
      "catalogue does not hold is refused, fields items.",
  });

/** One line of a consumables step: by code, or by name from before the codes. */
export type UsedLine = z.infer<typeof ConsumablesRequestSchema>["items"][number];

export const OutcomeRequestSchema = z
  .discriminatedUnion("outcome", [
    z.object({ outcome: z.literal("done") }).strict(),
    z
      .object({
        outcome: z.literal("partial"),
        reason: z.string().min(1).max(64).openapi({
          description: "One of the card's partial_reasons, by its id; one ops have since taken off is still taken.",
        }),
      })
      .strict(),
  ])
  .openapi("OutcomeRequest");

/** An outcome as it is stored: what the phone sent, or the no-show the route writes itself. */
const StoredOutcomeSchema = z.union([OutcomeRequestSchema, z.object({ outcome: z.literal("no_show") }).strict()]);
export type StoredOutcome = z.infer<typeof StoredOutcomeSchema>;

/** The checklist's items a stored checklist step ticked; none for a body that is not one. */
export function tickedItemsOf(body: unknown): string[] {
  const parsed = ChecklistRequestSchema.safeParse(body);
  return parsed.success ? parsed.data.done : [];
}

/** A stored piece step; null for a body that is not one. */
export function pieceBodyOf(body: unknown): PieceBody | null {
  const parsed = PieceRequestSchema.safeParse(body);
  return parsed.success ? parsed.data : null;
}

/** The lines a stored consumables step names; none for a body that is not one. */
export function usedLinesOf(body: unknown): UsedLine[] {
  const parsed = ConsumablesRequestSchema.safeParse(body);
  return parsed.success ? parsed.data.items : [];
}

/** A stored outcome step's outcome; null for a body that is not one. */
export function storedOutcomeOf(body: unknown): StoredOutcome | null {
  const parsed = StoredOutcomeSchema.safeParse(body);
  return parsed.success ? parsed.data : null;
}
