// Schedule (docs/prompts/tech-redesign.md, "Schedule"): today and the six days after it as a strip, each with how many
// jobs; the day chosen down the hours, from 8 am to 8 pm or wider where a job lies outside them, each job a block as
// long as it lasts with the drive before it hatched, and the minute it is now on today. A job today, or one whose card
// has opened, opens its card; a later one still locked, its preview. With no signal, today's and tomorrow's lists come
// from the phone, and a day neither has says so.

import { DateStrip, type StripDate } from "@maneman/ui/DateStrip";
import { type DayBlock, DayColumn } from "@maneman/ui/DayColumn";
import { ErrorRef } from "@maneman/ui/ErrorRef";
import { Icon } from "@maneman/ui/Icon";
import { GLYPHS } from "@maneman/brand/icons";
import { TextButton, TextLink } from "@maneman/ui/TextLink";
import { useLoad } from "@maneman/ui/useLoad";
import { addDays, dayClock, indiaTimeOf, minutesBetween, weekdayName } from "@maneman/web-kit/dates";
import { useCallback, useId, useRef } from "react";
import { api, type JobSummary } from "../api.ts";
import { NoSignal } from "../frame/Banners.tsx";
import { Failed, Loading } from "../frame/States.tsx";
import { SyncLabel } from "../frame/SyncLabel.tsx";
import { job as jobCopy, reference, schedule as copy } from "../content.ts";
import { sayNow } from "../lang/index.ts";
import { kindName } from "../lib/kind.ts";
import { rowState } from "../lib/progress.ts";
import { closedAs } from "../lib/today.ts";
import { useNames } from "../lib/useDay.ts";
import { useOutbox } from "../lib/useOutbox.ts";
import { useRefreshTick } from "../lib/useRefreshTick.ts";
import { useScreen } from "../lib/useScreen.ts";
import { wayTo } from "../lib/navigate.ts";
import { apiDate, clock, dayAfter, dayMonth, spanEnds, todayInIndia } from "../lib/when.ts";
import { redirect } from "../route.ts";
import { useSession } from "../session.ts";
import { keptDay } from "../store/jobs.ts";
import type { Queued } from "../store/outbox.ts";
import styles from "./schedule.module.css";

/** The days the strip shows, today's included. */
const SCHEDULE_DAYS = 7;
/** The hours drawn at the least, which a job outside them widens. */
const FIRST_HOUR = 8 * 60;
const LAST_HOUR = 20 * 60;

interface Day {
  readonly date: string;
  /** Null for a day that would not load and that the phone does not keep. */
  readonly jobs: readonly JobSummary[] | null;
  /** The failed call's reference, for a day that would not load; null when the API never answered. */
  readonly requestId: string | null;
}

/**
 * Each day of the strip with its jobs. A day that will not load is read from the phone where it keeps that day, as it
 * keeps today's and tomorrow's (../lib/useDay.ts), this screen's own last read of it first, which is the newer while it
 * is open; the week fails only where no day can be shown. `known` keeps each day as last read, so a read again with no
 * signal leaves what showed.
 */
