// A visit as the client's app reads it in a list, with its photographs and any no-show note
// (src/routes/client/visits.ts), which their home, payments and the console's client record answer in too.

import { z } from "@hono/zod-openapi";
import { VISIT_TYPES } from "../../config/visit-types.ts";
import { ANGLES } from "../../domain/field/visit-photos.ts";
import { DISPUTE_RULINGS, NO_SHOW_DECISIONS } from "../../policy/no-show.ts";

const TechnicianSchema = z
  .object({ name: z.string(), initials: z.string() })
  .strict()
  .openapi("Technician", { description: "Display name and initials only." });

export const OneVisitPriceSchema = z
  .object({
    amount: z.union([z.number().int(), z.null()]).openapi({
      description:
        "In paise, GST included, after the visit's discount code: the least a hair system offered on the visit's " +
        "day costs. Null while none is priced.",
    }),
    from: z.boolean().openapi({ description: "The hair systems differ in price, so the amount is where they start." }),
    code: z.union([z.string(), z.null()]).openapi({ description: "The discount code on the visit; null for none." }),
  })
  .strict()
  .openapi("OneVisitPrice");

export const VisitSummarySchema = z
  .object({
    id: z.uuid(),
    date: z.iso.date().openapi({ description: "India's calendar date." }),
    window_label: z.enum(["morning", "afternoon", "evening"]),
    starts_at: z.iso.datetime(),
    ends_at: z.iso.datetime(),
    length_minutes: z.number().int(),
    type: z.union([z.enum(VISIT_TYPES), z.null()]),
    service: z.union([z.string(), z.null()]).openapi({
      description:
        "The service's name in the console, where it names more than the visit's kind: a first fit's hair system, " +
        "say. Null for a kind's standard service, and on a consultation and fit in one visit until the client chooses.",
    }),
    status: z.enum(["scheduled", "dispatched", "in_progress", "completed", "cancelled", "terminated", "other"]),
    not_home: z.boolean().openapi({ description: "Closed because nobody was home: a no-show." }),
    stage: z.union([z.enum(["booked", "in_progress", "done", "closing"]), z.null()]).openapi({
      description:
        "For a visit not yet closed: still to come, under way (the technician has checked in), closed as done " +
        "from the technician's phone, or otherwise over and waiting to be closed. Null once it is closed.",
    }),
    prepaid: z.boolean().openapi({ description: "Paid for ahead, or covered by a visit credit: the visit's Prepaid." }),
    technician: z.union([TechnicianSchema, z.null()]),
    place: z
      .string()
      .openapi({ description: "The saved address's area, city and pincode, else the visit's city and pincode." }),
    client_note: z.union([z.string(), z.null()]).openapi({
      description: "The client's note to the technician on this visit, as they last wrote it; null for none.",
    }),
    one_visit: z.union([OneVisitPriceSchema, z.null()]).openapi({
      description:
        "A consultation and fit in one visit not yet closed: the client pays only if they go ahead, once fitted, by " +
        "a link Razorpay texts them. Null for any other visit.",
    }),
  })
  .strict()
  .openapi("VisitSummary");
export const PhotoLinkSchema = z
  .object({
    angle: z.enum(ANGLES),
    url: z.string().openapi({ description: "Lasts 15 minutes; only the signed-in client can open it." }),
    thumbnail_url: z.union([z.string(), z.null()]).openapi({
      description:
        "Its small copy, for a row of thumbnails, likewise; null for a photograph with none, which the row shows " +
        "itself.",
    }),
    width: z.union([z.number().int(), z.null()]),
    height: z.union([z.number().int(), z.null()]),
  })
  .strict()
  .openapi("PhotoLink");
export const PhotoSetSchema = z
  .object({ before: z.array(PhotoLinkSchema), after: z.array(PhotoLinkSchema) })
  .strict()
  .openapi("PhotoSet", {
    description: "Each angle in the order front, top, left, right, hair; missing angles left out.",
  });
/** A visit the client was not home for, as their visit page and their Payments say it. */
export const NoShowNoteSchema = z
  .object({
    decision: z.enum(NO_SHOW_DECISIONS).openapi({
      description: "What ops ruled: undecided while they look at the evidence, charged, or waived.",
    }),
    waited_minutes: z.number().int().openapi({ description: "How long the technician waited at the door." }),
    charge: z
      .union([
        z
          .object({
            kept: z.number().int().openapi({ description: "In paise: what the charge kept of the visit's payment." }),
            credit_spent: z.boolean().openapi({ description: "Whether the charge spent the credit the visit used." }),
          })
          .strict(),
        z.null(),
      ])
      .openapi({
        description:
          "What the charge took, as the booking was sold to cost a no-show (ADR 0096). Null unless charged, and on a charge ruled before charges were recorded.",
      }),
    dispute: z.union([z.enum(["open", ...DISPUTE_RULINGS]), z.null()]).openapi({
      description:
        "The client's dispute of the charge: open while ops look, then refunded or upheld; null when none was raised.",
    }),
    disputable: z.boolean().openapi({
      description: "Whether the client may dispute the charge now: one that took something, not disputed yet.",
    }),
    dispute_closed_at: z.union([z.iso.datetime(), z.null()]).openapi({
      description:
        "When the days to dispute the charge ran out, once they have, for a charge that took something and was never disputed; null otherwise.",
    }),
  })
  .strict()
  .openapi("NoShowNote");
/**
 * The figures src/domain/visits/client-history.ts derives, which the client and ops
 * read from the one derivation. Each surface names its own replacement date
 * beside them: ops act on the day, the client is told only the month.
 */
export const HISTORY_FIGURES = {
  visits: z.number().int().openapi({ description: "Every visit done: a completed visit with a window." }),
  services: z.number().int(),
  replacements: z.number().int(),
  first_fit_on: z
    .union([z.iso.date(), z.null()])
    .openapi({ description: "India's date. Null when no first fit is on record, which is not the same as none." }),
  last_visit_on: z.union([z.iso.date(), z.null()]).openapi({ description: "India's date of the latest visit done." }),
  spend: z
    .number()
    .int()
    .openapi({ description: "In paise: every payment captured, less what has gone back. A credit adds nothing." }),
};
