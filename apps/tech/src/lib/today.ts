// What Today works out from the day's list (../today/TodayScreen.tsx): the job it puts first, its title, and the line
// above the next job, where the technician is with it or when to leave for it, by the time to leave the list gives
// (src/policy/next-job.ts) and the API's clock.

import type { JobSummary } from "../api.ts";
import { today as copy } from "../content.ts";
import { clock } from "./when.ts";

const MINUTE_MS = 60_000;

/** How far ahead "leave in" counts in minutes; further off, the line says when. */
const LEAVE_IN_WITHIN = 90;

/** Where the job's row stands (./progress.ts's RowState), written out so Node's tests need none of the browser's. */
type Where = "closed" | "in_progress" | "at_the_door" | null;

type Row = Pick<JobSummary, "id">;

/** The job Today puts first: one under way or at its door, else the first still to do. */
export function nextOf<Job extends Row>(jobs: readonly Job[], states: ReadonlyMap<string, Where>): Job | undefined {
  const begun = jobs.find((job) => {
    const state = states.get(job.id);
    return state === "in_progress" || state === "at_the_door";
  });
  return begun ?? jobs.find((job) => states.get(job.id) !== "closed");
}

/** What Today's title says: how many jobs are still to do, that they are all done, or that none are booked. */
export function titleOf(jobs: readonly Row[], states: ReadonlyMap<string, Where>, loaded: boolean): string {
  if (loaded && jobs.length === 0) return copy.noJobs;
  const open = jobs.filter((job) => states.get(job.id) !== "closed").length;
  return loaded && open === 0 ? copy.allDone : copy.jobs(open);
}

export function nextLine(job: Pick<JobSummary, "leave_by">, state: Where, now: Date): string {
  if (state === "at_the_door") return copy.next.atTheDoor;
  if (state === "in_progress") return copy.next.inProgress;
  if (job.leave_by === null) return copy.next.next;
  const minutes = Math.ceil((Date.parse(job.leave_by) - now.getTime()) / MINUTE_MS);
  if (minutes <= 0) return copy.next.leaveNow;
  return minutes <= LEAVE_IN_WITHIN ? copy.next.leaveIn(minutes) : copy.next.leaveBy(clock(job.leave_by));
}
