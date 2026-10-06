// The Waiting screen's upload queue, and the plain account the prompt asks for of
// everything else that has not yet reached us.
//
// Each photograph set counts what the API has confirmed, never what is only
// held on the phone (./sets.ts). A job whose queue stopped says what stopped it
// in the app's words — the API answers a code and the fields behind it, never a
// sentence (apps/tech/src/content.ts). A step the API refused can be put right
// where it stands, a refused photograph set retaken; deleting the job's work asks
// a second time, since what it deletes never reaches us.

import { IconButton } from "@maneman/ui/IconButton";
import { ICONS, APP_ICONS } from "@maneman/brand/icons";
import { Button } from "@maneman/ui/Button";
import { ErrorRef } from "@maneman/ui/ErrorRef";
import { Icon } from "@maneman/ui/Icon";
import { useState } from "react";
import { Offline } from "../components/Banners.tsx";
import { Confirm } from "../components/Confirm.tsx";
import { atRisk as atRiskCopy, queue as copy, reference, whatStopped } from "../content.ts";
import { STROKE } from "../icons.ts";
import { jobLabel } from "../lib/kind.ts";
import { useHeldJobs } from "../lib/useDay.ts";
import { useOutbox } from "../lib/useOutbox.ts";
import { useScreen } from "../lib/useScreen.ts";
import { clock } from "../lib/when.ts";
import { go, STEP_PATHS, stepPath, type InJobStep } from "../route.ts";
import { useSession } from "../session.ts";
import { account, forget, replay, type EventKind, type JobAccount } from "../store/outbox.ts";
import { Progress } from "./Progress.tsx";
import { IN_A_SET, photoSets, sentOf, type PhotoSet } from "../lib/sets.ts";
import frame from "../components/frame.module.css";
import styles from "./waiting.module.css";

const PHOTO_STEPS: ReadonlySet<InJobStep> = new Set(["before_photos", "after_photos"]);

const isInJobStep = (kind: EventKind): kind is InJobStep => kind in STEP_PATHS;

/** A refused step the technician can open again and put right on its own screen; null for any other stop. */
function correctable(stopped: JobAccount["stopped"]): InJobStep | null {
  if (stopped?.state !== "refused") return null;
  return isInJobStep(stopped.kind) ? stopped.kind : null;
}

/** Where a job's work stands: stopped, waiting for signal, or on its way. */
function stateOf(stopped: boolean, offline: boolean): string {
  if (stopped) return copy.states.failed;
  return offline ? copy.states.waiting : copy.states.uploading;
}

function SetLine({ set }: { set: PhotoSet }) {
  const phase = copy.phases[set.phase];
  const line = set.queued ? copy.sent(phase, sentOf(set), IN_A_SET) : copy.taking(phase, set.held, IN_A_SET);
  return (
    <>
      <Progress done={sentOf(set)} total={IN_A_SET} />
      <p className={styles.count}>{line}</p>
    </>
  );
}