async function readWeek(today: string, known: Map<string, readonly JobSummary[]>) {
  const dates = Array.from({ length: SCHEDULE_DAYS }, (_, at) => addDays(today, at));
  const answers = await Promise.all(dates.map((date) => api.jobs(date)));
  const days = await Promise.all(
    dates.map(async (date, at): Promise<Day> => {
      const answer = answers[at];
      if (answer?.ok === true) {
        known.set(date, answer.body.jobs);
        return { date, jobs: answer.body.jobs, requestId: null };
      }
      const requestId = answer === undefined ? null : answer.requestId;
      const kept = await keptDay(date).catch(() => null);
      return { date, jobs: known.get(date) ?? kept, requestId };
    }),
  );
  const failed = answers.find((answer) => !answer.ok);
  if (failed !== undefined && days.every((day) => day.jobs === null)) return failed;
  return { ok: true as const, body: days };
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

/** A block's line beneath its title: how a job closed, or its visit and area; a locked one's area and length. */
function metaOf(job: JobSummary, opens: boolean, closed: boolean, queued: readonly Queued[]): string {
  if (closed) return closedAs(job, queued, undefined);
  return opens ? joined(kindName(job), job.sector) : joined(job.sector, jobCopy.minutes(lengthOf(job)));
}

/** The drive before a job, with the way there in Google Maps where the job's address is on the phone. */
function DriveLine({ job, words }: { readonly job: JobSummary; readonly words: string }) {
  const line = (
    <>
      <Icon className={styles.driveIcon} d={GLYPHS.navigate} size="sm" />
      {words}
    </>
  );
  if (job.address === null) return <span className={styles.drive}>{line}</span>;
  // A new tab, so a technician who has taken the route back still has the app open behind it.
  return (
    <TextLink className={styles.drive} href={wayTo(job.address)} newTab>
      {line}
    </TextLink>
  );
}

/** A day's heading: today's and tomorrow's said as such, "Today, Thu 12 Nov"; any other, "Sat, 14 Nov". */
function dayTitle(date: string, today: string): string {
  const weekday = weekdayName(date).slice(0, 3);
  if (date === today) return copy.today(weekday, dayMonth(date));
  if (date === dayAfter(today)) return copy.tomorrow(weekday, dayMonth(date));
  return copy.day(weekday, dayMonth(date));
}

/** A day's jobs as blocks: one whose card has opened by the client's name, a locked one by the visit, as previews. */
function blocksOf(day: Day, today: boolean, names: ReadonlyMap<string, string>, queued: readonly Queued[]) {
  return (day.jobs ?? []).flatMap((job): DayBlock[] => {
    const start = minuteOf(job.starts_at);
    const opens = today || job.unlocked;
    const closed = today && rowState(job, queued, undefined) === "closed";
    const visit: DayBlock = {
      key: job.id,
      start,
      minutes: lengthOf(job),
      look: closed ? "done" : "visit",
      title: opens ? (names.get(job.id) ?? job.client_name ?? kindName(job)) : kindName(job),
      meta: metaOf(job, opens, closed, queued),
      to: opens ? `/jobs/${job.id}` : `/week/${day.date}/${job.id}`,
    };
    if (closed || job.drive_minutes === null || job.leave_by === null) return [visit];
    const drive: DayBlock = {
      key: `${job.id}/drive`,
      start: start - job.drive_minutes,
      minutes: job.drive_minutes,
      look: "drive",
      title: <DriveLine job={job} words={copy.drive(job.drive_minutes, clock(job.leave_by))} />,
    };
    return [drive, visit];
  });
}

/** The hours to draw: 8 am to 8 pm, widened to the whole hours around any block outside them, within the day. */
function hoursOf(blocks: readonly DayBlock[]): { readonly from: number; readonly to: number } {
  const first = Math.min(FIRST_HOUR, ...blocks.map((block) => block.start));
  const last = Math.max(LAST_HOUR, ...blocks.map((block) => block.start + block.minutes));
  return { from: Math.max(0, Math.floor(first / 60) * 60), to: Math.min(24 * 60, Math.ceil(last / 60) * 60) };
}

const hourWords = (minute: number) =>
  dayClock(`${String(Math.floor(minute / 60) % 24).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`);

/** A day's count beneath its date: how many jobs, a dash for none, and nothing for a day that would not load. */
function noteOf(day: Day): string | undefined {
  if (day.jobs === null) return undefined;
  return day.jobs.length === 0 ? copy.noJobs : String(day.jobs.length);
}

const stripDay = (day: Day): StripDate => ({
  date: day.date,
  weekday: sayNow(weekdayName(day.date).slice(0, 3)),
  number: String(Number(day.date.slice(8, 10))),
  label: copy.dayLabel(weekdayName(day.date), dayMonth(day.date), day.jobs?.length ?? null),
  open: true,
  note: noteOf(day),
});

/** A day that would not load: with no signal, that it shows once there is some; with signal, Try again. */
function DayFailed({ day, onRetry }: { readonly day: Day; readonly onRetry: () => void }) {
  const { offline } = useSession();
  if (offline) return <p className={styles.daySub}>{copy.dayFailed}</p>;
  return (
    <div className={styles.daySub} role="alert">
      <p className={styles.dayFailed}>{copy.dayNotLoaded}</p>
      <TextButton onClick={onRetry}>{copy.retry}</TextButton>
      {day.requestId !== null && <ErrorRef requestId={day.requestId} words={reference} />}
    </div>
  );
}

function DayView(props: {
  readonly day: Day;
  readonly today: string;
  readonly stripId: string;
  readonly onRetry: () => void;
}) {
  const { day, today, stripId } = props;
  const { events } = useOutbox();
  const names = useNames(0);
  const blocks = blocksOf(day, day.date === today, names, events);
  const hours = hoursOf(blocks);
  const jobs = day.jobs;
  return (
    <section className={styles.day} aria-labelledby={`${stripId}-day`}>
      <h2 className={styles.dayTitle} id={`${stripId}-day`}>
        {dayTitle(day.date, today)}
      </h2>
      {jobs === null ? (
        <DayFailed day={day} onRetry={props.onRetry} />
      ) : (
        <>
          <p className={styles.daySub}>{jobs.length === 0 ? copy.nothing : copy.jobs(jobs.length)}</p>
          <DayColumn
            label={copy.dayView}
            from={hours.from}
            to={hours.to}
            hour={hourWords}
            blocks={blocks}
            now={day.date === today ? minuteOf(apiDate().toISOString()) : null}
            nowLabel={copy.now}
          />
        </>
      )}
    </section>
  );
}

export function ScheduleScreen({ date }: { readonly date: string | null }) {
  const today = todayInIndia();
  const { offline } = useSession();
  const heading = useScreen(copy.title);
  const stripId = useId();
  // Read again as Today is: the app back in front, the phone finding signal, and every few minutes.
  const tick = useRefreshTick();
  const known = useRef(new Map<string, readonly JobSummary[]>());
  // eslint-disable-next-line react-hooks/exhaustive-deps -- the tick is what asks for the read again
  const read = useCallback(() => readWeek(today, known.current), [today, tick]);
  const [loaded, retry] = useLoad(read);
  const days = loaded.state === "loaded" ? loaded.value : [];
  const shown = days.find((day) => day.date === date) ?? days[0];
  const jobs = days.reduce((count, day) => count + (day.jobs?.length ?? 0), 0);
  return (
    <main className={styles.screen} data-look="light">
      <header className={styles.head}>
        <div>
          <h1 className={styles.title} id={stripId} ref={heading} tabIndex={-1}>
            {copy.title}
          </h1>
          {days.length > 0 && (
            <p className={styles.range}>{copy.range(...spanEnds(today, addDays(today, SCHEDULE_DAYS - 1)), jobs)}</p>
          )}
        </div>
        <SyncLabel />
      </header>
      {offline && <NoSignal />}
      {loaded.state === "loading" && <Loading onPaper />}
      {loaded.state === "failed" && (
        <Failed message={copy.failed} retry={copy.retry} onRetry={retry} requestId={loaded.requestId} onPaper />
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
          <DayView day={shown} today={today} stripId={stripId} onRetry={retry} />
        </>
      )}
    </main>
  );
}
