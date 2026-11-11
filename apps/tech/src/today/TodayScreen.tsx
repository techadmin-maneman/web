// Today (docs/prompts/tech-redesign.md, "Today"), in the new look (docs/decisions/0239-technician-light-look.md): the
// date, how many jobs are left, and whether the phone's work has reached us; what needs dealing with first; the next
// job with the way there; the rest of the day; and tomorrow. Sign out is on Me.

import { useAsync, valueOr } from "@maneman/ui/useAsync";
import { ProblemCard } from "@maneman/ui/ProblemCard";
import { shortDate } from "@maneman/web-kit/dates";
import { useCallback, useEffect, useState, type Ref } from "react";
import type { JobSummary } from "../api.ts";
import { Bell } from "../alerts/index.ts";
import { NoSignal } from "../frame/Banners.tsx";
import { Failed, Loading } from "../frame/States.tsx";
import { SyncLabel } from "../frame/SyncLabel.tsx";
import { atRisk as atRiskCopy, titles, today as copy } from "../content.ts";
import { rowState } from "../lib/progress.ts";
import { keepCards, useDay, useNames } from "../lib/useDay.ts";
import { useOutbox } from "../lib/useOutbox.ts";
import { useRefreshTick } from "../lib/useRefreshTick.ts";
import { useScreen } from "../lib/useScreen.ts";
import { clock, dayAfter, dayBefore, todayInIndia } from "../lib/when.ts";
import { kindName } from "../lib/kind.ts";
import { nextOf, titleOf } from "../lib/today.ts";
import { go } from "../route.ts";
import { useSession } from "../session.ts";
import { type Heard, keptStates, keptToFix } from "../store/jobs.ts";
import type { Queued } from "../store/outbox.ts";
import { LaterToday, Tomorrow } from "./LaterToday.tsx";
import { NextJob } from "./NextJob.tsx";
import styles from "./today.module.css";

/** Yesterday's jobs not yet closed that the phone has work for: begun, or with steps still to send. */
const stillOpen = (jobs: readonly JobSummary[], queued: readonly Queued[]): JobSummary[] =>
  jobs.filter(
    (job) =>
      job.status === "dispatched" || job.status === "in_progress" || queued.some((event) => event.job_id === job.id),
  );

const NOTHING_HEARD: ReadonlyMap<string, Heard> = new Map();

/**
 * Where each job the phone holds stood when last heard of, read again whenever the outbox changes. A store that will
 * not open has nothing newer than the list, and the rows go by it.
 */
const useHeard = (watch: unknown): ReadonlyMap<string, Heard> => valueOr(useAsync(keptStates, watch)[0], NOTHING_HEARD);

/** Each day's cards kept on the phone as they come fresh from the API, so a basement opens them; the names they hold. */
function useKeptCards(...days: readonly ReturnType<typeof useDay>[0][]): {
  readonly names: ReadonlyMap<string, string>;
  readonly round: number;
} {
  const [round, setRound] = useState(0);
  const names = useNames(round);
  const [today, tomorrow] = days;
  useEffect(() => {
    if (today?.state === "loaded" && !today.fromPhone) {
      void keepCards(today.value).then(() => {
        setRound((was) => was + 1);
      });
    }
  }, [today]);
  useEffect(() => {
    if (tomorrow?.state === "loaded" && !tomorrow.fromPhone) {
      void keepCards(tomorrow.value).then(() => {
        setRound((was) => was + 1);
      });
    }
  }, [tomorrow]);
  return { names, round };
}

/** The date, how many jobs are still to do, and whether the phone's work has reached us. */
function Head(props: { readonly date: string; readonly title: string; readonly heading: Ref<HTMLHeadingElement> }) {
  return (
    <header className={styles.head}>
      <div>
        <p className={styles.date}>{shortDate(props.date)}</p>
        <h1 className={styles.count} ref={props.heading} tabIndex={-1}>
          {props.title}
        </h1>
      </div>
      <div className={styles.headEnd}>
        <SyncLabel />
        <Bell />
      </div>
    </header>
  );
}

/**
 * The visits ops sent steps back on, from whatever day, as cards at the top until the phone sends the steps again
 * (docs/decisions/0246-closed-and-sent-back.md). The list is the one the day's list last brought.
 */
