// Boards A3 and B5: one job's card, and beneath it the stage the job is at.
//
// A3 is the card — client, time and type, the badge, the address with its
// access notes and Navigate. B5 is the evidence chain that follows it: arrive,
// wait, and either start the job or close it as a no-show. They are one screen
// because they are one moment at the door.
//
// A job further out shows time, type and sector only: the API withholds the
// address and the client card until the day before, so the card simply has none.

import { useCallback } from "react";
import type { Job } from "../api.ts";
import { Icon } from "../components/Icon.tsx";
import { badges, job as copy, types, typesLower } from "../content.ts";
import { BACK, PIN } from "../icons.ts";
import { closed, nextStep, started } from "../lib/progress.ts";
import { useJob } from "../lib/useDay.ts";
import { signatureOf, useOutbox } from "../lib/useOutbox.ts";
import { clock, where } from "../lib/when.ts";
import { go, stepPath } from "../route.ts";
import { Failed, Loading } from "../states/States.tsx";
import { NotHome } from "./NotHome.tsx";
import styles from "./job.module.css";

/** The address as one line, from the parts the API keeps it in. */
function addressLine(parts: NonNullable<Job["address"]>): string {
  return [parts.line1, parts.line2, parts.locality, `${parts.city} ${parts.pincode}`]
    .filter((part) => part !== null && part.trim() !== "")
    .join(", ");
}

export function JobScreen({ id }: { id: string }) {
  const waiting = useOutbox();
  const [loaded, retry] = useJob(id, signatureOf(waiting));

  const onBack = useCallback(() => {
    go("/");
  }, []);

  if (loaded.state === "loading") return <Loading />;
  if (loaded.state === "failed") {
    return (
      <main className={styles.screen}>
        <Failed message={copy.failed} retry={copy.retry} onRetry={retry} />
      </main>
    );
  }

  const job = loaded.value;
  const type = job.type;
  const step = nextStep(job, waiting.events);
  const running = started(job, waiting.events);
  const over = closed(job, waiting.events);

  return (
    <main className={styles.screen}>
      <header className={styles.head}>
        <button className={styles.back} type="button" aria-label={copy.back} onClick={onBack}>
          <Icon d={BACK} size={24} />
        </button>
        <div className={styles.headWho}>
          <h1 className={styles.name}>
            {job.client === null ? (type === null ? copy.locked.title : types[type]) : job.client.name}
          </h1>
          <p className={styles.when}>
            {copy.when(clock(job.starts_at), type === null ? copy.locked.title : typesLower[type])}
          </p>
        </div>
        <span className={styles.badge}>{badges[job.badge]}</span>
      </header>

      <div className={styles.body}>
        {job.address === null ? (
          <section className={styles.locked}>
            <p className={styles.lockedTitle}>{copy.locked.title}</p>
            <p className={styles.lockedBody}>{copy.locked.body}</p>
            <p className={styles.sector}>{where(job.sector)}</p>
          </section>
        ) : (
          <section className={styles.address}>
            <p className={styles.line}>{addressLine(job.address)}</p>
            {job.access_notes !== null && <p className={styles.access}>{job.access_notes}</p>}
            <a className={styles.navigate} href={`geo:0,0?q=${encodeURIComponent(addressLine(job.address))}`}>
              <Icon d={PIN} size={21} />
              <span>{copy.navigate}</span>
            </a>
          </section>
        )}

        {job.unlocked && !over && <NotHome job={job} queued={waiting.events} />}
      </div>

      {job.unlocked && !over && running && step !== null && (
        <div className={styles.foot}>
          <button
            className={styles.action}
            type="button"
            onClick={() => {
              go(stepPath(job.id, step));
            }}
          >
            {copy.continueJob}
          </button>
        </div>
      )}

      {over && (
        <div className={styles.foot}>
          <button
            className={styles.action}
            type="button"
            onClick={() => {
              go(`/jobs/${job.id}/done`);
            }}
          >
            {copy.continueJob}
          </button>
        </div>
      )}
    </main>
  );
}
