// The client's record on the job (docs/decisions/0242-client-record.md): their alerts, which every technician reads
// before they start, the note the last technician left with that visit's after photographs, and the way to their
// history. They belong to the client, not the job, so a job given to another technician brings them along. The
// photographs are the API's to give, never kept on the phone.

import { GLYPHS } from "@maneman/brand/icons";
import { Icon } from "@maneman/ui/Icon";
import { ListRow, ListRows } from "@maneman/ui/ListRow";
import { ProblemCard } from "@maneman/ui/ProblemCard";
import { SectionHead } from "@maneman/ui/SectionHead";
import type { Job } from "../api.ts";
import { clientRecord as copy, guides } from "../content.ts";
import { dayMonth } from "../lib/when.ts";
import styles from "./client-record.module.css";

export function ClientRecord({ job }: { job: Job }) {
  return (
    <section className={styles.record}>
      <div className={styles.inset}>
        {job.client_alerts.length > 0 && (
          <ProblemCard className={styles.alerts} title={copy.alerts} level={2}>
            <ul className={styles.alertList}>
              {job.client_alerts.map((alert) => (
                <li key={alert.id}>{alert.body}</li>
              ))}
            </ul>
          </ProblemCard>
        )}
        {job.handoff !== null && (
          <div className={styles.handoff}>
            <SectionHead
              title={copy.handoff}
              size="list"
              end={copy.handoffBy(job.handoff.technician, dayMonth(job.handoff.date))}
            />
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
      </div>
      <ListRows>
        <ListRow title={copy.history} to={`/jobs/${job.id}/history`} end={<Icon d={GLYPHS.chevron} size="sm" />} />
        <ListRow title={guides.howDone} to={`/guides/${job.type}`} end={<Icon d={GLYPHS.chevron} size="sm" />} />
      </ListRows>
    </section>
  );
}
