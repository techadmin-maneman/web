// The bodies of the technician's steps that are read again after they land: what was used, and how the job closed.
// The route checks a step against these on the way in (src/routes/tech-jobs.ts) and stores it as it came, and the
// domain reads the stored body back through the same schema, so the two cannot drift apart.

import { z } from "@hono/zod-openapi";
import { CONSUMABLE_BOUNDS } from "../config/consumables.ts";

const QUANTITY = z.number().int().min(1).max(CONSUMABLE_BOUNDS.maxExpected);

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
