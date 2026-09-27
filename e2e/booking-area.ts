// The service area the booking tests need in the local database: one pincode a
// technician works in, one we do not serve yet, and the technician who takes the
// visit. Seeded once, before any test runs (e2e/global-setup.ts).
//
// Every value here is made up. The pincodes are the design's own.

import { wrangler } from "./app/fitted.ts";
import { technicianFor } from "./technicians.ts";

export const SERVED = { pincode: "122018", area: "Gurgaon South City II", city: "Gurgaon" };
export const UNSERVED = { pincode: "400050", area: "Bandra", city: "Mumbai" };

export async function seedBookingArea(): Promise<void> {
  const now = new Date().toISOString();
  const sql = [
    `INSERT OR REPLACE INTO serviceable_pincodes (pincode, area, city, served, launched_at)
       VALUES ('${SERVED.pincode}', '${SERVED.area}', '${SERVED.city}', 1, '${now}');`,
    `INSERT OR REPLACE INTO serviceable_pincodes (pincode, area, city, served, launched_at)
       VALUES ('${UNSERVED.pincode}', '${UNSERVED.area}', '${UNSERVED.city}', 0, NULL);`,
    // A technician for the slot to be claimed against; the booking holds one of their half-slots.
    ...technicianFor("booking", now),
  ].join("\n");
  await wrangler("d1", "execute", "DB", "--local", "--command", sql);
}
