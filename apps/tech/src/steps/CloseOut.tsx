// Board B4's close-out: the job's name and outcome, how long it took, how many
// photographs are on their way, and the next job.
//
// The duration is the phone's own: it runs from the `started_at` the API keeps
// to the instant the technician took the outcome, because nothing gives the
// closing time back (docs/open-points.md, item 57).

import { useEffect, useState } from "react";
import type { JobSummary } from "../api.ts";
import { Icon } from "../components/Icon.tsx";
import { closeOut as copy, job as jobCopy } from "../content.ts";
import { TICK } from "../icons.ts";
import { useDay, useJob, useNames } from "../lib/useDay.ts";
import { signatureOf, useOutbox } from "../lib/useOutbox.ts";
import { clockShort, lengthOf, todayInIndia } from "../lib/when.ts";
import { go } from "../route.ts";
import { Failed, Loading } from "../states/States.tsx";
import { keptClosed } from "../store/jobs.ts";
import styles from "./steps.module.css";

/** Five angles before and five after: the ten the board counts. */
const IN_A_SET = 5;

export function CloseOut({ id }: { id: string }) {
  const waiting = useOutbox();
  const [loaded, retry] = useJob(id, signatureOf(waiting));
  const [day] = useDay(todayInIndia());
  const names = useNames();
  const [closedAt, setClosedAt] = useState<number | null>(null);

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
  const queuedHere = waiting.events.filter((event) => event.job_id === id);
  const noShow = queuedHere.some((event) => event.kind === "no_show") || job.progress.outcome === "no_show";
  const outcome = noShow ? "no_show" : job.progress.outcome === "partial" ? "partial" : "done";
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
        <Icon className={styles.closeTick} d={TICK} size={28} />
        <h1 className={styles.closeWho}>{copy.who(who, copy.outcomes[outcome])}</h1>
        <dl className={styles.rows}>
          {took !== null && (
            <div className={styles.row}>
              <dt className={styles.rowKey}>{copy.duration}</dt>
              <dd className={styles.rowValue}>{copy.length(took.hours, took.minutes)}</dd>
            </div>
          )}
          <div className={styles.row}>
            <dt className={styles.rowKey}>{copy.photos}</dt>
            <dd className={styles.rowValue}>
              {queuedFrames > 0 ? copy.queued(queuedFrames) : copy.sent(sets * IN_A_SET)}
            </dd>
          </div>
        </dl>
      </section>

      <div className={styles.foot}>
        <button
          className={styles.action}
          type="button"
          onClick={() => {
            go(later === null ? "/" : `/jobs/${later.id}`);
          }}
        >
          {later === null
            ? copy.lastJob
            : copy.nextJob(clockShort(later.starts_at), names.get(later.id) ?? jobCopy.locked.title)}
        </button>
      </div>
    </main>
  );
}

/** The next job of the day after this one's time, which the board's last action opens. */
function nextAfter(jobs: readonly JobSummary[], after: string): JobSummary | null {
  return jobs.find((job) => job.starts_at > after) ?? null;
}
