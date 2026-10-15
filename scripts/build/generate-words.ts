// Writes src/config/words.json, every line the Words page may change, from the site's copy and the message texts
// (scripts/lib/words-catalogue.ts). Run it after the copy changes; `npm run gen` runs it too. The catalogue is loaded
// through Vite, as the tests load it, so the front ends' "@rules/…" resolves and each module's lines keep the order
// they are written in.
//
//   npm run words

import { writeFileSync } from "node:fs";
import { runnerImport } from "vite";
import { RULES_ALIAS } from "./rules-alias.ts";

const { module } = await runnerImport<typeof import("../lib/words-catalogue.ts")>("./scripts/lib/words-catalogue.ts", {
  configFile: false,
  resolve: { alias: RULES_ALIAS },
  logLevel: "error",
});
writeFileSync("src/config/words.json", module.wordsFile());
console.log("src/config/words.json written");
