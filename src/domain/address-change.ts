// Whether a client may move their address to a pincode, as src/policy/address-change.ts rules it.

import { addressRefusal, type AddressRefusal } from "../policy/address-change.ts";
import { pincodeOf } from "./service-area.ts";

/** The cities of the client's visits still to come: booked, or paid for and on their way to being booked. */
async function citiesOfVisitsToCome(db: D1Database, personId: string): Promise<string[]> {
  const { results } = await db
    .prepare(
      `SELECT sp.city FROM appointments a JOIN serviceable_pincodes sp ON sp.pincode = a.service_pincode
       WHERE a.person_id = ?1 AND a.deleted_at IS NULL AND a.status IN ('scheduled', 'dispatched', 'in_progress')
       UNION
       SELECT sp.city FROM slot_holds h JOIN serviceable_pincodes sp ON sp.pincode = h.pincode
       WHERE h.person_id = ?1 AND h.state = 'held' AND h.confirmed_at IS NOT NULL`,
    )
    .bind(personId)
    .all<{ city: string }>();
  return results.map((row) => row.city);
}

/** Why the client may not move their address to this pincode; null when they may. */
export async function addressChangeRefusal(
  db: D1Database,
  personId: string,
  pincode: string,
): Promise<AddressRefusal | null> {
  const pin = await pincodeOf(db, pincode);
  return addressRefusal({
    served: pin?.served === 1,
    city: pin?.city ?? null,
    visitCities: await citiesOfVisitsToCome(db, personId),
  });
}
