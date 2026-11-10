// A client's hair profile as the API takes and gives it (docs/decisions/0106-a-clients-hair-profile.md): the fit
// spec and the history the technician's profile step sends, which ops' correction sends too, and the profile the
// technician's card and the client's page in the console read. The lists and ranges are src/policy/hair-profile.ts.
// The head is measured in inches; for one release a phone or console of the build before may still send and read it
// in centimetres (docs/decisions/0240-consultation-rules-and-inches.md).

import { z } from "@hono/zod-openapi";
import { VISIT_TYPES } from "../../config/visit-types.ts";
import {
  ATTACHMENTS,
  CENTIMETRES,
  COLOURS,
  DENSITIES,
  GREY_PERCENT,
  HAIRLINES,
  MEASUREMENTS,
  NORWOOD_STAGES,
  REMEDIES,
  SKIN_AND_ALLERGIES_MAX,
  WAVES,
  inchesOf,
  type Centimetre,
} from "../../policy/hair-profile.ts";
import { PRICE_TIER } from "../../policy/services.ts";

/** A measurement in its range, to one decimal; null where it was not taken. */
const measured = ({ min, max }: { readonly min: number; readonly max: number }, unit: string) => {
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
    head_circumference_in: measured(MEASUREMENTS.head_circumference_in, "inches"),
    front_to_nape_in: measured(MEASUREMENTS.front_to_nape_in, "inches"),
    ear_to_ear_in: measured(MEASUREMENTS.ear_to_ear_in, "inches, over the top"),
    temple_to_temple_in: measured(MEASUREMENTS.temple_to_temple_in, "inches"),
    base_width_in: measured(MEASUREMENTS.base_width_in, "inches"),
    base_length_in: measured(MEASUREMENTS.base_length_in, "inches"),
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

/**
 * One of the head's measurements in centimetres, the build before's, for one release: as given, the inches to one
 * decimal, and as taken, to one decimal and checked in inches.
 */
const centimetres = (cm: Centimetre, taken: boolean) =>
  (taken ? z.number().multipleOf(0.1) : z.number())
    .nullable()
    .optional()
    .openapi({ deprecated: true, description: `${CENTIMETRES[cm]} in centimetres, for one release.` });

const inCentimetres = (taken: boolean) => ({
  head_circumference_cm: centimetres("head_circumference_cm", taken),
  front_to_nape_cm: centimetres("front_to_nape_cm", taken),
  ear_to_ear_cm: centimetres("ear_to_ear_cm", taken),
  temple_to_temple_cm: centimetres("temple_to_temple_cm", taken),
});

/**
 * The fit spec a write sends: the head in inches, or from a phone or console of the build before in centimetres, each
 * measurement in one of them, and centimetres in the range of the inches they become. fitInInches gives it as the fit
 * spec.
 */
export const FitSpecWriteSchema = FitSpecSchema.partial({
  head_circumference_in: true,
  front_to_nape_in: true,
  ear_to_ear_in: true,
  temple_to_temple_in: true,
})
  .extend(inCentimetres(true))
  .strict()
  .superRefine((fit, context) => {
    for (const [cm, inches] of Object.entries(CENTIMETRES)) {
      const sent = fit[cm as Centimetre];
      const given = [fit[inches], sent].filter((figure) => figure !== undefined);
      if (given.length !== 1) context.addIssue({ code: "custom", path: [inches], message: "in inches or centimetres" });
      const { min, max } = MEASUREMENTS[inches];
      if (typeof sent === "number" && (inchesOf(sent) < min || inchesOf(sent) > max)) {
        context.addIssue({ code: "custom", path: [cm], message: `${String(min)} to ${String(max)} inches` });
      }
    }
  })
  .openapi("HairFitSpecWrite", {
    description:
      "Every field is sent, null where it was not taken; the head in inches, or in centimetres for one release.",
  });

/** The fit spec a write sent, the head in inches: centimetres from the build before taken in inches, to one decimal. */
export function fitInInches(fit: z.infer<typeof FitSpecWriteSchema>): z.infer<typeof FitSpecSchema> {
  const { head_circumference_cm, front_to_nape_cm, ear_to_ear_cm, temple_to_temple_cm, ...rest } = fit;
  const inches = (sent: number | null | undefined, cm: number | null | undefined): number | null => {
    if (sent !== undefined) return sent;
    return cm === undefined || cm === null ? null : inchesOf(cm);
  };
  return {
    ...rest,
    head_circumference_in: inches(rest.head_circumference_in, head_circumference_cm),
    front_to_nape_in: inches(rest.front_to_nape_in, front_to_nape_cm),
    ear_to_ear_in: inches(rest.ear_to_ear_in, ear_to_ear_cm),
    temple_to_temple_in: inches(rest.temple_to_temple_in, temple_to_temple_cm),
  };
}

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
  ...inCentimetres(false),
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
