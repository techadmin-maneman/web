// A client's hair profile as the API takes and gives it (docs/decisions/0106-a-clients-hair-profile.md): the fit
// spec and the history the technician's profile step sends, which ops' correction sends too, and the profile the
// technician's card and the client's page in the console read. The lists and ranges are src/policy/hair-profile.ts.

import { z } from "@hono/zod-openapi";
import { PRICE_TIER } from "../config/ops-settings.ts";
import { VISIT_TYPES } from "../config/visit-types.ts";
import {
  ATTACHMENTS,
  COLOURS,
  DENSITIES,
  GREY_PERCENT,
  HAIRLINES,
  MEASUREMENTS,
  NORWOOD_STAGES,
  REMEDIES,
  SKIN_AND_ALLERGIES_MAX,
  WAVES,
  type Measurement,
} from "../policy/hair-profile.ts";

/** A measurement in its range, to one decimal; null where it was not taken. */
const measured = (measurement: Measurement, unit: string) => {
  const { min, max } = MEASUREMENTS[measurement];
  return z
    .number()
    .min(min)
    .max(max)
    .multipleOf(0.1)
    .nullable()
    .openapi({ description: `In ${unit}, ${String(min)} to ${String(max)}, to one decimal.` });
};

const listed = <T extends readonly [string, ...string[]]>(codes: T) => z.enum(codes).nullable();

export const FitSpecSchema = z
  .object({
    norwood_stage: listed(NORWOOD_STAGES),
    head_circumference_cm: measured("head_circumference_cm", "centimetres"),
    front_to_nape_cm: measured("front_to_nape_cm", "centimetres"),
    ear_to_ear_cm: measured("ear_to_ear_cm", "centimetres, over the top"),
    temple_to_temple_cm: measured("temple_to_temple_cm", "centimetres"),
    base_width_in: measured("base_width_in", "inches"),
    base_length_in: measured("base_length_in", "inches"),
    colour: listed(COLOURS).openapi({ description: "The suppliers' colour code, #1B written 1B." }),
    grey_percent: z.number().int().min(GREY_PERCENT.min).max(GREY_PERCENT.max).nullable(),
    density_percent: z
      .union([z.literal(DENSITIES[0]), z.literal(DENSITIES[1]), z.literal(DENSITIES[2]), z.literal(DENSITIES[3])])
      .nullable()
      .openapi({ description: "In per cent." }),
    wave: listed(WAVES),
    hairline: listed(HAIRLINES),
    product: z.string().regex(PRICE_TIER).nullable().openapi({
      description: "The product, by the tier of its first-fit service: one the services table holds, retired or not.",
    }),
    attachment: listed(ATTACHMENTS).openapi({ description: "Tape, glue, or both." }),
  })
  .strict()
  .openapi("HairFitSpec", { description: "Every field is sent, null where it was not taken." });

export const HistorySchema = z
  .object({
    remedies: z.array(z.enum(REMEDIES)).max(REMEDIES.length).openapi({
      description: "Every remedy the client has tried, each once; none, said alone, for none. Empty: not answered.",
    }),
    transplant_year: z.number().int().min(1900).max(2100).nullable().openapi({
      description: "With a transplant only, and no later than this year.",
    }),
    skin_and_allergies: z.string().trim().min(1).max(SKIN_AND_ALLERGIES_MAX).nullable(),
  })
  .strict()
  .openapi("HairHistory", { description: "Health information: recorded only with the client's consent to it." });

const NoticeVersion = z.string().min(1).max(64).openapi({ description: "The notice the phone showed the client." });

/**
 * What the technician's phone says of the history: the client agreed, on the notice it showed, and answered; the
 * client declined, which withdraws any consent given before and blanks the history in every version; or, as null,
 * the technician did not ask.
 */
export const HealthAnswerSchema = z
  .discriminatedUnion("consent", [
    HistorySchema.extend({ consent: z.literal("given"), notice_version: NoticeVersion }).strict(),
    z.object({ consent: z.literal("refused"), notice_version: NoticeVersion }).strict(),
  ])
  .nullable()
  .openapi("HairHealthAnswer");

export const FitSpecReadSchema = FitSpecSchema.extend({
  product_name: z.union([z.string(), z.null()]).openapi({ description: "The product's name, never its price." }),
}).openapi("HairFitSpecRead");

/** The profile as it stands: a version, the latest. */
export const HairProfileSchema = z
  .object({
    recorded_at: z.iso.datetime(),
    fit: FitSpecReadSchema,
    history: z.union([HistorySchema, z.null()]).openapi({
      description: "Null where none was recorded with the client's consent, or the client withdrew it.",
    }),
  })
  .strict()
  .openapi("HairProfile");

export const HealthConsentSchema = z
  .object({
    state: z.enum(["given", "not_given", "withdrawn"]).openapi({
      description: "withdrawn: the client declined, or withdrew it; not_given: they have never been asked.",
    }),
    notice_version: z.union([z.string(), z.null()]),
    at: z.union([z.iso.datetime(), z.null()]),
  })
  .strict()
  .openapi("HairHealthConsent", { description: "The client's consent to their health history, as it stands." });

export const HairProfileVersionSchema = HairProfileSchema.extend({
  id: z.uuid(),
  recorded_by: z.discriminatedUnion("kind", [
    z
      .object({ kind: z.literal("technician"), name: z.union([z.string(), z.null()]) })
      .strict()
      .openapi({ description: "The technician, by first name." }),
    z
      .object({ kind: z.literal("ops"), staff: z.string() })
      .strict()
      .openapi({ description: "The Access e-mail of the member of staff who corrected it." }),
  ]),
  visit: z
    .union([
      z
        .object({
          id: z.uuid(),
          date: z.union([z.iso.date(), z.null()]).openapi({ description: "Its day in India." }),
          type: z.union([z.enum(VISIT_TYPES), z.null()]),
        })
        .strict(),
      z.null(),
    ])
    .openapi({ description: "The visit it was taken at; null for a correction." }),
}).openapi("HairProfileVersion");
