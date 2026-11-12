// Closed (docs/prompts/tech-redesign.md, "Closed"; docs/decisions/0246-closed-and-sent-back.md): the visit's result in
// its heading, what it came to in rows, a one visit's payment link with Resend, a way to finish a visit left partly
// done, and the next job with Today and Navigate; a no-show's evidence in place of the rows. It says what is true: a
// job whose outcome neither landed nor waits on the phone is not called closed.

import { ICONS } from "@maneman/brand/icons";
import { Button } from "@maneman/ui/Button";
import { Icon } from "@maneman/ui/Icon";
import { useAsync, valueOr } from "@maneman/ui/useAsync";
import { useCallback } from "react";
import type { Job, JobSummary } from "../api.ts";
import { badges, closeOut as copy, titles } from "../content.ts";
import { kindNameLower } from "../lib/kind.ts";
import { declinedTheFit, fitBookedLater, outcomeOf, type Outcome } from "../lib/progress.ts";
import { useDay, useJob, useNames } from "../lib/useDay.ts";
import { signatureOf, useOutbox } from "../lib/useOutbox.ts";
import { useScreen } from "../lib/useScreen.ts";
import { clock, lengthOf, metres, todayInIndia, where } from "../lib/when.ts";
import { NO_PIECE } from "@rules/policy/in-job-steps.ts";
import { go } from "../route.ts";
import { JobFailed } from "../frame/JobFailed.tsx";
import { Failed, Loading } from "../frame/States.tsx";
import { type Heard, keptArrival, keptClosed, keptOutcome, keptStates } from "../store/jobs.ts";
import type { Queued } from "../store/outbox.ts";
import { classes } from "@maneman/ui/classes";
import frame from "../frame/frame.module.css";
import light from "../frame/light.module.css";
import { FinishTheWork, NavigateNext, NextUp, PaymentLink } from "./ClosedParts.tsx";
import shared from "./steps.module.css";
import styles from "./close-out.module.css";
import { sayKnown, theirs } from "../lang/index.ts";

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

/**
 * How the job closed, in a word: a one visit done once the client declined is a free consultation, and one whose fit
 * was booked for another day a consultation with the fit to book.
 */
function closedAs(job: Job, outcome: Outcome, queued: readonly Queued[], notFitted: boolean): string {
  if (notFitted) return copy.notFitted;
  if (outcome === "done" && declinedTheFit(job, queued)) return copy.freeConsultation;
  if (outcome === "done" && fitBookedLater(job, queued)) return copy.fitToBook;
  return copy.outcomes[outcome];
}

/** The heading: a no-show's, a fit closed at its piece's, or any other visit's. */
function titleOf(outcome: Outcome, notFitted: boolean): string {
  if (outcome === "no_show") return copy.titles.no_show;
  return notFitted ? copy.titles.not_fitted : copy.titles.closed;
}

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

/** What was decided, as the outcome step took it: why it was partly done, or whether the client goes ahead with a fit. */
function Decided({ job }: { job: Job }) {
  const readOutcome = useCallback(() => keptOutcome(job.id), [job.id]);
  const said = valueOr(useAsync(readOutcome)[0], null);
  if (said === null) return null;
  // Ops' reasons, in Hindi where a catalog holds the whole of one, as they wrote it otherwise.
  const label = (reasons: Job["partial_reasons"], id: string | undefined) => {
    const found = reasons.find((reason) => reason.id === id)?.label;
    return found === undefined ? null : sayKnown(found);
  };
  if (said.outcome === "partial") {
    const why = label(job.partial_reasons, said.reason);
    return why === null ? null : <Row name={copy.why} value={why} />;
  }
  if (said.going_ahead === undefined) return null;
  const lost = label(job.lost_reasons, said.lost_reason);
  const fit = said.going_ahead ? copy.goingAhead : copy.notNow(lost === null ? null : theirs(lost));
  return <Row name={copy.fit} value={fit} />;
}

