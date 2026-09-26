// Board A1: the day's jobs in order, tomorrow collapsed below. Board A2's
// offline banner sits above them when the phone has no signal, and its empty
// state stands in when nothing is booked.
//
// Sign out wipes the phone, so with work on it that has not reached us it asks
// first, and offers to send it. With no signal the session stays open and
// nothing is wiped, and it says so (apps/tech/src/App.tsx).

import { Button } from "@maneman/ui/Button";
import { Mark } from "@maneman/ui/Mark";
import { Link } from "@maneman/ui/router";
import { useEffect, useState } from "react";
import type { JobSummary } from "../api.ts";
import { Offline } from "../components/Banners.tsx";
import { Icon } from "../components/Icon.tsx";
import {
  atRisk as atRiskCopy,
  job as jobCopy,
  leaving as leavingCopy,
  queue as queueCopy,
  titles,
  today as copy,
} from "../content.ts";
import { ICONS_P2 } from "@maneman/brand/icons";
import { CHEVRON_DOWN } from "../icons.ts";
import { keepCards, useDay, useNames } from "../lib/useDay.ts";
import { useOutbox } from "../lib/useOutbox.ts";
import { useScreen } from "../lib/useScreen.ts";
import { clock, dayAfter, todayInIndia, where } from "../lib/when.ts";
import { useSession } from "../session.ts";
import { Failed, Loading } from "../states/States.tsx";
import { keptClosedJobs } from "../store/jobs.ts";
import { replay, type Queued } from "../store/outbox.ts";
import { photoSets } from "../waiting/sets.ts";
import { JobRow } from "./JobRow.tsx";
import styles from "./today.module.css";

/** Where a sign-out has got to: asking about unsent work, waiting on the API, or refused for want of signal. */
type Leaving = "asking" | "going" | "stayed" | null;

/**
 * Where a row's job stands: closed out on this phone or in FSM, or begun. The
 * phone's own word comes first, since FSM hears of a close-out only once it
 * has gone up.
 */
function stateOf(job: JobSummary, queued: readonly Queued[], closedHere: ReadonlySet<string>): string | null {
  if (closedHere.has(job.id) || job.status === "completed" || job.status === "terminated") {
    return jobCopy.states.closed;
  }
  const startedHere = queued.some((event) => event.job_id === job.id && event.kind === "start");
  return startedHere || job.status === "in_progress" ? jobCopy.states.inProgress : null;
}

/** The jobs closed out on this phone, read again whenever the outbox changes. */
function useClosedHere(watch: unknown): ReadonlySet<string> {
  const [closed, setClosed] = useState<ReadonlySet<string>>(new Set());
  useEffect(() => {
    let current = true;
    void keptClosedJobs().then(
      (found) => {
        if (current) setClosed(found);
      },
      () => {
        // A store that will not open says nothing of what closed; the rows go without.
      },
    );
    return () => {
      current = false;
    };
  }, [watch]);
  return closed;
}

