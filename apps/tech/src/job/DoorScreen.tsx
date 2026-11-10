// At the door (docs/prompts/tech-redesign.md, "At the door"; docs/decisions/0243-job-and-the-door.md): once checked in,
// the no-show's wait on the API's clock with its brass bar, and what a no-show needs: the WhatsApp delivered, a call
// made, a photograph of the door. Close as no-show waits for all of them and asks first, since it can bring the client
// a charge. Start visit is the screen's one action.

import { Button, ButtonLink } from "@maneman/ui/Button";
import { ConfirmSheet } from "@maneman/ui/ConfirmSheet";
import { Field, TextArea } from "@maneman/ui/Field";
import { ProgressLine } from "@maneman/ui/Progress";
import { SectionHead } from "@maneman/ui/SectionHead";
import { StepMark } from "@maneman/ui/StepMark";
import { useAsync, valueOr } from "@maneman/ui/useAsync";
import { useOneAtATime } from "@maneman/ui/useOneAtATime";
import { apiNow } from "@maneman/web-kit/clock";
import { firstNameOf } from "@rules/lib/names.ts";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import type { Job } from "../api.ts";
import { DoorCamera } from "../camera/index.ts";
import { notHome as copy, job as jobCopy } from "../content.ts";
import { JobFailed } from "../frame/JobFailed.tsx";
import { Loading } from "../frame/States.tsx";
import { callLink } from "../lib/navigate.ts";
import { buzz } from "../lib/haptics.ts";
import { outcomeOf, stageOf, theWait } from "../lib/progress.ts";
import { signatureOf, useOutbox } from "../lib/useOutbox.ts";
import { useJob } from "../lib/useDay.ts";
import { clock, countdown, todayInIndia } from "../lib/when.ts";
import { go, redirect, stepPath } from "../route.ts";
import { keepCalled, keepClosed, keptArrival, keptCalled } from "../store/jobs.ts";
import { events, frames, keepDoorFrame, queue, refusedAsEarly, replay, type Queued } from "../store/outbox.ts";
import { CardFrame, nameOf } from "../frame/CardFrame.tsx";
import { useCheckIn } from "./CheckIn.tsx";
import { whatsAppState } from "./receipt.ts";
import styles from "./door.module.css";

/** The clock, once a second while the wait runs: whole seconds, nothing else moving. */
function useNow(running: boolean): number {
  const [now, setNow] = useState(apiNow);
  useEffect(() => {
    if (!running) return;
    const tick = setInterval(() => {
      setNow(apiNow());
    }, 1000);
    return () => {
      clearInterval(tick);
    };
  }, [running]);
  return now;
}

const timeOf = (ms: number): string => clock(new Date(ms).toISOString());

/** The wait: how much of it has run, whether it is over, and whether it has begun or waits for signal. */
interface Wait {
  readonly total: number;
  readonly elapsed: number;
  readonly over: boolean;
  readonly begun: boolean;
  readonly confirmed: boolean;
}

/** The door's marks: the wait, the call made from here, the door's photograph, and a way to read them again. */
function useDoor(job: Job, queued: readonly Queued[]) {
  const [marks, setMarks] = useState(0);
  const readArrival = useCallback(() => keptArrival(job.id), [job.id]);
  const arrival = valueOr(useAsync(readArrival, queued)[0], null);
  const readCalled = useCallback(() => keptCalled(job.id), [job.id]);
  const calledAt = valueOr(useAsync(readCalled, marks)[0], null);
  const readDoor = useCallback(async () => (await frames()).some((frame) => frame.id === `${job.id}:door`), [job.id]);
  const photographed = valueOr(useAsync(readDoor, marks)[0], false);

  const kept = theWait(job, queued, arrival);
  const now = useNow(kept.endsAt !== null);
  const total = job.no_show_wait_min * 60_000;
  const left = kept.endsAt === null ? total : Math.max(0, kept.endsAt - now);
  const wait: Wait = {
    total,
    elapsed: total - left,
    over: kept.confirmed && kept.endsAt !== null && left <= 0,
    // The wait runs from the later of the check-in and the booked start, so it is still to begin while that is ahead.
    begun: kept.endsAt === null || Date.parse(job.starts_at) <= now,
    confirmed: kept.confirmed,
  };
  const again = () => {
    setMarks((was) => was + 1);
  };
  return { wait, calledAt, photographed, again };
}

