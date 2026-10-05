// Checks docs/open-points.md and docs/open-points-settled.md, and every citation of a point (scripts/lib/open-points.ts).
//
//   node scripts/ci/check-open-points.ts    prints the problems, or the next free number

import { readFileSync } from "node:fs";
import {
  citingFiles,
  nextFreeNumber,
  openPointProblems,
  readOpenPoints,
  referenceProblems,
} from "../lib/open-points.ts";

// The settled points are kept in a file of their own, after the open ones (docs/open-points-settled.md): read as one, a
// number is never used twice across the two.
const markdown = ["docs/open-points.md", "docs/open-points-settled.md"]
  .map((file) => readFileSync(file, "utf8"))
  .join("\n");
const points = readOpenPoints(markdown);
const files = citingFiles().map((path) => ({ path, text: readFileSync(path, "utf8") }));
const problems = [
  ...openPointProblems(markdown),
  ...referenceProblems(files, new Set(points.map((point) => point.number))),
];

if (problems.length > 0) {
  console.error(`open points check failed (${String(problems.length)} problem(s)):`);
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}
const open = points.filter((point) => !point.settled).length;
console.log(
  `open points check passed: ${String(open)} open, ${String(points.length - open)} settled; ` +
    `a new point takes ${String(nextFreeNumber(points))}`,
);
