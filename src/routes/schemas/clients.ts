// What the console's client routes share: the client's ID in the path, the answer when no client is found, and the
// address visits go to (src/routes/ops/clients.ts, client-address.ts).

import { z } from "@hono/zod-openapi";
import type { SavedAddress } from "../../domain/clients/profile.ts";
import { errorResponse } from "../../http/errors.ts";

export const clientId = z.object({ id: z.uuid() });
export const unknownClient = errorResponse(
  "not_found: no such client, or the client has been erased or is outside the caller's cities",
);

const nullable = z.union([z.string(), z.null()]);

export const ClientAddressSchema = z
  .object({
    line1: z.string(),
    line2: nullable,
    locality: z.string(),
    city: z.string(),
    pincode: z.string(),
    access_notes: nullable.openapi({ description: "For the technician: gate code, parking and the like." }),
    building: nullable.openapi({ description: "The building as chosen from the suggestions; null if typed." }),
    flat: nullable,
    floor: nullable,
    tower: nullable,
    landmark: nullable,
    given_to_ops: z
      .union([
        z
          .object({
            by: z.string().openapi({ description: "The Access e-mail of the member of staff who saved it." }),
            at: z.iso.datetime(),
          })
          .strict(),
        z.null(),
      ])
      .openapi({ description: "Where the client gave it to ops on the phone: who saved it, and when." }),
  })
  .strict()
  .openapi("ClientAddress");
/** The address visits go to now, as the client's page shows it. */

export const clientAddressOf = (address: SavedAddress) => ({
  line1: address.line1,
  line2: address.line2,
  locality: address.locality,
  city: address.city,
  pincode: address.pincode,
  access_notes: address.accessNotes,
  building: address.building,
  flat: address.flat,
  floor: address.floor,
  tower: address.tower,
  landmark: address.landmark,
  given_to_ops: address.givenToOps === null ? null : { by: address.givenToOps.staff, at: address.givenToOps.at },
});
