// Schedule's weeks before this one (./ScheduleScreen.tsx, docs/decisions/0298-past-weeks-on-schedule.md): seven days
// at a time back from today, each job by its kind, how it closed and how long it was, and nothing of its client. A
// past job opens nothing, its card having relocked the day after its visit.

import type { DayBlock } from "@maneman/ui/DayColumn";
import { addDays, indiaTimeOf } from "@maneman/web-kit/dates";
import { api, type PastJob } from "../api.ts";
import { job as jobCopy, schedule as copy } from "../content.ts";
import { kindName } from "../lib/kind.ts";
import { closedAs } from "../lib/today.ts";

const DAY_MS = 24 * 60 * 60 * 1000;

/** The first day of the week `date` falls in, counting back from today by sevens; today for today or later. */
export function weekStartOf(date: string | null, today: string): string {
  if (date === null || date >= today) return today;
  const back = Math.ceil((Date.parse(today) - Date.parse(date)) / DAY_MS / 7);
  return addDays(today, -7 * back);
}

/** A past week's days from `from`, each with its jobs. */
export async function readPast(from: string) {
  const answer = await api.pastWeek(from);
  if (!answer.ok) return answer;
  return { ok: true as const, body: answer.body.days };
}

/** Minutes after midnight on India's clock. */
const minuteOf = (instant: string): number => {
  const [hours = 0, minutes = 0] = indiaTimeOf(instant).split(":").map(Number);
  return hours * 60 + minutes;
};

/** Still open on the visit's own record, as a job nobody closed is. */
const OPEN = new Set<PastJob["status"]>(["scheduled", "dispatched", "in_progress"]);

/** How a past job closed, in a word; "Not closed" for one left open. */
function pastState(job: PastJob): string {
  if (job.progress.outcome === null && OPEN.has(job.status)) return copy.notClosed;
  return closedAs(job, [], undefined);
}

/** A past day's jobs as blocks, each by its kind, how it closed and its length, opening nothing. */
export function pastBlocksOf(jobs: readonly PastJob[]): DayBlock[] {
  return jobs.map((job) => {
    const open = job.progress.outcome === null && OPEN.has(job.status);
    return {
      key: job.id,
      start: minuteOf(job.starts_at),
      minutes: job.minutes,
      look: open ? "visit" : "done",
      title: kindName(job),
      meta: `${pastState(job)} · ${jobCopy.minutes(job.minutes)}`,
    };
  });
}
