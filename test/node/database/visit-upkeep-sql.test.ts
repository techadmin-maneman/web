// The SQL the seeds run after the visits they write by hand (scripts/lib/every-visit-upkeep.ts) is the domain's own
// upkeep (src/domain/visits/visit-upkeep.ts), written out: a change to one shows here until `npm run gen` writes the
// other again.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { everyVisitUpkeepModule } from "../../../scripts/lib/visit-upkeep-sql.ts";

describe("the seeds' visit upkeep", () => {
  it("is scripts/lib/every-visit-upkeep.ts as npm run gen writes it", () => {
    expect(readFileSync("scripts/lib/every-visit-upkeep.ts", "utf8")).toBe(everyVisitUpkeepModule());
  });
});
