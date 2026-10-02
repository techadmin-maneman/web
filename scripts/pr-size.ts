// Warns when a pull request changes more lines by hand than one review reads well (scripts/lib/pr-size.ts). It
// never fails the run.
//
//   git diff --numstat origin/main...HEAD | node scripts/pr-size.ts

import { readFileSync } from "node:fs";
import { handWrittenLines, LINE_BUDGET } from "./lib/pr-size.ts";

const lines = handWrittenLines(readFileSync(0, "utf8"));
if (lines > LINE_BUDGET) {
  console.log(
    `::warning::${String(lines)} lines changed by hand, over the budget of ${String(LINE_BUDGET)}: split the pull request if it can be split.`,
  );
} else {
  console.log(`${String(lines)} lines changed by hand, within the budget of ${String(LINE_BUDGET)}.`);
}
