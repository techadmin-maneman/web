// The Waiting screen's upload queue, and the plain account the prompt asks for of
// everything else that has not yet reached us.
//
// Each photograph set counts what the API has confirmed, never what is only
// held on the phone (./sets.ts). A job whose queue stopped says what stopped it
// in the app's words — the API answers a code and the fields behind it, never a
// sentence (apps/tech/src/content.ts). A step the API refused can be put right
// where it stands, a refused photograph set retaken; deleting the job's work asks
// a second time, since what it deletes never reaches us. It is drawn as the prototype draws it, a row for each photo
// set with where it stands, keeping every action it had (docs/decisions/0246-closed-and-sent-back.md, decision 9).

import { Button } from "@maneman/ui/Button";
import { ErrorRef } from "@maneman/ui/ErrorRef";
import { useState } from "react";
import { CardFrame } from "../frame/CardFrame.tsx";
import { ConfirmSheet } from "@maneman/ui/ConfirmSheet";
import { queue as copy, reference, whatStopped } from "../content.ts";
import { jobLabel } from "../lib/kind.ts";
import { useHeldJobs } from "../lib/useDay.ts";
import { useOutbox } from "../lib/useOutbox.ts";
import { apiDate, clock, stamp } from "../lib/when.ts";
import { lastSynced } from "../store/last-sync.ts";
import { go, STEP_PATHS, stepPath, type InJobStep } from "../route.ts";
import { useSession } from "../session.ts";
import { account, forget, replay, sendAgain, STUCK, type EventKind, type JobAccount } from "../store/outbox.ts";
import { Progress } from "./Progress.tsx";
import { IN_A_SET, isSetWrite, photoSets, sentOf, type PhotoSet } from "../lib/sets.ts";
import styles from "./waiting.module.css";

const PHOTO_STEPS: ReadonlySet<InJobStep> = new Set(["before_photos", "after_photos"]);

const isInJobStep = (kind: EventKind): kind is EventKind & InJobStep => kind in STEP_PATHS;

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
          <Button variant="primary" size="small" className={styles.button} onClick={() => void sendAgain(jobId)}>
            {copy.retry}
          </Button>
        )}
        {toCorrect !== null && (
          <Button
            variant="outline"
            size="small"
            className={styles.button}
            onClick={() => {
              go(stepPath(jobId, toCorrect));
            }}
          >
            {PHOTO_STEPS.has(toCorrect) ? copy.retake : copy.correct}
          </Button>
        )}
        <Button variant="outline" size="small" className={styles.button} onClick={props.onForget}>
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

/** A row's head: whose and what, and where it stands at its end, in the error's colour once stopped. */
function RowTop({ title, state, failed }: { title: string; state: string; failed: boolean }) {
  return (
    <div className={styles.rowTop}>
      <span className={styles.who}>{title}</span>
      <span className={failed ? styles.stateStopped : styles.state}>{state}</span>
    </div>
  );
}

/** A photo set's row: whose and which, how many, and how far sent, its line gone once it has stopped. */
function SetRow(props: { name: string; set: PhotoSet; state: string; failed: boolean }) {
  const { set } = props;
  const title = copy.setOf(props.name, copy.phasesAfter[set.phase]);
  return (
    <div className={styles.row}>
      <RowTop title={title} state={props.state} failed={props.failed} />
      <p className={styles.count}>
        {set.queued ? copy.photos(IN_A_SET) : copy.taken(set.held, IN_A_SET)}
        {props.failed && ` · ${copy.sentOf(sentOf(set), IN_A_SET)}`}
      </p>
      {!props.failed && <Progress done={sentOf(set)} total={IN_A_SET} label={title} />}
    </div>
  );
}

/** One job's row: whom it is for, what it holds, since when, and what stopped it, or the way to send it now. */
function WaitingJob(props: {
  id: string;
  name: string;
  line: JobAccount | undefined;
  sets: readonly PhotoSet[];
  /** The job's writes still waiting to go, beside its sets' own. */
  actions: number;
  since: number | null;
  startsAt: string | null;
  offline: boolean;
  onForget: () => void;
}) {
  const { line, offline } = props;
  const stopped = line?.stopped ?? null;
  const failed = stopped !== null;
  const state = stateOf(failed, offline);
  const { actions } = props;
  return (
    <li className={styles.job}>
      {props.sets.map((set) => (
        <SetRow key={set.phase} name={props.name} set={set} state={state} failed={failed} />
      ))}
      {/* The writes beside the sets, which the prototype does not draw, in a row of the job's own. */}
      {(actions > 0 || props.sets.length === 0) && (
        <div className={styles.row}>
          <RowTop title={props.name} state={state} failed={failed} />
          {actions > 0 && <p className={styles.count}>{copy.events(actions)}</p>}
        </div>
      )}
      {/* How long it has been on the phone, which is how much an eviction would take. */}
      {props.since !== null && <p className={styles.count}>{copy.since(clock(new Date(props.since).toISOString()))}</p>}
      {stopped !== null && (
        <Stopped jobId={props.id} stopped={stopped} startsAt={props.startsAt} onForget={props.onForget} />
      )}
      {stopped === null && !offline && (
        <Button
          variant="outline"
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

/** Nothing waiting: that everything is uploaded, and when the phone's work last reached us. */
function AllSent() {
  const last = lastSynced();
  return (
    <>
      <p className={styles.nothing}>{copy.nothing}</p>
      {last !== null && <p className={styles.lastSync}>{copy.lastSync(stamp(new Date(last).toISOString()))}</p>}
    </>
  );
}

export function WaitingScreen() {
  const { offline } = useSession();
  const waiting = useOutbox();
  const kept = useHeldJobs(waiting);
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
  // A set's own write is the set: the actions are the job's other writes.
  const actionsOf = (id: string) => waiting.events.filter((event) => event.job_id === id && !isSetWrite(event)).length;
  const actionsWaiting = (id: string) =>
    waiting.events.filter((event) => event.job_id === id && event.state === "waiting" && !isSetWrite(event)).length;

  return (
    <CardFrame
      title={copy.title}
      sub={jobs.length === 0 ? copy.noneWaiting : copy.jobsWaiting(jobs.length)}
      foot={null}
    >
      {jobs.length === 0 ? (
        <AllSent />
      ) : (
        <>
          {/* Unsent work at risk is Today's card alone, as the prototype has it. */}
          <ul className={styles.list}>
            {jobs.map((id) => (
              <WaitingJob
                key={id}
                id={id}
                name={name(id)}
                line={held.find((entry) => entry.job_id === id)}
                sets={sets.filter((set) => set.job === id)}
                actions={actionsWaiting(id)}
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
    </CardFrame>
  );
}
