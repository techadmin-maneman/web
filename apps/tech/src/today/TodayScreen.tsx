// The day's jobs in order, tomorrow collapsed below. The
// offline banner sits above them when the phone has no signal, and its empty
// state stands in when nothing is booked.
//
// Sign out wipes the phone, so it always asks first: with work on it that has
// not reached us, it offers to send it. With no signal the session stays open
// and nothing is wiped, and it says so (apps/tech/src/App.tsx).

import { Tile } from "@maneman/ui/Tile";
import { capsLook } from "@maneman/ui/Caps";
import { ICONS, APP_ICONS } from "@maneman/brand/icons";
import { Button } from "@maneman/ui/Button";
import { Icon } from "@maneman/ui/Icon";
import { Mark } from "@maneman/ui/Mark";
import { Link } from "@maneman/ui/router";
import { useAsync, valueOr } from "@maneman/ui/useAsync";
import { useEffect, useState, type Ref } from "react";
import type { JobState, JobSummary } from "../api.ts";
import { Offline } from "../components/Banners.tsx";
import {
  atRisk as atRiskCopy,
  job as jobCopy,
  kit as kitCopy,
  leaving as leavingCopy,
  queue as queueCopy,
  titles,
  today as copy,
} from "../content.ts";
import { STROKE, TAG } from "../icons.ts";
import { rowState, type RowState } from "../lib/progress.ts";
import { keepCards, useDay, useNames } from "../lib/useDay.ts";
import { useOutbox } from "../lib/useOutbox.ts";
import { useScreen } from "../lib/useScreen.ts";
import { clock, dayAfter, dayBefore, todayInIndia, where } from "../lib/when.ts";
import { useSession } from "../session.ts";
import { Failed, Loading } from "../states/States.tsx";
import { keptStates } from "../store/jobs.ts";
import { replay, type Queued } from "../store/outbox.ts";
import { photoSets } from "../lib/sets.ts";
import { JobRow } from "./JobRow.tsx";
import styles from "./today.module.css";

/** Where a sign-out has got to: asking about unsent work, waiting on the API, or refused for want of signal. */
type Leaving = "asking" | "going" | "stayed" | null;

const ROW_STATES: Readonly<Record<RowState, string>> = {
  closed: jobCopy.states.closed,
  in_progress: jobCopy.states.inProgress,
};

function stateOf(job: JobSummary, queued: readonly Queued[], heard: ReadonlyMap<string, JobState>): string | null {
  const state = rowState(job, queued, heard.get(job.id));
  return state === null ? null : ROW_STATES[state];
}

/** Yesterday's jobs not yet closed that the phone has work for: begun, or with steps still to send. */
const stillOpen = (jobs: readonly JobSummary[], queued: readonly Queued[]): JobSummary[] =>
  jobs.filter(
    (job) =>
      job.status === "dispatched" || job.status === "in_progress" || queued.some((event) => event.job_id === job.id),
  );

/** The client's name from the day's list, else from the card the phone kept, for a day kept before the list had names. */
const clientOf = (job: JobSummary, kept: ReadonlyMap<string, string>): string | undefined =>
  job.client_name ?? kept.get(job.id);

const NOTHING_HEARD: ReadonlyMap<string, JobState> = new Map();

/**
 * Where each job the phone holds stood when last heard of, read again whenever the outbox changes. A store that will
 * not open has nothing newer than the list, and the rows go by it.
 */
const useHeard = (watch: unknown): ReadonlyMap<string, JobState> =>
  valueOr(useAsync(keptStates, watch)[0], NOTHING_HEARD);

/** Each day's cards kept on the phone as they come fresh from the API, so a basement opens them; the names they hold. */
function useKeptCards(...days: readonly ReturnType<typeof useDay>[0][]): ReadonlyMap<string, string> {
  const [cards, setCards] = useState(0);
  const names = useNames(cards);
  const [today, tomorrow] = days;
  useEffect(() => {
    if (today?.state === "loaded" && !today.fromPhone) {
      void keepCards(today.value).then(() => {
        setCards((round) => round + 1);
      });
    }
  }, [today]);
  useEffect(() => {
    if (tomorrow?.state === "loaded" && !tomorrow.fromPhone) {
      void keepCards(tomorrow.value).then(() => {
        setCards((round) => round + 1);
      });
    }
  }, [tomorrow]);
  return names;
}

