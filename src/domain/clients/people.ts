// The one way a person is written from a number someone typed: made if nobody holds it, and never renamed if
// somebody does, since anyone can type a number into a form.

import { insertRow } from "../../lib/sql.ts";

interface TypedPerson {
  readonly id: string;
  readonly mobile: string;
  readonly name: string;
  readonly testRecord: boolean;
  /**
   * "becomes": they asked us for something, so we may message them, even a person we knew. "as_before": a person we
   * knew keeps whether we may, and a new one is not yet contactable.
   */
  readonly contactable: "becomes" | "as_before";
  readonly at: string;
}

export function personByMobile(db: D1Database, person: TypedPerson): D1PreparedStatement {
  return insertRow(
    db,
    "people",
    {
      id: person.id,
      created_at: person.at,
      mobile_e164: person.mobile,
      name: person.name,
      contactable: person.contactable === "becomes" ? 1 : 0,
      test_record: person.testRecord ? 1 : 0,
    },
    person.contactable === "becomes"
      ? "ON CONFLICT (mobile_e164) DO UPDATE SET contactable = 1"
      : "ON CONFLICT (mobile_e164) DO NOTHING",
  );
}
