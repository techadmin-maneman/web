// What a client may tell Care from the app: that something is wrong with their hair system or a visit
// (src/domain/care/app-reports.ts).

export const PROBLEM_ABOUT = ["hair_system", "visit"] as const;
export type ProblemAbout = (typeof PROBLEM_ABOUT)[number];

/** The most a client writes in one. */
export const PROBLEM_MAX_CHARS = 1000;

/** How many a client may send in a day. */
export const PROBLEMS_PER_DAY = 5;