export function TodayScreen() {
  const { me, offline, atRisk, signOut } = useSession();
  const date = todayInIndia();
  const [day, retry] = useDay(date);
  const [tomorrow] = useDay(dayAfter(date));
  const [tomorrowOpen, setTomorrowOpen] = useState(false);
  const waiting = useOutbox();
  const [leaving, setLeaving] = useState<Leaving>(null);

  const unsentSets = photoSets(waiting.frames, waiting.events).length;
  const unsentActions = waiting.events.length;
  // What is still on its way: a job whose queue stopped says so in the banner above every screen.
  const sending = waiting.events.filter((event) => event.state === "waiting").length;
  const closedHere = useClosedHere(waiting);
  const heading = useScreen(titles.today);

  async function leave(): Promise<void> {
    setLeaving("going");
    if ((await signOut()) === "still-signed-in") setLeaving("stayed");
  }

  const jobs = day.state === "loaded" ? day.value : [];
  const first = jobs[0];
  const tomorrowJobs = tomorrow.state === "loaded" ? tomorrow.value : [];
  const [cards, setCards] = useState(0);
  const names = useNames(cards);

  // Fresh from the API: keep each card too, so a basement opens them (board A2),
  // and so the rows can name the client the day's list does not carry.
  useEffect(() => {
    if (day.state === "loaded" && !day.fromPhone) {
      void keepCards(day.value).then(() => {
        setCards((round) => round + 1);
      });
    }
  }, [day]);
  useEffect(() => {
    if (tomorrow.state === "loaded" && !tomorrow.fromPhone) {
      void keepCards(tomorrow.value).then(() => {
        setCards((round) => round + 1);
      });
    }
  }, [tomorrow]);

  return (
    <main className={styles.screen}>
      <header className={styles.head}>
        <div className={styles.top}>
          <Mark className={styles.mark} />
          <Button
            variant="outlineOnInk"
            size="small"
            className={styles.account}
            disabled={leaving === "going"}
            onClick={() => {
              if (unsentSets + unsentActions > 0) setLeaving("asking");
              else void leave();
            }}
          >
            <span className={styles.initials}>{me.initials}</span>
            <span className={styles.signOut}>{copy.signOut}</span>
          </Button>
        </div>
        {day.state === "loaded" && jobs.length > 0 && (
          <>
            <h1 className={styles.count} ref={heading} tabIndex={-1}>
              {copy.jobs(jobs.length)}
            </h1>
            {first !== undefined && (
              <p className={styles.first}>{copy.first(clock(first.starts_at), where(first.sector))}</p>
            )}
          </>
        )}
      </header>

      {leaving === "asking" && unsentSets + unsentActions > 0 && (
        <div className={styles.leave} role="alert">
          <p className={styles.leaveTitle}>{leavingCopy.unsent(unsentSets, unsentActions)}</p>
          <p className={styles.leaveBody}>{leavingCopy.body}</p>
          <div className={styles.leaveActions}>
            <Button
              variant="outlineOnInk"
              size="small"
              onClick={() => {
                setLeaving(null);
                void replay();
              }}
            >
              {leavingCopy.send}
            </Button>
            <Button variant="outlineOnInk" size="small" onClick={() => void leave()}>
              {leavingCopy.anyway}
            </Button>
          </div>
        </div>
      )}
      {leaving === "stayed" && (
        <p className={styles.stayed} role="status">
          {leavingCopy.stayed}
        </p>
      )}

      {offline && <Offline />}

      {(sending > 0 || unsentSets > 0) && (
        <Link className={styles.waiting} to="/waiting">
          <Icon d={ICONS_P2.uploadQueue} size={20} className={styles.waitingIcon} />
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
      {day.state === "failed" && <Failed message={copy.failed} retry={copy.retry} onRetry={retry} />}

      {day.state === "loaded" && jobs.length === 0 && (
        <div className={styles.empty}>
          <p className={styles.emptyLabel}>{copy.empty.label}</p>
          <p className={styles.emptyTitle}>{copy.empty.title}</p>
          <p className={styles.emptyBody}>
            {tomorrowJobs.length === 0 || tomorrowJobs[0] === undefined
              ? copy.empty.none
              : copy.empty.tomorrow(tomorrowJobs.length, clock(tomorrowJobs[0].starts_at))}
          </p>
        </div>
      )}

      {jobs.length > 0 && (
        <ul className={styles.list}>
          {jobs.map((job) => (
            <li key={job.id}>
              <JobRow job={job} client={names.get(job.id)} state={stateOf(job, waiting.events, closedHere)} />
            </li>
          ))}
        </ul>
      )}

      {tomorrowJobs.length > 0 && (
        <>
          <button
            className={styles.tomorrow}
            type="button"
            aria-expanded={tomorrowOpen}
            onClick={() => {
              setTomorrowOpen((open) => !open);
            }}
          >
            <span>{copy.tomorrow(tomorrowJobs.length)}</span>
            <Icon className={styles.tomorrowIcon} d={CHEVRON_DOWN} size={19} />
          </button>
          {tomorrowOpen && (
            <ul className={styles.list}>
              {tomorrowJobs.map((job) => (
                <li key={job.id}>
                  <JobRow job={job} client={names.get(job.id)} state={stateOf(job, waiting.events, closedHere)} />
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </main>
  );
}
