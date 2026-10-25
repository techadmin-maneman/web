// The close-out: the job, its outcome, how long it took, its photographs on their way, and the next job; a no-show's
// evidence summary instead. It says what is true: a job whose outcome neither landed nor waits on the phone
// is not called closed.

import { capsLook } from "@maneman/ui/Caps";
import { ICONS } from "@maneman/brand/icons";
import { Button } from "@maneman/ui/Button";
import { Icon } from "@maneman/ui/Icon";
import { useAsync, valueOr } from "@maneman/ui/useAsync";
import { useCallback } from "react";
import type { Job, JobSummary } from "../api.ts";
import { closeOut as copy, oneVisit, titles } from "../content.ts";
import { declinedTheFit, outcomeOf, type Outcome } from "../lib/progress.ts";
import { useDay, useJob, useNames } from "../lib/useDay.ts";
import { signatureOf, useOutbox } from "../lib/useOutbox.ts";
import { useScreen } from "../lib/useScreen.ts";
import { clock, lengthOf, metres, todayInIndia, where } from "../lib/when.ts";
import { go } from "../route.ts";
import { JobFailed } from "../states/JobFailed.tsx";
import { Failed, Loading } from "../states/States.tsx";
import { type Heard, keptArrival, keptClosed, keptStates } from "../store/jobs.ts";
import type { Queued } from "../store/outbox.ts";
import frame from "../components/frame.module.css";
import shared from "./steps.module.css";
import styles from "./close-out.module.css";

const NOTHING_HEARD: ReadonlyMap<string, Heard> = new Map();

/** Five angles before and five after: the ten the board counts. */
const IN_A_SET = 5;

/** The next job of the day after this one's time still to work, which the board's last action opens. */
function nextAfter(jobs: readonly JobSummary[], after: Job, heard: ReadonlyMap<string, Heard>): JobSummary | null {
  const open = (job: JobSummary) =>
    job.id !== after.id &&
    job.status !== "completed" &&
    job.status !== "terminated" &&
    job.status !== "cancelled" &&
    (heard.get(job.id)?.outcome ?? job.progress.outcome) === null;
  // A job they checked in at and left waiting, at whatever time, comes before the next one booked.
  const atTheDoor = jobs.find((job) => open(job) && heard.get(job.id)?.arrived === true);
  return atTheDoor ?? jobs.find((job) => job.starts_at > after.starts_at && open(job)) ?? null;
}

/** How the job closed, in the heading's words: a one visit done once the client declined is a free consultation. */
function closedAs(job: Job, outcome: Outcome, queued: readonly Queued[]): string {
  if (outcome === "done" && declinedTheFit(job, queued)) return copy.freeConsultation;
  return copy.outcomes[outcome];
}

/** Where a one visit's payment link stands: texted to the client, or paid. */
const linkState = (link: NonNullable<Job["payment_link"]>): string =>
  link.paid ? oneVisit.linkPaid : oneVisit.linkSent;

function Row({ name, value }: { name: string; value: string }) {
  return (
    <div className={shared.row}>
      <dt className={shared.rowKey}>{name}</dt>
      <dd className={shared.rowValue}>{value}</dd>
    </div>
  );
}

/** What the day-before WhatsApp came to, as ops will read it. */
function receiptOf(job: Job): string {
  if (job.reminder === null) return copy.noShow.noneSent;
  const delivered = job.reminder.delivered_at;
  return delivered === null ? copy.noShow.notDelivered : copy.noShow.delivered(clock(delivered));
}

/** The evidence chain's close: the three facts ops rule on, as the phone knows them. */
function Evidence({ job }: { job: Job }) {
  const readArrival = useCallback(() => keptArrival(job.id), [job.id]);
  const measured = valueOr(useAsync(readArrival)[0], null)?.distance_m ?? null;

  const checkedIn = job.progress.checked_in_at;
  const distance = job.progress.distance_m ?? measured;
  return (
    <>
      <dl className={shared.rows}>
        {checkedIn !== null && <Row name={copy.noShow.checkedIn} value={clock(checkedIn)} />}
        <Row name={copy.noShow.distance} value={distance === null ? copy.noShow.unmeasured : metres(distance)} />
        <Row name={copy.noShow.whatsApp} value={receiptOf(job)} />
      </dl>
      <p className={styles.closeNote}>{copy.noShow.ops}</p>
    </>
  );
}