/** The mark and the way to sign out; then, with jobs today, how many and where the first is. */
function Head(props: {
  readonly initials: string;
  readonly leaving: boolean;
  readonly onSignOut: () => void;
  readonly jobs: readonly JobSummary[];
  readonly heading: Ref<HTMLHeadingElement>;
}) {
  const [first] = props.jobs;
  return (
    <header className={styles.head}>
      <div className={styles.top}>
        <Mark className={styles.mark} />
        <Button
          variant="outlineOnInk"
          size="small"
          className={styles.account}
          disabled={props.leaving}
          onClick={props.onSignOut}
        >
          <span className={styles.initials}>{props.initials}</span>
          <span className={styles.signOut}>{copy.signOut}</span>
        </Button>
      </div>
      {first !== undefined && (
        <>
          <h1 className={styles.count} ref={props.heading} tabIndex={-1}>
            {copy.jobs(props.jobs.length)}
          </h1>
          <p className={styles.first}>{copy.first(clock(first.starts_at), where(first.sector))}</p>
        </>
      )}
    </header>
  );
}

/** The question before a sign-out wipes the phone: with unsent work it offers to send it first. */
function LeavePrompt(props: {
  readonly unsentSets: number;
  readonly unsentActions: number;
  readonly onStay: () => void;
  readonly onSend: () => void;
  readonly onLeave: () => void;
}) {
  const unsent = props.unsentSets + props.unsentActions > 0;
  return (
    <div className={styles.leave} role="alert">
      <p className={styles.leaveTitle}>
        {unsent ? leavingCopy.unsent(props.unsentSets, props.unsentActions) : leavingCopy.confirm}
      </p>
      <p className={styles.leaveBody}>{unsent ? leavingCopy.body : leavingCopy.confirmBody}</p>
      <div className={styles.leaveActions}>
        <Button variant="outlineOnInk" size="small" onClick={unsent ? props.onSend : props.onStay}>
          {unsent ? leavingCopy.send : leavingCopy.stay}
        </Button>
        <Button variant="outlineOnInk" size="small" onClick={props.onLeave}>
          {unsent ? leavingCopy.anyway : copy.signOut}
        </Button>
      </div>
    </div>
  );
}

/** Nothing booked today: when tomorrow starts, where it has jobs. */
function EmptyDay({ tomorrowJobs }: { readonly tomorrowJobs: readonly JobSummary[] }) {
  const [next] = tomorrowJobs;
  return (
    <div className={styles.empty}>
      <p className={capsLook(styles.emptyLabel)}>{copy.empty.label}</p>
      <p className={styles.emptyTitle}>{copy.empty.title}</p>
      <p className={styles.emptyBody}>
        {next === undefined ? copy.empty.none : copy.empty.tomorrow(tomorrowJobs.length, clock(next.starts_at))}
      </p>
    </div>
  );
}

/** The day's jobs, each with how far it has got. */
function Jobs(props: {
  readonly jobs: readonly JobSummary[];
  readonly names: ReadonlyMap<string, string>;
  readonly queued: readonly Queued[];
  readonly heard: ReadonlyMap<string, JobState>;
}) {
  return (
    <ul className={styles.list}>
      {props.jobs.map((job) => (
        <li key={job.id}>
          <JobRow job={job} client={clientOf(job, props.names)} state={stateOf(job, props.queued, props.heard)} />
        </li>
      ))}
    </ul>
  );
}

/** Tomorrow's jobs, collapsed below today's until opened. */
function Tomorrow(props: Omit<Parameters<typeof Jobs>[0], "jobs"> & { readonly jobs: readonly JobSummary[] }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Tile
        className={styles.tomorrow}
        aria-expanded={open}
        onClick={() => {
          setOpen((was) => !was);
        }}
      >
        <span>{copy.tomorrow(props.jobs.length)}</span>
        <Icon className={styles.tomorrowIcon} d={ICONS.selectArrow} size={19} stroke={STROKE} />
      </Tile>
      {open && <Jobs {...props} />}
    </>
  );
}

