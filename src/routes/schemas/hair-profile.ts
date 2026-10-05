// A client's hair profile as the API takes and gives it (docs/decisions/0106-a-clients-hair-profile.md): the fit
// spec and the history the technician's profile step sends, which ops' correction sends too, and the profile the
// technician's card and the client's page in the console read. The lists and ranges are src/policy/hair-profile.ts.

import { z } from "@hono/zod-openapi";
import { VISIT_TYPES } from "../../config/visit-types.ts";
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
} from "../../policy/hair-profile.ts";
import { PRICE_TIER } from "../../policy/services.ts";

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
  .openapi("HairHistory", {
    description: "Health information the client told us: our records alone, never Zoho or a log.",
  });

const FitSpecReadSchema = FitSpecSchema.extend({
  product_name: z.union([z.string(), z.null()]).openapi({ description: "The product's name, never its price." }),
}).openapi("HairFitSpecRead");

/** The version a write's form started from, so a write from an older copy is not taken for the latest silently. */
export const BasedOnSchema = z.union([z.uuid(), z.null()]).openapi({
  description: "The id of the version the form started from: the latest as it was read; null where there was none.",
});

/** The profile as it stands: a version, the latest. */
export const HairProfileSchema = z
  .object({
    id: z.uuid().openapi({ description: "The version's own ID, which a write names as based_on." }),
    recorded_at: z.iso.datetime(),
    fit: FitSpecReadSchema,
    history: z.union([HistorySchema, z.null()]).openapi({
      description: "Null where none was recorded.",
    }),
  })
  .strict()
  .openapi("HairProfile");

export const HairProfileVersionSchema = HairProfileSchema.extend({
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
