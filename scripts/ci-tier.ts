// Prints full=true or full=false for this CI run (scripts/lib/ci-tier.ts), from the event GitHub describes in the
// environment the workflow gives it.
//
//   EVENT=pull_request ACTION=synchronize DRAFT=false LABEL= LABELS='["full-ci"]' node scripts/ci-tier.ts >> "$GITHUB_OUTPUT"

import { ciTier } from "./lib/ci-tier.ts";

const labels = JSON.parse(
  process.env.LABELS === undefined || process.env.LABELS === "" ? "[]" : process.env.LABELS,
) as unknown;
const tier = ciTier({
  event: process.env.EVENT ?? "",
  action: process.env.ACTION ?? "",
  draft: process.env.DRAFT === "true",
  label: process.env.LABEL ?? "",
  labels: Array.isArray(labels) ? labels.filter((label): label is string => typeof label === "string") : [],
});
console.error(`CI tier: ${tier}`);
console.log(`full=${String(tier === "full")}`);
