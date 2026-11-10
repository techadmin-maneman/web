// The client's record on the job's card (docs/decisions/0242-client-record.md): their alerts, which every technician
// reads before they start, the note the last technician left with that visit's after photographs, and the way to
// their history. They belong to the client, not the job, so a job given to another technician brings them along. The
// photographs are the API's to give, never kept on the phone.

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
          <h2 className={styles.alertsTitle} id={`alerts-${job.id}`}>
            {copy.alerts}
          </h2>
          <ul className={styles.alertList}>
            {job.client_alerts.map((alert) => (
              <li key={alert.id}>{alert.body}</li>
            ))}
          </ul>
        </div>
      )}
      {job.handoff !== null && (
        <div className={styles.handoff}>
          <p className={styles.handoffHead}>
            <span>{copy.handoff}</span>
            <span>{copy.handoffBy(job.handoff.technician, dayMonth(job.handoff.date))}</span>
          </p>
          <p className={styles.handoffNote}>{job.handoff.note}</p>
          {job.handoff.photos.length > 0 && (
            <div className={styles.photos}>
              {job.handoff.photos.map((photo) => (
                <img key={photo.url} className={styles.photo} src={photo.url} alt={copy.photo(photo.angle)} />
              ))}
            </div>
          )}
        </div>
      )}
      <Link className={styles.history} to={`/jobs/${job.id}/history`}>
        {copy.history}
      </Link>
    </section>
  );
}
