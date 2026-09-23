// Board A2's upload queue, and the plain account the prompt asks for of
// everything else that has not yet reached us.
//
// A job whose queue met a `409 superseded` says what changed, in the API's own
// words, and never a generic error. "Got it" clears that job, so the rest of
// the queue can go on.

import { useEffect, useState } from "react";
import { Icon } from "../components/Icon.tsx";
import { queue as copy } from "../content.ts";
import { ICONS_P2 } from "@maneman/brand/icons";
import { BACK } from "../icons.ts";
import { useOutbox } from "../lib/useOutbox.ts";
import { go } from "../route.ts";
import { useSession } from "../session.ts";
import { account, forget, replay } from "../store/outbox.ts";
import { keptNames } from "../store/jobs.ts";
import { Progress } from "./Progress.tsx";
import styles from "./waiting.module.css";

/** The five angles of a before or after set (the technician prompt's B1). */
const ANGLES_IN_A_SET = 5;

export function WaitingScreen() {
  const { offline } = useSession();
  const waiting = useOutbox();
  const [names, setNames] = useState<ReadonlyMap<string, string>>(new Map());

  useEffect(() => {
    void keptNames().then(setNames);
  }, [waiting]);

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
                      <Progress done={frames} total={ANGLES_IN_A_SET * 2} />
                      <p className={styles.count}>{copy.count(frames, ANGLES_IN_A_SET * 2)}</p>
                    </>
                  )}
                  {line !== undefined && line.waiting > 0 && (
                    <p className={styles.count}>{copy.events(line.waiting)}</p>
                  )}
                  {stopped !== null && (
                    <div className={styles.stopped} role="alert">
                      <p className={styles.stoppedLine}>
                        {stopped.note ?? (stopped.state === "superseded" ? copy.superseded : copy.refused)}
                      </p>
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
