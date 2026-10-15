// Writes docs/settings.md, every setting and where it lives (scripts/lib/settings-doc.ts). Run it after a var, a fixed
// limit, a per-environment constant or a rule changes.
//
//   npm run settings

import { writeFileSync } from "node:fs";
import { settingsDoc } from "../lib/settings-doc.ts";

writeFileSync("docs/settings.md", settingsDoc());
console.log("docs/settings.md written");
