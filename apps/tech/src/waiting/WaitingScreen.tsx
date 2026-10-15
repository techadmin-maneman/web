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
import { ConfirmSheet } from "@maneman/ui/ConfirmSheet";
import { atRisk as atRiskCopy, queue as copy, reference, whatStopped } from "../content.ts";
import { jobLabel } from "../lib/kind.ts";
import { useHeldJobs } from "../lib/useDay.ts";
import { useOutbox } from "../lib/useOutbox.ts";
import { useScreen } from "../lib/useScreen.ts";
import { apiDate, clock } from "../lib/when.ts";
import { go, STEP_PATHS, stepPath, type InJobStep } from "../route.ts";
import { useSession } from "../session.ts";
import { account, forget, replay, sendAgain, STUCK, type EventKind, type JobAccount } from "../store/outbox.ts";
import { Progress } from "./Progress.tsx";
import { IN_A_SET, photoSets, sentOf, type PhotoSet } from "../lib/sets.ts";
import frame from "../components/frame.module.css";
import styles from "./waiting.module.css";

const PHOTO_STEPS: ReadonlySet<InJobStep> = new Set(["before_photos", "after_photos"]);

const isInJobStep = (kind: EventKind): kind is InJobStep => kind in STEP_PATHS;

/** A refused step the technician can open again and put right on its own screen; null for any other stop. */
function correctable(stopped: JobAccount["stopped"]): InJobStep | null {
  if (stopped?.state !== "refused" || stopped.note === STUCK) return null;
  return isInJobStep(stopped.kind) ? stopped.kind : null;
}

/** What stopped a job, the Ref to quote, and what can be done: send it again, put it right, or let it go. */
function Stopped(props: {
  readonly jobId: string;
  readonly stopped: NonNullable<JobAccount["stopped"]>;
  readonly startsAt: string | null;
  readonly onForget: () => void;
}) {
  const { jobId, stopped } = props;
  const toCorrect = correctable(stopped);
  return (
    <div className={styles.stopped} role="alert">
      <p className={styles.stoppedLine}>{whatStopped(stopped, apiDate(), props.startsAt)}</p>
      {stopped.requestId !== null && (
        <ErrorRef requestId={stopped.requestId} words={reference} className={styles.reference} />
      )}
      <div className={styles.buttons}>
        {stopped.note === STUCK && (
          <Button variant="outlineOnInk" size="small" className={styles.button} onClick={() => void sendAgain(jobId)}>
            {copy.retry}
          </Button>
        )}
        {toCorrect !== null && (
          <Button
            variant="outlineOnInk"
            size="small"
            className={styles.button}
            onClick={() => {
              go(stepPath(jobId, toCorrect));
            }}
          >
            {PHOTO_STEPS.has(toCorrect) ? copy.retake : copy.correct}
          </Button>
        )}
        <Button variant="outlineOnInk" size="small" className={styles.button} onClick={props.onForget}>
          {copy.forget.open}
        </Button>
      </div>
    </div>
  );
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

/** One job's row: whom it is for, what it holds, since when, and what stopped it, or the way to send it now. */
function WaitingJob(props: {
  id: string;
  name: string;
  line: JobAccount | undefined;
  sets: readonly PhotoSet[];
  since: number | null;
  startsAt: string | null;
  offline: boolean;
  onForget: () => void;
}) {
  const { line, offline } = props;
  const stopped = line?.stopped ?? null;
  return (
    <li className={styles.job}>
      <div className={styles.jobTop}>
        <span className={styles.who}>{props.name}</span>
        <span className={stopped === null ? styles.state : styles.stateStopped}>
          {stateOf(stopped !== null, offline)}
        </span>
      </div>
      {props.sets.map((set) => (
        <SetLine set={set} key={set.phase} />
      ))}
      {line !== undefined && line.waiting > 0 && <p className={styles.count}>{copy.events(line.waiting)}</p>}
      {/* How long it has been on the phone, which is how much an eviction would take. */}
      {props.since !== null && <p className={styles.count}>{copy.since(clock(new Date(props.since).toISOString()))}</p>}
      {stopped !== null && (
        <Stopped jobId={props.id} stopped={stopped} startsAt={props.startsAt} onForget={props.onForget} />
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
          size="lg"
          weight="heavy"
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
            <Icon className={styles.setsIcon} d={APP_ICONS.uploadQueue} size="md" weight="heavy" />
            <span className={styles.setsLine}>{copy.waiting(sets.length)}</span>
          </div>
          <ul className={styles.list}>
            {jobs.map((id) => (
              <WaitingJob
                key={id}
                id={id}
                name={name(id)}
                line={held.find((entry) => entry.job_id === id)}
                sets={sets.filter((set) => set.job === id)}
                since={since(id)}
                startsAt={kept.get(id)?.starts_at ?? null}
                offline={offline}
                onForget={() => {
                  setForgetting(id);
                }}
              />
            ))}
          </ul>
        </>
      )}

      <p className={styles.never}>{copy.never}</p>

      {forgetting !== null && (
        <ConfirmSheet
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
