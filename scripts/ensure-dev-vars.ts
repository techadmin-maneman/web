// wrangler dev reads local secrets from .dev.vars, which git ignores. Create it
// from the committed example the first time; later, add any keys the example
// has gained since. An existing value is never overwritten.

import { appendFileSync, copyFileSync, existsSync, readFileSync } from "node:fs";

const EXAMPLE = ".dev.vars.example";
const LOCAL = ".dev.vars";

const keysOf = (text: string): Set<string> =>
  new Set(text.split(/\r?\n/).flatMap((line) => /^([A-Z0-9_]+)=/.exec(line)?.[1] ?? []));

if (!existsSync(LOCAL)) {
  copyFileSync(EXAMPLE, LOCAL);
  console.log(`created ${LOCAL} from ${EXAMPLE}`);
} else {
  const have = keysOf(readFileSync(LOCAL, "utf8"));
  const missing = readFileSync(EXAMPLE, "utf8")
    .split(/\r?\n/)
    .filter((line) => {
      const key = /^([A-Z0-9_]+)=/.exec(line)?.[1];
      return key !== undefined && !have.has(key);
    });
  if (missing.length > 0) {
    const current = readFileSync(LOCAL, "utf8");
    appendFileSync(LOCAL, `${current.endsWith("\n") ? "" : "\n"}${missing.join("\n")}\n`);
    console.log(`added to ${LOCAL}: ${missing.map((line) => line.split("=")[0]).join(", ")}`);
  }
}
