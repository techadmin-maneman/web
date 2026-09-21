// wrangler dev reads local secrets from .dev.vars, which git ignores. Create it
// from the committed example the first time, and never overwrite it.

import { copyFileSync, existsSync } from "node:fs";

if (!existsSync(".dev.vars")) {
  copyFileSync(".dev.vars.example", ".dev.vars");
  console.log("created .dev.vars from .dev.vars.example");
}