function ToFix(props: {
  readonly day: unknown;
  readonly queued: readonly Queued[];
  readonly names: ReadonlyMap<string, string>;
}) {
  const visits = valueOr(useAsync(keptToFix, props.day)[0], []);
  const resent = (id: string, step: string) =>
    props.queued.some((event) => event.job_id === id && event.kind === step && event.state === "waiting");
  return visits.flatMap((visit) => {
    const steps = visit.steps.filter((step) => !resent(visit.id, step));
    if (steps.length === 0) return [];
    const who = props.names.get(visit.id) ?? visit.client_name ?? kindName({ ...visit, one_visit: false });
    return (
      <ProblemCard
        key={visit.id}
        title={copy.toFix(clock(visit.starts_at), who)}
        onOpen={() => {
          go(`/jobs/${visit.id}`);
        }}
      >
        {copy.toFixBody(steps.map((step) => copy.toFixSteps[step]))}
      </ProblemCard>
    );
  });
}

/** Yesterday's jobs still open, as a card at the top: each can be finished and sent. */
function LeftOpen(props: {
  readonly date: string;
  readonly queued: readonly Queued[];
  readonly names: ReadonlyMap<string, string>;
}) {
  const [yesterday] = useDay(dayBefore(props.date));
  const jobs = yesterday.state === "loaded" ? stillOpen(yesterday.value, props.queued) : [];
  return jobs.map((job) => (
    <ProblemCard
      key={job.id}
      title={copy.leftOpen(clock(job.starts_at), job.client_name ?? props.names.get(job.id) ?? kindName(job))}
      onOpen={() => {
        go(`/jobs/${job.id}`);
      }}
    >
      {copy.leftOpenBody}
    </ProblemCard>
  ));
}

export function TodayScreen() {
  const { offline, atRisk } = useSession();
  const date = todayInIndia();
  const tick = useRefreshTick();
  const [day, retry] = useDay(date, tick);
  const [tomorrow] = useDay(dayAfter(date), tick);
  const waiting = useOutbox();
  const heard = useHeard(waiting);
  const heading = useScreen(titles.today);
  const { names, round } = useKeptCards(day, tomorrow);

  const jobs = day.state === "loaded" ? day.value : [];
  const tomorrowJobs = tomorrow.state === "loaded" ? tomorrow.value : [];
  const stateOf = useCallback(
    (job: JobSummary) => rowState(job, waiting.events, heard.get(job.id)),
    [waiting.events, heard],
  );
  const states = new Map(jobs.map((job) => [job.id, stateOf(job)]));
  const next = nextOf(jobs, states);
  const rest = jobs.filter((job) => job !== next);
  const after = rest.find(
    (job) => next !== undefined && job.starts_at > next.starts_at && states.get(job.id) !== "closed",
  );
  const unsentOnPhone = waiting.events.length + waiting.frames.length > 0;

  return (
    <main className={styles.screen} data-look="light">
      <Head date={date} title={titleOf(jobs, states, day.state === "loaded")} heading={heading} />
      {offline && <NoSignal />}

      <div className={styles.problems}>
        <ToFix day={day} queued={waiting.events} names={names} />
        <LeftOpen date={date} queued={waiting.events} names={names} />
        {atRisk && unsentOnPhone && <ProblemCard title={atRiskCopy.title}>{atRiskCopy.body}</ProblemCard>}
      </div>

      {day.state === "loading" && <Loading onPaper />}
      {day.state === "failed" && (
        <Failed message={copy.failed} retry={copy.retry} onRetry={retry} requestId={day.requestId} onPaper />
      )}

      {next !== undefined && (
        <NextJob
          job={next}
          state={states.get(next.id) ?? null}
          client={next.client_name ?? names.get(next.id)}
          after={after}
          cards={round}
        />
      )}
      {day.state === "loaded" && (
        <LaterToday jobs={rest} states={states} names={names} queued={waiting.events} heard={heard} />
      )}
      <Tomorrow jobs={tomorrowJobs} loaded={tomorrow.state === "loaded"} />
    </main>
  );
}