/** What the line under the timer says: when the wait starts, that it waits for signal, or that it is over. */
function waitLine(job: Job, wait: Wait): string {
  if (!wait.begun) return copy.door.fromStart(clock(job.starts_at));
  if (!wait.confirmed) return copy.door.fromTap;
  return wait.over ? copy.door.over : copy.door.booked(clock(job.starts_at));
}

function Timer({ job, wait, who }: { job: Job; wait: Wait; who: string }) {
  return (
    <section className={styles.wait}>
      <p className={styles.waitingFor}>{copy.door.waitingFor(who)}</p>
      <p className={styles.timer}>
        <span className={styles.elapsed}>{countdown(wait.elapsed)}</span>
        <span className={styles.of}>{copy.door.of(job.no_show_wait_min)}</span>
      </p>
      <ProgressLine className={styles.bar} value={wait.elapsed / wait.total} tone="accent" />
      <p className={styles.line} role="status">
        {waitLine(job, wait)}
      </p>
    </section>
  );
}

/** One thing a no-show needs: done or not, what is known of it, and the way to do it. */
function Needed(props: { done: boolean; title: string; state: string; action?: ReactNode }) {
  return (
    <li className={styles.needed}>
      <StepMark state={props.done ? "done" : "todo"} />
      <span className={styles.neededWords}>
        <span className={styles.neededTitle}>{props.title}</span>
        <span className={styles.neededState}>{props.state}</span>
      </span>
      {props.action}
    </li>
  );
}

function NeededList(props: {
  job: Job;
  who: string;
  calledAt: number | null;
  photographed: boolean;
  onCalled: () => void;
  onTake: () => void;
}) {
  const { job, who, calledAt, photographed } = props;
  const whatsApp = whatsAppState(job.reminder);
  return (
    <ul className={styles.list}>
      <Needed done={whatsApp.done} title={copy.door.whatsApp(who)} state={whatsApp.state} />
      {job.client !== null && (
        <Needed
          done={calledAt !== null}
          title={copy.door.call(who)}
          state={calledAt === null ? copy.door.notCalled : copy.door.called(timeOf(calledAt))}
          action={
            <ButtonLink
              variant="outline"
              size="control"
              href={callLink(job.client.mobile)}
              aria-label={copy.door.call(who)}
              onClick={() => {
                void keepCalled(job.id).then(props.onCalled);
              }}
            >
              {copy.door.callAction}
            </ButtonLink>
          }
        />
      )}
      <Needed
        done={photographed}
        title={copy.door.photo}
        state={photographed ? copy.door.taken : copy.door.notTaken}
        action={
          <Button variant="outline" size="control" onClick={props.onTake}>
            {photographed ? copy.door.retake : copy.door.take}
          </Button>
        }
      />
    </ul>
  );
}

/** What Close as no-show still waits on: the wait, then the call and the door's photograph; none once it can. */
function closeHelperOf(wait: Wait, called: boolean, photographed: boolean): string | null {
  if (!wait.over) return copy.door.waitFirst;
  if (!called || !photographed) return copy.door.evidenceFirst;
  return null;
}

/** The note for ops, Close as no-show with what it waits on, and the question before it closes. */
function CloseNoShow({ job, who, ready, helper }: { job: Job; who: string; ready: boolean; helper: string | null }) {
  const [note, setNote] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [busy, once] = useOneAtATime();
  // The no-show is the outbox's from here: whether the API refused it as early is its to remember.
  const close = () =>
    void once(async () => {
      setConfirming(false);
      await queue("no_show", job.id, note.trim() === "" ? {} : { note: note.trim() }, job.starts_at);
      await replay();
      // The phone's clock ran ahead of ours: nothing was recorded, and the wait goes on.
      if (refusedAsEarly(await events(), job.id)) return;
      await keepClosed(job.id);
      go(`/jobs/${job.id}/done`);
    });
  const prepaid = job.badge === "prepaid";
  return (
    <>
      <Field label={copy.door.note}>
        {(control) => (
          <TextArea
            {...control}
            maxLength={500}
            value={note}
            onChange={(event) => {
              setNote(event.currentTarget.value);
            }}
          />
        )}
      </Field>
      <div className={styles.close}>
        {helper !== null && <p className={styles.closeHelper}>{helper}</p>}
        <Button
          variant="outline"
          size="control"
          disabled={!ready || busy}
          onClick={() => {
            setConfirming(true);
          }}
        >
          {copy.door.close}
        </Button>
      </div>
      {confirming && (
        <ConfirmSheet
          title={copy.confirm.title}
          body={prepaid ? copy.confirm.prepaid(who) : copy.confirm.bodyNothingPaid}
          yes={copy.confirm.yes}
          no={copy.confirm.no}
          onYes={close}
          onNo={() => {
            setConfirming(false);
          }}
        />
      )}
    </>
  );
}

