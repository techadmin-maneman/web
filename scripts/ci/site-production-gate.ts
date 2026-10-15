// CI's build job builds the production site as it will be once it goes live (--live) and holds it to its publish gate
// (scripts/lib/site-gate.ts): while anything waits for counsel's approval, the build must refuse exactly what the gate
// says, and nothing but what waits for approval may stop it; once nothing does, it must build, and ship none of the
// design's placeholder material. Exits 1 otherwise.
//
//   node scripts/ci/site-production-gate.ts

import { spawnSync } from "node:child_process";
import { runnerImport } from "vite";
import { RULES_ALIAS } from "../build/rules-alias.ts";

// Through Vite, as the site's own build loads its content, so its "@rules/…" resolves.
const { module: gate } = await runnerImport<typeof import("../lib/site-gate.ts")>("./scripts/lib/site-gate.ts", {
  configFile: false,
  resolve: { alias: RULES_ALIAS },
  logLevel: "error",
});

function fail(why: string, lines: readonly string[] = []): never {
  console.log(`::error::${why}`);
  for (const line of lines) console.log(`  ${line}`);
  process.exit(1);
}

const expected = gate.refusals();
const other = expected.filter((problem) => !gate.awaitsApproval(problem));
if (other.length > 0) fail("Something other than counsel's approval stops the production site", other);

const build = spawnSync(process.execPath, ["scripts/build/build-site.ts", "--env", "production", "--live"], {
  encoding: "utf8",
});
const output = `${build.stdout}${build.stderr}`;

if (expected.length > 0) {
  if (build.status === 0) fail("The production site built, though the gate should stop it", expected);
  const refused = gate.refusedFor(output);
  if (JSON.stringify(refused) !== JSON.stringify(expected)) {
    fail("The production site was refused for other reasons than the gate's", [
      "expected:",
      ...expected,
      "refused for:",
      ...refused,
    ]);
  }
  console.log(`The production site is refused only on what waits for approval:\n  ${expected.join("\n  ")}`);
} else {
  if (build.status !== 0) fail("The production site passes its gate but did not build", output.split("\n").slice(-30));
  const shipped = gate.shippedPlaceholders("site/dist/production");
  if (shipped.length > 0) fail("The production site shipped what it must not", shipped);
  console.log("The production site builds, and ships none of the design's placeholder material.");
}
