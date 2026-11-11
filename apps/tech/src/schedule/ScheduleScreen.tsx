// Schedule (docs/prompts/tech-redesign.md, "Schedule"): today and the six days after it as a strip, each with how many
// jobs; the day chosen down the hours from 8 am to 8 pm, each job a block as long as it lasts with the drive before it
// hatched, and the minute it is now on today. A job today opens its card; a later one, its preview.

import { DateStrip, type StripDate } from "@maneman/ui/DateStrip";
import { type DayBlock, DayColumn } from "@maneman/ui/DayColumn";
import { useLoad } from "@maneman/ui/useLoad";
import { addDays, dayClock, indiaTimeOf, minutesBetween, weekdayName } from "@maneman/web-kit/dates";
import { useCallback, useId } from "react";
import { api, type JobSummary } from "../api.ts";
import { Failed, Loading } from "../frame/States.tsx";
import { SyncLabel } from "../frame/SyncLabel.tsx";
import { job as jobCopy, schedule as copy } from "../content.ts";
import { kindName } from "../lib/kind.ts";
import { rowState } from "../lib/progress.ts";
import { closedAs } from "../lib/today.ts";
import { useNames } from "../lib/useDay.ts";
import { useOutbox } from "../lib/useOutbox.ts";
import { useScreen } from "../lib/useScreen.ts";
import { apiDate, clock, dayMonth, todayInIndia } from "../lib/when.ts";
import { redirect } from "../route.ts";
import type { Queued } from "../store/outbox.ts";
import styles from "./schedule.module.css";

/** The day the strip shows, today's included. */
const SCHEDULE_DAYS = 7;
const FIRST_HOUR = 8 * 60;
const LAST_HOUR = 20 * 60;

interface Day {
  readonly date: string;
  readonly jobs: readonly JobSummary[];
}

/** Each day of the strip with its jobs; a day that would not load fails the week, which is tried again whole. */
async function readWeek(today: string) {
  const dates = Array.from({ length: SCHEDULE_DAYS }, (_, at) => addDays(today, at));
  const answers = await Promise.all(dates.map((date) => api.jobs(date)));
  const failed = answers.find((answer) => !answer.ok);
  if (failed !== undefined) return failed;
  return {
    ok: true as const,
    body: dates.map((date, at): Day => {
      const answer = answers[at];
      return { date, jobs: answer?.ok === true ? answer.body.jobs : [] };
    }),
  };
}

/** Minutes after midnight on India's clock. */
const minuteOf = (instant: string): number => {
  const [hours = 0, minutes = 0] = indiaTimeOf(instant).split(":").map(Number);
  return hours * 60 + minutes;
};

/** A slot's length, for a job whose own the list does not give. */
const SLOT_MINUTES = 30;

/** How long a job is booked for. */
export const lengthOf = (job: JobSummary): number =>
  job.minutes ?? (job.ends_at === null ? SLOT_MINUTES : minutesBetween(job.starts_at, job.ends_at));

const joined = (...parts: readonly (string | null)[]) =>
  parts.filter((part) => part !== null && part !== "").join(" · ");

/** A block's line beneath its title: how a job today closed, or its visit and area; a later one's area and length. */
function metaOf(job: JobSummary, today: boolean, closed: boolean, queued: readonly Queued[]): string {
  if (closed) return closedAs(job, queued, undefined);
  return today ? joined(kindName(job), job.sector) : joined(job.sector, jobCopy.minutes(lengthOf(job)));
}

/** A day's jobs as blocks: today's by the client's name, done with or not; a later day's by the visit, as previews. */
function blocksOf(day: Day, today: boolean, names: ReadonlyMap<string, string>, queued: readonly Queued[]): DayBlock[] {
  return day.jobs.flatMap((job): DayBlock[] => {
    const start = minuteOf(job.starts_at);
    const length = lengthOf(job);
    const closed = today && rowState(job, queued, undefined) === "closed";
    const visit: DayBlock = {
      key: job.id,
      start,
      minutes: length,
      look: closed ? "done" : "visit",
      title: today ? (names.get(job.id) ?? kindName(job)) : kindName(job),
      meta: metaOf(job, today, closed, queued),
      to: today ? `/jobs/${job.id}` : `/week/${day.date}/${job.id}`,
    };
    if (closed || job.drive_minutes === null || job.leave_by === null) return [visit];
    const drive: DayBlock = {
      key: `${job.id}/drive`,
      start: start - job.drive_minutes,
      minutes: job.drive_minutes,
      look: "drive",
      title: copy.drive(job.drive_minutes, clock(job.leave_by)),
    };
    return [drive, visit];
  });
}

const stripDay = (day: Day): StripDate => ({
  date: day.date,
  weekday: weekdayName(day.date).slice(0, 3),
  number: String(Number(day.date.slice(8, 10))),
  label: copy.dayLabel(weekdayName(day.date), dayMonth(day.date), day.jobs.length),
  open: true,
  note: day.jobs.length === 0 ? copy.noJobs : String(day.jobs.length),
});

export function ScheduleScreen({ date }: { readonly date: string | null }) {
  const today = todayInIndia();
  const heading = useScreen(copy.title);
  const stripId = useId();
  const read = useCallback(() => readWeek(today), [today]);
  const [loaded, retry] = useLoad(read);
  const { events } = useOutbox();
  const names = useNames(0);
  const days = loaded.state === "loaded" ? loaded.value : [];
  const shown = days.find((day) => day.date === date) ?? days[0];
  const jobs = days.reduce((count, day) => count + day.jobs.length, 0);
  return (
    <main className={styles.screen} data-look="light">
      <header className={styles.head}>
        <div>
          <h1 className={styles.title} id={stripId} ref={heading} tabIndex={-1}>
            {copy.title}
          </h1>
          {days.length > 0 && (
            <p className={styles.range}>
              {copy.range(dayMonth(today), dayMonth(addDays(today, SCHEDULE_DAYS - 1)), jobs)}
            </p>
          )}
        </div>
        <SyncLabel />
      </header>
      {loaded.state === "loading" && <Loading />}
      {loaded.state === "failed" && (
        <Failed message={copy.failed} retry={copy.retry} onRetry={retry} requestId={loaded.requestId} />
      )}
      {shown !== undefined && (
        <>
          <DateStrip
            className={styles.strip}
            name="schedule-day"
            labelledBy={stripId}
            days={days.map(stripDay)}
            chosen={shown.date}
            onChoose={(chosen) => {
              redirect(chosen === today ? "/week" : `/week/${chosen}`);
            }}
          />
          <section className={styles.day} aria-labelledby={`${stripId}-day`}>
            <h2 className={styles.dayTitle} id={`${stripId}-day`}>
              {copy.day(weekdayName(shown.date).slice(0, 3), dayMonth(shown.date))}
            </h2>
            <p className={styles.daySub}>{shown.jobs.length === 0 ? copy.nothing : copy.jobs(shown.jobs.length)}</p>
            <DayColumn
              label={copy.dayView}
              from={FIRST_HOUR}
              to={LAST_HOUR}
              hour={(minute) =>
                dayClock(`${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`)
              }
              blocks={blocksOf(shown, shown.date === today, names, events)}
              now={shown.date === today ? minuteOf(apiDate().toISOString()) : null}
              nowLabel={copy.now}
            />
          </section>
        </>
      )}
    </main>
  );
}
