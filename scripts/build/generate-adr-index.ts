// Writes docs/decisions/README.md, the index of every ADR, from their headers
// (scripts/lib/adr-index.ts). Run it after adding an ADR or changing a status.
//
//   npm run adr-index

import { writeFileSync } from "node:fs";
import { adrIndex, readDecisions } from "../lib/adr-index.ts";

const { adrs, others } = readDecisions();
writeFileSync("docs/decisions/README.md", adrIndex(adrs, others));
console.log(`docs/decisions/README.md: ${String(adrs.length)} ADRs, ${String(others.length)} other records`);
