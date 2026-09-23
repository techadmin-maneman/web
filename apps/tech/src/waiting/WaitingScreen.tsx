// Board A2's upload queue, and the plain account the prompt asks for of
// everything else that has not yet reached us.
//
// A job whose queue met a `409 superseded` says what changed — the API answers
// a code and the fields that moved, never a sentence, so the words are the
// app's (apps/tech/src/content.ts). "Got it" clears that job, so the rest of the
// queue can go on.

import { Icon } from "../components/Icon.tsx";
import { queue as copy, stopped as stoppedCopy } from "../content.ts";
import { ICONS_P2 } from "@maneman/brand/icons";
import { BACK } from "../icons.ts";
import { useNames } from "../lib/useDay.ts";
import { useOutbox } from "../lib/useOutbox.ts";
import { go } from "../route.ts";
import { useSession } from "../session.ts";
import { account, forget, replay, type JobAccount } from "../store/outbox.ts";
import { Progress } from "./Progress.tsx";
import styles from "./waiting.module.css";

/** The five angles of a before or after set (board B1), before and after: ten in all. */
const IN_A_VISIT = 10;

/** What stopped this job, in the app's words: the fields that moved if the API named any, else the code. */
function why(stopped: NonNullable<JobAccount["stopped"]>): string {
  const named = stopped.fields.map((field) => stoppedCopy[field]).filter((line) => line !== undefined);
  return named[0] ?? stoppedCopy[stopped.note ?? ""] ?? stoppedCopy.unknown ?? "";
}

export function WaitingScreen() {
  const { offline } = useSession();
  const waiting = useOutbox();
  const names = useNames(waiting);

  const held = account(waiting.events);
  const sets = new Map<string, number>();
  for (const frame of waiting.frames) sets.set(frame.job_id, (sets.get(frame.job_id) ?? 0) + 1);

  const jobs = [...new Set([...sets.keys(), ...held.map((line) => line.job_id)])];
  const name = (id: string) => names.get(id) ?? id.slice(0, 8);

  return (
    <main className={styles.screen}>
      <header className={styles.head}>
        <button
          className={styles.back}
          type="button"
          aria-label={copy.back}
          onClick={() => {
            go("/");
          }}
        >
          <Icon d={BACK} size={24} />
        </button>
        <h1 className={styles.title}>{copy.title}</h1>
      </header>

      {jobs.length === 0 ? (
        <p className={styles.nothing}>{copy.nothing}</p>
      ) : (
        <>
          <div className={styles.sets}>
            <Icon className={styles.setsIcon} d={ICONS_P2.uploadQueue} size={20} />
            <span className={styles.setsLine}>{copy.waiting(sets.size)}</span>
          </div>
          <ul className={styles.list}>
            {jobs.map((id) => {
              const frames = sets.get(id) ?? 0;
              const line = held.find((entry) => entry.job_id === id);
              const stopped = line?.stopped ?? null;
              return (
                <li className={styles.job} key={id}>
                  <div className={styles.jobTop}>
                    <span className={styles.who}>{name(id)}</span>
                    <span className={stopped === null ? styles.state : styles.stateStopped}>
                      {stopped === null ? (offline ? copy.states.waiting : copy.states.uploading) : copy.states.failed}
                    </span>
                  </div>
                  {frames > 0 && (
                    <>
                      <Progress done={frames} total={IN_A_VISIT} />
                      <p className={styles.count}>{copy.count(frames, IN_A_VISIT)}</p>
                    </>
                  )}
                  {line !== undefined && line.waiting > 0 && (
                    <p className={styles.count}>{copy.events(line.waiting)}</p>
                  )}
                  {stopped !== null && (
                    <div className={styles.stopped} role="alert">
                      <p className={styles.stoppedLine}>{why(stopped)}</p>
                      <button
                        className={styles.button}
                        type="button"
                        onClick={() => {
                          void forget(id);
                        }}
                      >
                        {copy.read}
                      </button>
                    </div>
                  )}
                  {stopped === null && (
                    <button
                      className={styles.button}
                      type="button"
                      onClick={() => {
                        void replay();
                      }}
                    >
                      {copy.retry}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        </>
      )}

      <p className={styles.never}>{copy.never}</p>
    </main>
  );
}
