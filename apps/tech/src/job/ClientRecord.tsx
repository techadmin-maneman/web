// The client's record on the job's card (docs/decisions/0242-client-record.md): their alerts, which every technician
// reads before they start, the note the last technician left, and the way to their history. They belong to the
// client, not the job, so a job given to another technician brings them along.

import { Link } from "@maneman/ui/router";
import type { Job } from "../api.ts";
import { clientRecord as copy } from "../content.ts";
import { dayMonth } from "../lib/when.ts";
import styles from "./client-record.module.css";

export function ClientRecord({ job }: { job: Job }) {
  return (
    <section className={styles.record}>
      {job.client_alerts.length > 0 && (
        <div className={styles.alerts} role="note" aria-labelledby={`alerts-${job.id}`}>
          <p className={styles.alertsTitle} id={`alerts-${job.id}`}>
            {copy.alerts}
          </p>
          <ul className={styles.alertList}>
            {job.client_alerts.map((alert) => (
              <li key={alert.id}>{alert.body}</li>
            ))}
          </ul>
        </div>
      )}
      {job.handoff !== null && (
        <div className={styles.handoff}>
          <p className={styles.handoffTitle}>{copy.handoff}</p>
          <p className={styles.handoffNote}>{job.handoff.note}</p>
          <p className={styles.handoffBy}>{copy.handoffBy(job.handoff.technician, dayMonth(job.handoff.date))}</p>
        </div>
      )}
      <Link className={styles.history} to={`/jobs/${job.id}/history`}>
        {copy.history}
      </Link>
    </section>
  );
}