export function TodayScreen() {
  const { me, offline, atRisk, signOut } = useSession();
  const date = todayInIndia();
  const [day, retry] = useDay(date);
  const [tomorrow] = useDay(dayAfter(date));
  const [yesterday] = useDay(dayBefore(date));
  const waiting = useOutbox();
  const [leaving, setLeaving] = useState<Leaving>(null);

  const unsentSets = photoSets(waiting.frames, waiting.events).length;
  const unsentActions = waiting.events.length;
  // What is still on its way: a job whose queue stopped says so in the banner above every screen.
  const sending = waiting.events.filter((event) => event.state === "waiting").length;
  const heard = useHeard(waiting);
  const heading = useScreen(titles.today);

  async function leave(): Promise<void> {
    setLeaving("going");
    if ((await signOut()) === "still-signed-in") setLeaving("stayed");
  }

  const jobs = day.state === "loaded" ? day.value : [];
  const tomorrowJobs = tomorrow.state === "loaded" ? tomorrow.value : [];
  const leftOpen = yesterday.state === "loaded" ? stillOpen(yesterday.value, waiting.events) : [];
  const names = useKeptCards(day, tomorrow);

  return (
    <main className={styles.screen}>
      <Head
        initials={me.initials}
        leaving={leaving === "going"}
        onSignOut={() => {
          setLeaving("asking");
        }}
        jobs={day.state === "loaded" ? jobs : []}
        heading={heading}
      />

      {leaving === "asking" && (
        <LeavePrompt
          unsentSets={unsentSets}
          unsentActions={unsentActions}
          onStay={() => {
            setLeaving(null);
          }}
          onSend={() => {
            setLeaving(null);
            void replay();
          }}
          onLeave={() => void leave()}
        />
      )}
      {leaving === "stayed" && (
        <p className={styles.stayed} role="status">
          {leavingCopy.stayed}
        </p>
      )}

      {offline && <Offline />}

      {(sending > 0 || unsentSets > 0) && (
        <Link className={styles.waiting} to="/waiting">
          <Icon d={APP_ICONS.uploadQueue} size={20} className={styles.waitingIcon} stroke={STROKE} />
          <span className={styles.waitingLine}>
            {unsentSets > 0 ? queueCopy.waiting(unsentSets) : queueCopy.events(sending)}
          </span>
        </Link>
      )}

      {/*
        The phone would not promise to keep its store, and there is work in it.
        Only worth saying when both are true: the warning is about this queue,
        not about the phone (apps/tech/src/store/persist.ts).
      */}
      {atRisk && (waiting.events.length > 0 || waiting.frames.length > 0) && (
        <div className={styles.atRisk} role="status">
          <p className={styles.atRiskTitle}>{atRiskCopy.title}</p>
          <p className={styles.atRiskBody}>{atRiskCopy.body}</p>
        </div>
      )}

      {day.state === "loading" && <Loading />}
      {day.state === "failed" && (
        <Failed message={copy.failed} retry={copy.retry} onRetry={retry} requestId={day.requestId} />
      )}

      {leftOpen.length > 0 && (
        <section aria-labelledby="today-left-open">
          <h2 className={capsLook(styles.leftOpen)} id="today-left-open">
            {copy.leftOpen(leftOpen.length)}
          </h2>
          <Jobs jobs={leftOpen} names={names} queued={waiting.events} heard={heard} />
        </section>
      )}
      {day.state === "loaded" && jobs.length === 0 && <EmptyDay tomorrowJobs={tomorrowJobs} />}
      {jobs.length > 0 && <Jobs jobs={jobs} names={names} queued={waiting.events} heard={heard} />}
      {tomorrowJobs.length > 0 && <Tomorrow jobs={tomorrowJobs} names={names} queued={waiting.events} heard={heard} />}

      <Link className={styles.waiting} to="/kit">
        <Icon d={TAG} size={20} className={styles.waitingIcon} stroke={STROKE} />
        <span className={styles.waitingLine}>{kitCopy.link}</span>
      </Link>
    </main>
  );
}
