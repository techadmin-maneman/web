// Writes scripts/lib/every-visit-upkeep.ts, the SQL the seeds run after the visits they write by hand, from the
// domain's own statements (scripts/lib/visit-upkeep-sql.ts). Run it after src/domain/visits/visit-upkeep.ts changes.
//
//   npm run gen

import { writeFileSync } from "node:fs";
import { everyVisitUpkeepModule } from "../lib/visit-upkeep-sql.ts";

writeFileSync("scripts/lib/every-visit-upkeep.ts", everyVisitUpkeepModule());
console.log("scripts/lib/every-visit-upkeep.ts written");