/** How long the visit took, from the check-in to its close: as this phone kept the close, else when it was queued. */
function tookOf(started: number | null, closedAt: number | null, queued: readonly Queued[], id: string) {
  const closed = closedAt ?? queued.find((event) => event.job_id === id && event.kind === "outcome")?.queued_at ?? null;
  return started === null || closed === null ? null : lengthOf(started, closed);
}

/** What the visit came to: the decision, how long it took, its photographs and how it is paid. */
function Rows(props: { job: Job; took: { hours: number; minutes: number } | null; photos: string }) {
  return (
    <dl className={classes(shared.rows, styles.rows)}>
      <Decided job={props.job} />
      {props.took !== null && <Row name={copy.duration} value={copy.length(props.took.hours, props.took.minutes)} />}
      <Row name={copy.photos} value={props.photos} />
      <Row name={copy.paymentRow} value={badges[props.job.badge]} />
    </dl>
  );
}

/** When the technician checked in: as the card says, or, checked in with no signal, when the phone took it. */
function checkedInAt(job: Job, queued: readonly Queued[]): number | null {
  if (job.progress.checked_in_at !== null) return Date.parse(job.progress.checked_in_at);
  return queued.find((event) => event.job_id === job.id && event.kind === "check_in")?.queued_at ?? null;
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
  // A fit closed at its piece, "Can't fit today", as the phone kept its close.
  const readSaid = useCallback(() => keptOutcome(id), [id]);
  const said = valueOr(useAsync(readSaid)[0], null);

  if (loaded.state === "loading") return <Loading />;
  if (loaded.state === "failed") {
    return <JobFailed failed={loaded} onRetry={retry} />;
  }

  const job = loaded.value;
  if (outcome === null) {
    return (
      <main className={classes(frame.screen, light.paperScreen)} data-look="light">
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
  const took = tookOf(checkedInAt(job, waiting.events), closedAt, waiting.events, id);

  const sets = job.progress.steps_done.filter((step) => step === "before_photos" || step === "after_photos").length;
  const queuedFrames = waiting.frames.filter((frame) => frame.job_id === id).length;
  const photos = queuedFrames > 0 ? copy.queued(queuedFrames) : copy.sent(sets * IN_A_SET);
  const later = day.state === "loaded" ? nextAfter(day.value, job, states ?? NOTHING_HEARD) : null;
  const notFitted = outcome === "partial" && said?.outcome === "partial" && said.reason === NO_PIECE;
  const closing = waiting.events.some((event) => event.job_id === id && event.kind === "outcome");

  return (
    <main className={classes(frame.screen, light.paperScreen)} data-look="light">
      <section className={styles.closed}>
        <span className={outcome === "no_show" || notFitted ? styles.markQuiet : styles.mark} aria-hidden="true">
          <Icon d={ICONS.tick} size="lg" weight="heavy" />
        </span>
        <h1 className={styles.title} ref={heading} tabIndex={-1}>
          {titleOf(outcome, notFitted)}
        </h1>
        <p className={styles.sub}>
          {copy.sub(who, kindNameLower(job), closedAs(job, outcome, waiting.events, notFitted))}
        </p>
        {outcome === "no_show" ? <Evidence job={job} /> : <Rows job={job} took={took} photos={photos} />}
        {/* A card the phone kept from before one visits names no link. */}
        {job.one_visit && job.payment_link !== null && <PaymentLink job={job} link={job.payment_link} />}
        {outcome === "partial" && <FinishTheWork job={job} closing={closing} />}
        {later !== null && (
          <NextUp next={later} name={names.get(later.id) ?? later.client_name ?? where(later.sector)} />
        )}
      </section>

      <div className={classes(frame.foot, light.paperFoot, styles.foot)}>
        <Button
          variant={later?.address === null || later === null ? "primary" : "outline"}
          size="action"
          className={styles.today}
          onClick={() => {
            go("/");
          }}
        >
          {later === null ? copy.lastJob : copy.next.today}
        </Button>
        {later !== null && <NavigateNext next={later} />}
      </div>
    </main>
  );
}