/** When the technician checked in: the card's, or the tap still on its way. */
function checkedInAt(job: Job, queued: readonly Queued[]): number | null {
  if (job.progress.checked_in_at !== null) return Date.parse(job.progress.checked_in_at);
  return queued.find((event) => event.job_id === job.id && event.kind === "check_in")?.queued_at ?? null;
}

function AtTheDoor({ job, queued }: { job: Job; queued: readonly Queued[] }) {
  const { here, known, failed } = useCheckIn(job, queued);
  const stage = stageOf(job, queued, todayInIndia());
  // A no-show still on its way closes the job on the phone first; its own close goes on to the summary, or stays here
  // when the API refuses it as early.
  const closing = job.progress.outcome === null && outcomeOf(job, queued) === "no_show";
  // Once here, a check-in landing for a moment reads as neither the card's nor the phone's: only one measured too far
  // sends them back. Opened without one, the first read does.
  const [wasHere, setWasHere] = useState(false);
  useEffect(() => {
    if (here) setWasHere(true);
  }, [here]);
  const away = (stage !== "door" && !closing) || failed !== null || (known && !here && !wasHere);
  useEffect(() => {
    if (away) redirect(`/jobs/${job.id}`);
  }, [away, job.id]);
  const { wait, calledAt, photographed, again } = useDoor(job, queued);
  const [shooting, setShooting] = useState(false);
  const [starting, once] = useOneAtATime();

  if (away) return null;
  const who = job.client === null ? copy.door.theClient : firstNameOf(job.client.name);
  const called = job.client === null || calledAt !== null;
  const helper = closeHelperOf(wait, called, photographed);
  const at = checkedInAt(job, queued);
  const start = () =>
    void once(async () => {
      await queue("start", job.id, null, job.starts_at);
      void replay();
      go(stepPath(job.id, "before_photos"));
    });
  return (
    <CardFrame
      title={copy.door.title}
      sub={at === null ? nameOf(job) : copy.door.checkedIn(nameOf(job), timeOf(at))}
      back={`/jobs/${job.id}`}
      foot={
        <Button variant="primary" size="action" disabled={starting} busy={starting} onClick={start}>
          {jobCopy.start}
        </Button>
      }
    >
      <Timer job={job} wait={wait} who={who} />
      <section className={styles.section} aria-labelledby="door-needed">
        <SectionHead title={copy.door.needed} size="list" id="door-needed" />
        <NeededList
          job={job}
          who={who}
          calledAt={calledAt}
          photographed={photographed}
          onCalled={again}
          onTake={() => {
            setShooting(true);
          }}
        />
        <CloseNoShow job={job} who={who} ready={helper === null} helper={helper} />
        {refusedAsEarly(queued, job.id) && (
          <p className={styles.early} role="alert">
            {copy.door.early}
          </p>
        )}
      </section>
      <section className={styles.section}>
        <SectionHead title={copy.appears.title} size="list" />
        <p className={styles.line}>{copy.appears.body}</p>
      </section>
      {/* Over the screen, so what was typed for ops stays while the photograph is taken. */}
      {shooting && (
        <DoorCamera
          onTaken={(photo) => {
            buzz();
            void keepDoorFrame(job.id, photo).then(() => {
              setShooting(false);
              again();
            });
          }}
          onCancel={() => {
            setShooting(false);
          }}
        />
      )}
    </CardFrame>
  );
}

export function DoorScreen({ id }: { id: string }) {
  const waiting = useOutbox();
  const [loaded, retry] = useJob(id, signatureOf(waiting));
  if (loaded.state === "loading") return <Loading onPaper />;
  if (loaded.state === "failed") return <JobFailed failed={loaded} onRetry={retry} onPaper />;
  return <AtTheDoor job={loaded.value} queued={waiting.events} />;
}
