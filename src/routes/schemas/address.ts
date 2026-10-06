// The one address shape, as the app saves it and the site's booking forms and ops' save take it
// (src/routes/client/address.ts, src/routes/public/consultations.ts, src/routes/ops/client-address.ts).

import { z } from "@hono/zod-openapi";
import type { Address } from "../../domain/clients/profile.ts";
import { CODE_TEXT } from "../../policy/one-time-code.ts";

const blankToNull = (value: string | null | undefined): string | null =>
  value === undefined || value === null || value.trim() === "" ? null : value;
/**
 * Nullish rather than nullable: an address saved before migration 0028 holds
 * nothing in these, and a client that predates them sends nothing. Both must
 * keep working, so leaving one out means the same as sending null.
 */
const part = (max: number) => z.string().trim().max(max).nullish();

const optional = (max: number) => z.string().trim().max(max).nullable();

/** The one address shape, which the site's booking forms take too (src/routes/public/consultations.ts). */

export const AddressSchema = z
  .object({
    line1: z.string().trim().min(1).max(120),
    line2: z.string().trim().max(120).nullable(),
    locality: z.string().trim().min(1).max(80),
    city: z.string().trim().min(1).max(40),
    pincode: z.string().regex(CODE_TEXT),
    access_notes: optional(300).openapi({
      description: "For the technician, from the day before the visit: gate code, parking.",
    }),
    building: part(120).openapi({ description: "The building as chosen from the suggestions; null if typed." }),
    flat: part(40),
    floor: part(20),
    tower: part(40),
    landmark: part(120),
    place_id: part(300).openapi({ description: "Google's Place ID for the building, if one was chosen." }),
  })
  .strict()
  .openapi("Address");
/**
 * The flat or house number, which every address given from now on must carry, so the technician finds the door. An
 * address saved before holds none and still reads.
 */

export const RequiredFlatSchema = z.string().trim().min(1).max(40);

/**
 * What the app sends. `session_token` is the same string the app passed to every
 * suggestion request; it groups them into one billed session, and without it
 * Google bills per keystroke (docs/decisions/0054-address-capture.md). The
 * coordinate is never sent: only this API may put one on an address, and only
 * by geocoding the Place ID itself.
 */

export const AddressSaveSchema = AddressSchema.extend({
  flat: RequiredFlatSchema,
  session_token: part(100),
})
  .strict()
  .openapi("AddressSave");

export const SuggestionsSchema = z
  .object({
    suggestions: z.array(z.object({ place_id: z.string(), primary: z.string(), secondary: z.string() }).strict()),
    /** Google requires their name against content shown without a Google map. */
    attribution: z.literal("Google Maps"),
  })
  .strict()
  .openapi("AddressSuggestions");
/** An address as it was sent, a part left blank held as none. */

export function addressOf(body: z.infer<typeof AddressSchema>): Address {
  return {
    line1: body.line1,
    line2: blankToNull(body.line2),
    locality: body.locality,
    city: body.city,
    pincode: body.pincode,
    accessNotes: blankToNull(body.access_notes),
    building: blankToNull(body.building),
    flat: blankToNull(body.flat),
    floor: blankToNull(body.floor),
    tower: blankToNull(body.tower),
    landmark: blankToNull(body.landmark),
    placeId: blankToNull(body.place_id),
  };
}
