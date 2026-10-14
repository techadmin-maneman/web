// A person and their address, as most tests start from one: a client in Gurgaon. Every name and number is made up.

import { AT, nextSerial, writeRow, type RowOf } from "./rows.ts";

/** A client: Rohit Malhotra, with a number of their own, unless the test says otherwise. Answers their row. */
export const aPerson = (row: RowOf<"people"> = {}) =>
  writeRow(
    "people",
    {
      id: crypto.randomUUID(),
      created_at: AT,
      mobile_e164: `+91981${String(nextSerial()).padStart(7, "0")}`,
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
