// What the read-only checks of the live account report (scripts/release/check-triggers.ts,
// scripts/release/check-buckets.ts), and how they print it: a line each, and under GitHub
// Actions a warning for a difference and a notice for what could not be read.

export type Outcome = "matches" | "differs" | "not read" | "not deployed";

export interface Finding {
  /** What was looked at, e.g. "mm-api-staging queue consumers". */
  readonly subject: string;
  readonly outcome: Outcome;
  readonly detail: string;
}

const LABEL: Readonly<Record<Outcome, string>> = {
  matches: "OK     ",
  differs: "DIFFERS",
  "not read": "NOT READ",
  "not deployed": "SKIP   ",
};

/** GitHub Actions' annotation for each outcome; none for what needs no one's attention. */
const ANNOTATION: Readonly<Record<Outcome, string | null>> = {
  matches: null,
  differs: "warning",
  "not read": "notice",
  "not deployed": null,
};

export function printFindings(findings: readonly Finding[]): void {
  const inActions = process.env.GITHUB_ACTIONS === "true";
  for (const { subject, outcome, detail } of findings) {
    const annotation = ANNOTATION[outcome];
    const prefix = inActions && annotation !== null ? `::${annotation}::` : `${LABEL[outcome]}  `;
    console.log(`${prefix}${subject}: ${detail}`);
  }
}
