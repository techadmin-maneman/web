// Board A1: the day's jobs in order, tomorrow collapsed below. Board A2's
// offline banner sits above them when the phone has no signal, and its empty
// state stands in when nothing is booked.

import { useEffect, useState } from "react";
import { Icon } from "../components/Icon.tsx";
import { Mark } from "../components/Mark.tsx";
import { atRisk as atRiskCopy, queue as queueCopy, today as copy } from "../content.ts";
import { ICONS_P2 } from "@maneman/brand/icons";
import { CHEVRON_DOWN } from "../icons.ts";
import { keepCards, useDay, useNames } from "../lib/useDay.ts";
import { useOutbox } from "../lib/useOutbox.ts";
import { clock, dayAfter, todayInIndia, where } from "../lib/when.ts";
import { go } from "../route.ts";
import { useSession } from "../session.ts";
import { Failed, Loading } from "../states/States.tsx";
import { JobRow } from "./JobRow.tsx";
import styles from "./today.module.css";

export function TodayScreen() {
  const { me, offline, atRisk, signOut } = useSession();
  const date = todayInIndia();
  const [day, retry] = useDay(date);
  const [tomorrow] = useDay(dayAfter(date));
  const [tomorrowOpen, setTomorrowOpen] = useState(false);
  const waiting = useOutbox();

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
          <button className={styles.account} type="button" onClick={signOut}>
            <span className={styles.initials}>{me.initials}</span>
            <span className={styles.signOut}>{copy.signOut}</span>
          </button>
        </div>
        {day.state === "loaded" && jobs.length > 0 && (
          <>
            <h1 className={styles.count}>{copy.jobs(jobs.length)}</h1>
            {first !== undefined && (
              <p className={styles.first}>{copy.first(clock(first.starts_at), where(first.sector))}</p>
            )}
          </>
        )}
      </header>

      {offline && (
        <div className={styles.offline} role="status">
          <p className={styles.offlineTitle}>
            <Icon d={ICONS_P2.offline} size={20} />
            {copy.offline.title}
          </p>
          <p className={styles.offlineBody}>{copy.offline.body}</p>
        </div>
      )}

      {(waiting.events.length > 0 || waiting.frames.length > 0) && (
        <a
          className={styles.waiting}
          href="/waiting"
          onClick={(event) => {
            event.preventDefault();
            go("/waiting");
          }}
        >
          <Icon d={ICONS_P2.uploadQueue} size={20} className={styles.waitingIcon} />
          <span className={styles.waitingLine}>
            {waiting.frames.length > 0
              ? queueCopy.waiting(new Set(waiting.frames.map((frame) => frame.job_id)).size)
              : queueCopy.events(waiting.events.length)}
          </span>
        </a>
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
              <JobRow job={job} client={names.get(job.id)} />
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
                  <JobRow job={job} client={names.get(job.id)} />
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </main>
  );
}
