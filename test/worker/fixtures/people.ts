// A person and their address, as most tests start from one: a client in Gurgaon. Every name and number is made up.

import { AT, nextSerial, writeRow, type RowOf } from "./rows.ts";

/** A client: Rohit Malhotra, with a number of their own, unless the test says otherwise. Answers their row. */
export const aPerson = (row: RowOf<"people"> = {}) =>
  writeRow(
    "people",
    {
      id: crypto.randomUUID(),
      created_at: AT,
      mobile_e164: `+91966${String(nextSerial()).padStart(7, "0")}`,
      name: "Rohit Malhotra",
    },
    row,
  );

/** Where a client lives, in a pincode we serve in Gurgaon. */
export const anAddress = (personId: string, row: RowOf<"addresses"> = {}) =>
  writeRow(
    "addresses",
    {
      id: crypto.randomUUID(),
      person_id: personId,
      created_at: AT,
      line1: "House 4417, Tower C",
      locality: "Sector 65",
      city: "Gurgaon",
      pincode: "122018",
    },
    row,
  );

/** The hair profile a client's consultation measured: an Essential, 8 by 10 inches, 1B, 20% grey, full density. */
export const aHairProfile = (personId: string, row: RowOf<"hair_profiles"> = {}) =>
  writeRow(
    "hair_profiles",
    {
      id: crypto.randomUUID(),
      person_id: personId,
      staff: "ops@localhost",
      created_at: AT,
      product: "essential",
      base_width_in: 8,
      base_length_in: 10,
      colour: "1B",
      grey_percent: 20,
      density_percent: 100,
    },
    row,
  );
