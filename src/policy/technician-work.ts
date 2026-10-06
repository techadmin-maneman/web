// The Technicians page's two figures: how far back each technician's jobs and average service are counted, and how
// far over the length its visits were planned for an average reads as running over. Ops set both in the console
// (docs/decisions/0088-every-policy-in-the-console.md).
// The counting itself is src/domain/dispatch/technician-work.ts's.

/** How many days back the counts reach, from tomorrow, so a job finished today is in. */
export const WORK_PERIOD_DAYS = 90;

/** How many minutes over its planned length an average must run to be flagged. */
export const OVER_BY_MIN = 15;

export const TECHNICIAN_WORK_KEYS = ["period", "over_by"] as const;
/** The two figures as ops set them: days back, and minutes over. */
export type TechnicianWorkFigures = Readonly<Record<(typeof TECHNICIAN_WORK_KEYS)[number], number>>;

export const TECHNICIAN_WORK: TechnicianWorkFigures = { period: WORK_PERIOD_DAYS, over_by: OVER_BY_MIN };

/** Whether a technician's average service runs over the length the same visits were planned for. */
export const runsOver = (minutes: { average: number; planned: number }, overBy: number = OVER_BY_MIN): boolean =>
  minutes.average - minutes.planned >= overBy;
