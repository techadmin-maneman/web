// The bodies of the technician's steps that are read again after they land: what was ticked, what was used, the
// piece, and how the job closed.
// The route checks a step against these on the way in (src/routes/tech/jobs.ts) and stores it as it came, and the
// domain reads the stored body back through the same schema, so the two cannot drift apart.

import { z } from "@hono/zod-openapi";
import { CONSUMABLE_BOUNDS } from "../../config/consumables.ts";
import { SHORT_REASONS } from "../../policy/consumable-shortfall.ts";
import { ALERT_MAX_CHARS, HANDOFF_MAX_CHARS } from "../../policy/client-record.ts";

const QUANTITY = z.number().int().min(1).max(CONSUMABLE_BOUNDS.maxExpected);

export const ChecklistRequestSchema = z
  .object({ done: z.array(z.string().min(1).max(64)).max(20) })
  .strict()
  .openapi("ChecklistRequest");

const PieceFittedSchema = z
  .object({
    piece_code: z
      .string()
      .min(3)
      .max(40)
      .optional()
      .openapi({
        description:
          "The label on the piece, read or typed. Left out where the piece has none, with no_label, and the step is " +
          "recorded under one made for it from the visit (docs/decisions/0291-pieces-without-labels.md).",
      }),
    no_label: z
      .literal(true)
      .optional()
      .openapi({
        description:
          "The piece has no label to read, so none is sent: the hair system it is, picked from the kit by stock_code, " +
          "comes out of the kit as it would with one, from a lot in date. Refused, fields stock_code, with none " +
          "picked, or where every piece of it the kit holds has expired.",
      }),
    base: z
      .string()
      .min(1)
      .max(120)
      .nullable()
      .optional()
      .openapi({
        description:
          "The piece's base; for one from the kit, its hair system's name, which a service's name of up to 60 and its " +
          "spec make up to about 112 (docs/decisions/0271-the-technician-follow-ups.md).",
      }),
    supplier_lot: z.string().min(1).max(60).nullable().optional(),
    stock_code: z.string().min(1).max(64).nullable().optional().openapi({
      description:
        "The hair system fitted, by the stock code the card's kit list gives it, which comes out of the technician's kit; none for a piece from elsewhere.",
    }),
    failure_reason: z.string().min(1).max(200).nullable().optional(),
    old_piece: z
      .object({ piece_code: z.string().min(3).max(40), failure_reason: z.string().min(1).max(200).optional() })
      .strict()
      .nullable()
      .optional()
      .openapi({
        description:
          "On a replacement: the piece that came off, and why it failed where it did, by a code of the card's " +
          "failure_reasons or in words; with no reason, it was due and is replaced (ADR 0273).",
      }),
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

const PieceDeclinedSchema = z
  .object({ declined: z.literal(true) })
  .strict()
  .openapi("PieceDeclined", {
    description:
      "On a one visit, and only there: the client decided against the fit, so nothing was fitted, and closing the " +
      "visit as done makes it a consultation.",
  });

const PieceLaterSchema = z
  .object({ product: z.string().min(1).max(32), fit_later: z.literal(true) })
  .strict()
  .openapi("PieceFitLater", {
    description:
      "On a one visit, and only there: the client chose the product, by its tier from the card's products, and books " +
      "the fit for another day, so nothing is fitted today. Closing the visit as done makes it a consultation going " +
      "ahead, with the product as the client's pick; nothing is charged (docs/decisions/0247-the-steps-left.md).",
  });

export const PieceRequestSchema = z
  .union([PieceFittedSchema, PieceDeclinedSchema, PieceLaterSchema])
  .openapi("PieceRequest");

type PieceBody = z.infer<typeof PieceRequestSchema>;

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
    short_reason: z
      .enum(SHORT_REASONS)
      .optional()
      .openapi({
        description:
          "Why less was used than the service expects, or nothing on a visit that always uses something; refused, " +
          "fields short_reason, when it is owed and left out (docs/decisions/0222-consumables-short-of-expected.md).",
      }),
  })
  .strict()
  .openapi("ConsumablesRequest", {
    description:
      "What was used, each by the code the job's card gave it. None used is an empty list. A code the " +
      "catalogue does not hold is refused, fields items.",
  });

/** One line of a consumables step: by code, or by name from before the codes. */
export type UsedLine = z.infer<typeof ConsumablesRequestSchema>["items"][number];

/**
 * What any close may leave on the client's record (docs/decisions/0242-client-record.md): a note for the next
 * technician, and an alert every technician reads before they start. Kept in their own tables, never in the event.
 */
const CLOSE_NOTES = {
  handoff_note: z.string().trim().min(1).max(HANDOFF_MAX_CHARS).optional().openapi({
    description: "A note for the next technician, shown on this client's next job whoever takes it.",
  }),
  client_alert: z.string().trim().min(1).max(ALERT_MAX_CHARS).optional().openapi({
    description: "An alert every technician reads before they start, kept on the client until ops take it off.",
  }),
};

export const OutcomeRequestSchema = z
  .discriminatedUnion("outcome", [
    z
      .object({
        outcome: z.literal("done"),
        lost_reason: z
          .string()
          .min(1)
          .max(64)
          .optional()
          .openapi({
            description:
              "On a consultation, why the client is not going ahead with a fit: one of the card's lost_reasons, by its " +
              "id. Left out where they are going ahead, or the visit is no consultation (ADR 0149).",
          }),
        going_ahead: z.boolean().optional().openapi({
          description:
            "On a consultation, whether the client said they are going ahead with a fit; left out where not asked.",
        }),
        product: z
          .string()
          .min(1)
          .max(32)
          .optional()
          .openapi({
            description:
              "On a consultation going ahead, the hair system the client picked from Options, by its tier: one offered " +
              "on the visit's day. Left out where none was picked (ADR 0247).",
          }),
        ...CLOSE_NOTES,
      })
      .strict(),
    z
      .object({
        outcome: z.literal("partial"),
        reason: z
          .string()
          .min(1)
          .max(64)
          .openapi({
            description:
              "One of the card's partial_reasons, by its id; one ops have since taken off is still taken. `no_piece` " +
              "with cannot_fit.",
          }),
        cannot_fit: z
          .literal(true)
          .optional()
          .openapi({
            description:
              "Can't fit today: a fit closed from its piece step with no piece of the client's spec to fit, its reason " +
              "`no_piece`. It follows the step before the piece, and ops are given the refit to book.",
          }),
        not_fitted_reason: z
          .string()
          .min(1)
          .max(64)
          .optional()
          .openapi({
            description:
              "With cannot_fit, why: one of the card's not_fitted_reasons, by its id; one ops have since taken off is " +
              "still taken. Left out by a phone on a build before it was asked (ADR 0270).",
          }),
        ...CLOSE_NOTES,
      })
      .strict(),
  ])
  .openapi("OutcomeRequest");

/** An outcome as it is stored: what the phone sent, or the no-show the route writes itself. */
const StoredOutcomeSchema = z.union([OutcomeRequestSchema, z.object({ outcome: z.literal("no_show") }).strict()]);
type StoredOutcome = z.infer<typeof StoredOutcomeSchema>;

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

/** A one visit's piece step that fitted nothing: the fit declined, or booked for later. */
type NothingFitted = z.infer<typeof PieceDeclinedSchema> | z.infer<typeof PieceLaterSchema>;

/** Whether a one visit's piece step fitted nothing that day: the client decided against it, or booked it for later. */
export const fitsNothing = (piece: PieceBody): piece is NothingFitted => "declined" in piece || "fit_later" in piece;

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
