// What a job is called: its kind, as the boards name it, or a consultation and fit in one visit, which no board
// draws (docs/decisions/0105-a-consultation-and-fit-in-one-visit.md). A job further out than the API shows names
// no kind.

import { shortDate } from "@maneman/web-kit/dates";
import type { JobSummary } from "../api.ts";
import { changed, job as copy, oneVisit, types, typesLower } from "../content.ts";
import type { HeldJob } from "../store/jobs.ts";
import { clock, dayAfter, todayInIndia } from "./when.ts";

type Named = Pick<JobSummary, "type" | "one_visit">;

/** "Consultation and fit", or the kind: "Service". */
export function kindName(job: Named): string {
  if (job.type === null) return copy.locked.title;
  return job.one_visit ? oneVisit.name : types[job.type];
}

/** The same in the card's line, in lower case: "consultation and fit", "service". */
export function kindNameLower(job: Named): string {
  if (job.type === null) return copy.locked.title;
  return job.one_visit ? oneVisit.nameLower : typesLower[job.type];
}

/** "4 pm" on a job today, "Tomorrow 9 am", "Thu 1 Oct 4 pm". */
function startWords(start: string, now: Date): string {
  const time = clock(start);
  const date = todayInIndia(new Date(start));
  const today = todayInIndia(now);
  if (date === today) return time;
  if (date === dayAfter(today)) return `${copy.tomorrow} ${time}`;
  return `${shortDate(date)} ${time}`;
}

/**
 * A job by what the phone always holds, whether or not its card is open: "4 pm consultation · Gurgaon". `startsAt`
 * is the start the technician knew, which a job ops moved no longer has.
 */
export function jobLabel(held: HeldJob | undefined, startsAt: string | null, now: Date = new Date()): string {
  const start = startsAt ?? held?.starts_at ?? null;
  const words: string[] = [];
  if (start !== null) words.push(startWords(start, now));
  if (held !== undefined && held.type !== null) words.push(kindNameLower(held));
  if (words.length === 0) return changed.someJob;

  const sector = held?.sector ?? null;
  return sector === null ? words.join(" ") : `${words.join(" ")} · ${sector}`;
}
