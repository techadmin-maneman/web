// Board B4's close-out: the job's name and outcome, how long it took, how many
// photographs are on their way, and the next job. A no-show closes with board
// B5's evidence summary instead — when he checked in, how far from the door,
// whether the day-before WhatsApp reached the client — and what happens next.
//
// It says what is true and nothing more: a job whose outcome neither landed nor
// waits on the phone — a no-show the API refused as early, say — is not closed,
// and the screen says so rather than "done".
//
// The duration is the phone's own: it runs from the `started_at` the API keeps
// to the instant the technician took the outcome, because nothing gives the
// closing time back (docs/open-points.md, item 60).
//
// A consultation and fit in one visit closed with the client fitted says where
// its payment link stands, once the card the API gives back has one, which no
// board draws (docs/decisions/0105-a-consultation-and-fit-in-one-visit.md).

import { ICONS } from "@maneman/brand/icons";
import { Button } from "@maneman/ui/Button";
import { Icon } from "@maneman/ui/Icon";
import { useEffect, useState } from "react";
import type { Job, JobSummary } from "../api.ts";
import { closeOut as copy, job as jobCopy, oneVisit, titles } from "../content.ts";
import { STROKE } from "../icons.ts";
import { outcomeOf } from "../lib/progress.ts";
import { useDay, useJob, useNames } from "../lib/useDay.ts";
import { signatureOf, useOutbox } from "../lib/useOutbox.ts";
import { useScreen } from "../lib/useScreen.ts";
import { clock, clockShort, lengthOf, metres, todayInIndia, where } from "../lib/when.ts";
import { go } from "../route.ts";
import { Failed, Loading } from "../states/States.tsx";
import { keptArrival, keptClosed } from "../store/jobs.ts";
import styles from "./steps.module.css";

/** Five angles before and five after: the ten the board counts. */
const IN_A_SET = 5;

/** The next job of the day after this one's time, which the board's last action opens. */
function nextAfter(jobs: readonly JobSummary[], after: string): JobSummary | null {
  return jobs.find((job) => job.starts_at > after) ?? null;
}

/** Where a one visit's payment link stands: texted to the client, or paid. */
const linkState = (link: NonNullable<Job["payment_link"]>): string =>
  link.paid ? oneVisit.linkPaid : oneVisit.linkSent;

function Row({ name, value }: { name: string; value: string }) {
  return (
    <div className={styles.row}>
      <dt className={styles.rowKey}>{name}</dt>
      <dd className={styles.rowValue}>{value}</dd>
    </div>
  );
}

/** What the day-before WhatsApp came to, as ops will read it. */
function receiptOf(job: Job): string {
  if (job.reminder === null) return copy.noShow.noneSent;
  const delivered = job.reminder.delivered_at;
  return delivered === null ? copy.noShow.notDelivered : copy.noShow.delivered(clock(delivered));
}

/** Board B5's close: the three facts ops rule on, as the phone knows them. */
function Evidence({ job }: { job: Job }) {
  const [measured, setMeasured] = useState<number | null>(null);
  useEffect(() => {
    let current = true;
    void keptArrival(job.id).then((arrival) => {
      if (current) setMeasured(arrival?.distance_m ?? null);
    });
    return () => {
      current = false;
    };
  }, [job.id]);

  const checkedIn = job.progress.checked_in_at;
  const distance = job.progress.distance_m ?? measured;
  return (
    <>
      <dl className={styles.rows}>
        {checkedIn !== null && <Row name={copy.noShow.checkedIn} value={clock(checkedIn)} />}
        <Row name={copy.noShow.distance} value={distance === null ? copy.noShow.unmeasured : metres(distance)} />
        <Row name={copy.noShow.whatsApp} value={receiptOf(job)} />
      </dl>
      <p className={styles.closeNote}>{copy.noShow.ops}</p>
    </>
  );
}

export function CloseOut({ id }: { id: string }) {
  const waiting = useOutbox();
  const [loaded, retry] = useJob(id, signatureOf(waiting));
  const [day] = useDay(todayInIndia());
  const names = useNames();
  const [closedAt, setClosedAt] = useState<number | null>(null);
  const heading = useScreen(titles.closeOut);

  useEffect(() => {
    let current = true;
    void keptClosed(id).then((at) => {
      if (current) setClosedAt(at);
    });
    return () => {
      current = false;
    };
  }, [id]);

  if (loaded.state === "loading") return <Loading />;
  if (loaded.state === "failed") {
    return (
      <main className={styles.screen}>
        <Failed message={jobCopy.failed} retry={jobCopy.retry} onRetry={retry} />
      </main>
    );
  }

  const job = loaded.value;
  const outcome = outcomeOf(job, waiting.events);
  if (outcome === null) {
    return (
      <main className={styles.screen}>
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

  const later = day.state === "loaded" ? nextAfter(day.value, job.starts_at) : null;

  return (
    <main className={styles.screen}>
      <section className={styles.close}>
        <p className={styles.closeLabel}>{copy.label}</p>
        <Icon className={styles.closeTick} d={ICONS.tick} size={28} stroke={STROKE} />
        <h1 className={styles.closeWho} ref={heading} tabIndex={-1}>
          {copy.who(who, copy.outcomes[outcome])}
        </h1>
        {outcome === "no_show" ? (
          <Evidence job={job} />
        ) : (
          <dl className={styles.rows}>
            {took !== null && <Row name={copy.duration} value={copy.length(took.hours, took.minutes)} />}
            <Row name={copy.photos} value={queuedFrames > 0 ? copy.queued(queuedFrames) : copy.sent(sets * IN_A_SET)} />
            {job.payment_link !== null && <Row name={oneVisit.payment} value={linkState(job.payment_link)} />}
          </dl>
        )}
      </section>

      <div className={styles.foot}>
        <Button
          variant="gold"
          size="action"
          className={styles.action}
          onClick={() => {
            go(later === null ? "/" : `/jobs/${later.id}`);
          }}
        >
          {later === null
            ? copy.lastJob
            : copy.nextJob(clockShort(later.starts_at), names.get(later.id) ?? where(later.sector))}
        </Button>
      </div>
    </main>
  );
}