export function WaitingScreen() {
  const { offline, atRisk } = useSession();
  const waiting = useOutbox();
  const kept = useHeldJobs(waiting);
  const heading = useScreen(copy.title);
  const [forgetting, setForgetting] = useState<string | null>(null);

  const held = account(waiting.events);
  const sets = photoSets(waiting.frames, waiting.events);
  const jobs = [...new Set([...sets.map((set) => set.job), ...held.map((line) => line.job_id)])];

  /** The client while the phone holds the card; else the job's time, kind and area as the technician knew them. */
  const name = (id: string) => {
    const job = kept.get(id);
    const startsAt = waiting.events.find((event) => event.job_id === id)?.starts_at ?? null;
    return job?.client ?? jobLabel(job, startsAt);
  };

  /** When this job's oldest unsent thing was taken: a half-captured set has frames and no event yet. */
  const since = (id: string): number | null => {
    const times = [
      ...waiting.events.filter((event) => event.job_id === id).map((event) => event.queued_at),
      ...waiting.frames.filter((frame) => frame.job_id === id).map((frame) => frame.kept_at),
    ];
    return times.length === 0 ? null : Math.min(...times);
  };

  const photosOf = (id: string) => waiting.frames.filter((frame) => frame.job_id === id).length;
  const actionsOf = (id: string) => waiting.events.filter((event) => event.job_id === id).length;

  return (
    <main className={styles.screen}>
      <header className={frame.head}>
        <IconButton
          className={styles.back}
          d={ICONS.back}
          size={24}
          stroke={STROKE}
          label={copy.back}
          onClick={() => {
            go("/");
          }}
        />
        <h1 className={styles.title} ref={heading} tabIndex={-1}>
          {copy.title}
        </h1>
      </header>

      {offline && <Offline />}

      {jobs.length === 0 ? (
        <p className={styles.nothing}>{copy.nothing}</p>
      ) : (
        <>
          {atRisk && (
            <div className={styles.atRisk} role="status">
              <p className={styles.atRiskTitle}>{atRiskCopy.title}</p>
              <p className={styles.atRiskBody}>{atRiskCopy.body}</p>
            </div>
          )}
          <div className={styles.sets}>
            <Icon className={styles.setsIcon} d={APP_ICONS.uploadQueue} size={20} stroke={STROKE} />
            <span className={styles.setsLine}>{copy.waiting(sets.length)}</span>
          </div>
          <ul className={styles.list}>
            {jobs.map((id) => {
              const line = held.find((entry) => entry.job_id === id);
              const stopped = line?.stopped ?? null;
              const taken = since(id);
              const toCorrect = correctable(stopped);
              return (
                <li className={styles.job} key={id}>
                  <div className={styles.jobTop}>
                    <span className={styles.who}>{name(id)}</span>
                    <span className={stopped === null ? styles.state : styles.stateStopped}>
                      {stateOf(stopped !== null, offline)}
                    </span>
                  </div>
                  {sets
                    .filter((set) => set.job === id)
                    .map((set) => (
                      <SetLine set={set} key={set.phase} />
                    ))}
                  {line !== undefined && line.waiting > 0 && (
                    <p className={styles.count}>{copy.events(line.waiting)}</p>
                  )}
                  {/* How long it has been on the phone, which is how much an eviction would take. */}
                  {taken !== null && <p className={styles.count}>{copy.since(clock(new Date(taken).toISOString()))}</p>}
                  {stopped !== null && (
                    <div className={styles.stopped} role="alert">
                      <p className={styles.stoppedLine}>
                        {whatStopped(stopped, new Date(), kept.get(id)?.starts_at ?? null)}
                      </p>
                      {stopped.requestId !== null && (
                        <ErrorRef requestId={stopped.requestId} words={reference} className={styles.reference} />
                      )}
                      <div className={styles.buttons}>
                        {toCorrect !== null && (
                          <Button
                            variant="outlineOnInk"
                            size="small"
                            className={styles.button}
                            onClick={() => {
                              go(stepPath(id, toCorrect));
                            }}
                          >
                            {PHOTO_STEPS.has(toCorrect) ? copy.retake : copy.correct}
                          </Button>
                        )}
                        <Button
                          variant="outlineOnInk"
                          size="small"
                          className={styles.button}
                          onClick={() => {
                            setForgetting(id);
                          }}
                        >
                          {copy.forget.open}
                        </Button>
                      </div>
                    </div>
                  )}
                  {stopped === null && !offline && (
                    <Button
                      variant="outlineOnInk"
                      size="small"
                      className={styles.button}
                      onClick={() => {
                        void replay();
                      }}
                    >
                      {copy.retry}
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        </>
      )}

      <p className={styles.never}>{copy.never}</p>

      {forgetting !== null && (
        <Confirm
          title={copy.forget.title}
          body={`${copy.forget.what(photosOf(forgetting), actionsOf(forgetting))} ${copy.forget.body}`}
          yes={copy.forget.delete}
          no={copy.forget.keep}
          onYes={() => {
            void forget(forgetting);
            setForgetting(null);
          }}
          onNo={() => {
            setForgetting(null);
          }}
        />
      )}
    </main>
  );
}