/** How a job closed: as its card or the phone's outbox says, else as the API's answer to its outcome did once it landed. */
function useOutcome(
  job: Job | null,
  queued: readonly Queued[],
  states: ReadonlyMap<string, Heard> | null,
): Outcome | null {
  const heard = states?.get(job?.id ?? "")?.outcome ?? null;
  if (job === null) return null;
  return outcomeOf({ id: job.id, progress: { ...job.progress, outcome: job.progress.outcome ?? heard } }, queued);
}

export function CloseOut({ id }: { id: string }) {
  const waiting = useOutbox();
  const [loaded, retry] = useJob(id, signatureOf(waiting));
  const states = valueOr(useAsync(keptStates, signatureOf(waiting))[0], null);
  const outcome = useOutcome(loaded.state === "loaded" ? loaded.value : null, waiting.events, states);
  const [day] = useDay(todayInIndia());
  const names = useNames();
  const heading = useScreen(titles.closeOut);

  const readClosed = useCallback(() => keptClosed(id), [id]);
  const closedAt = valueOr(useAsync(readClosed)[0], null);

  if (loaded.state === "loading") return <Loading />;
  if (loaded.state === "failed") {
    return <JobFailed failed={loaded} onRetry={retry} />;
  }

  const job = loaded.value;
  if (outcome === null) {
    return (
      <main className={frame.screen}>
        <Failed
          message={copy.notClosed}
          retry={copy.backToJob}
          onRetry={() => {
            go(`/jobs/${id}`);
          }}
        />
      </main>
    );
  }

  const who = names.get(id) ?? job.client?.name ?? "";
  const started = job.progress.started_at === null ? null : new Date(job.progress.started_at).getTime();
  const took = started === null || closedAt === null ? null : lengthOf(started, closedAt);

  const sets = job.progress.steps_done.filter((step) => step === "before_photos" || step === "after_photos").length;
  const queuedFrames = waiting.frames.filter((frame) => frame.job_id === id).length;

  const later = day.state === "loaded" ? nextAfter(day.value, job, states ?? NOTHING_HEARD) : null;

  return (
    <main className={frame.screen}>
      <section className={shared.close}>
        <p className={capsLook(shared.closeLabel)}>{copy.label}</p>
        <Icon className={shared.closeTick} d={ICONS.tick} size="xl" weight="heavy" />
        <h1 className={shared.closeWho} ref={heading} tabIndex={-1}>
          {copy.who(who)}
          <span className={shared.closedAs}>{closedAs(job, outcome, waiting.events)}</span>
        </h1>
        {outcome === "no_show" ? (
          <Evidence job={job} />
        ) : (
          <dl className={shared.rows}>
            {took !== null && <Row name={copy.duration} value={copy.length(took.hours, took.minutes)} />}
            <Row name={copy.photos} value={queuedFrames > 0 ? copy.queued(queuedFrames) : copy.sent(sets * IN_A_SET)} />
            {/* A card the phone kept from before one visits names neither. */}
            {job.one_visit && job.payment_link !== null && (
              <Row name={oneVisit.payment} value={linkState(job.payment_link)} />
            )}
          </dl>
        )}
      </section>

      <div className={frame.foot}>
        <Button
          variant="gold"
          size="action"
          className={frame.action}
          onClick={() => {
            go(later === null ? "/" : `/jobs/${later.id}`);
          }}
        >
          {later === null
            ? copy.lastJob
            : copy.nextJob(clock(later.starts_at), names.get(later.id) ?? where(later.sector))}
        </Button>
      </div>
    </main>
  );
}
