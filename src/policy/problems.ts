// What a client may tell Care from the app (src/domain/care/app-reports.ts; docs/decisions/0259-the-issue-log.md): the
// issue's category, and the limits on what they send.

/** The prototype's categories, in its order. */
export const PROBLEM_CATEGORIES = [
  "fit_guarantee",
  "edges_lifting",
  "itching",
  "colour",
  "shedding",
  "fit_comfort",
  "visit",
  "payment",
  "other",
] as const;
export type ProblemCategory = (typeof PROBLEM_CATEGORIES)[number];

/** What the app sent before the categories, which an app not yet reloaded still sends. */
export type ProblemAbout = "hair_system" | "visit";

/** A category, or an older app's word for one. */
export const categoryOf = (given: ProblemCategory | ProblemAbout): ProblemCategory =>
  given === "hair_system" ? "fit_comfort" : given;

/** The most a client writes in one. */
export const PROBLEM_MAX_CHARS = 1000;

/** How many a client may send in a day. */
export const PROBLEMS_PER_DAY = 5;

/** How many updates, reopenings and photographs a client may add to their reports in a day. */
export const PROBLEM_ADDS_PER_DAY = 20;

/** How many photographs a report takes. */
export const PROBLEM_PHOTOS_MAX = 3;

/** How a report is shown: "MM-ISS-0032". */
export const reportReference = (n: number): string => `MM-ISS-${String(n).padStart(4, "0")}`;

/** A reference back to its number; null for anything else. */
export function reportNumberOf(reference: string): number | null {
  const match = /^MM-ISS-(\d{4,})$/.exec(reference);
  return match === null ? null : Number(match[1]);
}
