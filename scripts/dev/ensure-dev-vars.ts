// wrangler dev reads local secrets from .dev.vars, which git ignores. Create it
// from the committed example the first time; later, add any keys the example
// has gained since, and give a key left empty the example's value once it has
// one (scripts/lib/dev-vars.ts). A value already set is never overwritten.

import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { updatedDevVars } from "../lib/dev-vars.ts";

const EXAMPLE = ".dev.vars.example";
const LOCAL = ".dev.vars";

if (!existsSync(LOCAL)) {
  copyFileSync(EXAMPLE, LOCAL);
  console.log(`created ${LOCAL} from ${EXAMPLE}`);
} else {
  const update = updatedDevVars(readFileSync(LOCAL, "utf8"), readFileSync(EXAMPLE, "utf8"));
  if (update.added.length > 0 || update.filled.length > 0) {
    writeFileSync(LOCAL, update.text);
    if (update.added.length > 0) console.log(`added to ${LOCAL}: ${update.added.join(", ")}`);
    if (update.filled.length > 0) console.log(`filled in ${LOCAL}: ${update.filled.join(", ")}`);
  }
}
