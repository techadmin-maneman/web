// The profile's Help row (apps/app/src/profile/help-line.ts; docs/decisions/0136-care-names.md): the client's Care
// person by the name Customer Care gave them, and when Care reply, to every client.

import { describe, expect, it } from "vitest";
import { helpLine } from "../../../../apps/app/src/profile/help-line.ts";

const HOURS = { opens: 9, closes: 21, first_reply: 60 };

describe("the profile's Help row", () => {
  it("names the client's Care person, then when Care reply", () => {
    expect(helpLine({ care_person: "Asha", care_hours: HOURS })).toBe(
      "Asha, your Care person · We reply within an hour, 9 am–9 pm daily.",
    );
  });

  it("promises the reply time and the hours Care set to a client with no Care person yet", () => {
    expect(helpLine({ care_person: null, care_hours: HOURS })).toBe("We reply within an hour, 9 am–9 pm daily.");
  });
});
