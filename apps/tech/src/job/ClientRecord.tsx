// The client's record on the job (docs/decisions/0242-client-record.md): their alerts, which every technician reads
// before they start, the note the last technician left with that visit's after photographs, and the way to their
// history, as the prototype draws them: the photographs as five labelled tiles under the note, and the history one
// line, none for a client with no visits before. They belong to the client, not the job, so a job given to another
// technician brings them along. The photographs are the API's to give, never kept on the phone.

import { ProblemCard } from "@maneman/ui/ProblemCard";
import { Link } from "@maneman/ui/router";
import { SectionHead } from "@maneman/ui/SectionHead";
import type { Job } from "../api.ts";
import { clientRecord as copy } from "../content.ts";
import { dayMonth } from "../lib/when.ts";
import { shortMonth } from "@maneman/web-kit/dates";

import { PhotoTiles } from "./PhotoTiles.tsx";
import styles from "./client-record.module.css";
import { Chevron } from "../frame/Chevron.tsx";

/** "Jul", the month of a day. */
const monthName = (isoDate: string): string => shortMonth(isoDate.slice(0, 7)).split(" ")[0] ?? "";

/** The history's line: "5 visits since Jul"; nothing while the card does not say. */
export function visitsOf(job: Pick<Job, "client_visits" | "date">): string | null {
  const visits = job.client_visits;
  const first = visits?.first ?? null;
  if (visits === null || first === null) return null;
  const sameYear = first.slice(0, 4) === job.date.slice(0, 4);
  return copy.since(visits.count, sameYear ? monthName(first) : `${monthName(first)} ${first.slice(0, 4)}`);
}

function Handoff({ handoff }: { handoff: NonNullable<Job["handoff"]> }) {
  return (
    <div>
      <SectionHead title={copy.handoff} size="list" end={copy.handoffBy(handoff.technician, dayMonth(handoff.date))} />
      <p className={styles.handoffNote}>{handoff.note}</p>
      {handoff.photos.length > 0 && (
        <>
          <PhotoTiles photos={handoff.photos} alt={copy.photo} tall />
          <p className={styles.caption}>{copy.afterPhotos(dayMonth(handoff.date))}</p>
        </>
      )}
    </div>
  );
}

export function ClientRecord({ job }: { job: Job }) {
  // A client with no visits before has no history to open (the card says none, or names no first).
  const newClient = job.client_visits !== null && job.client_visits.count === 0;
  const visits = visitsOf(job);
  return (
    <section className={styles.record}>
      {job.client_alerts.length > 0 && (
        <ProblemCard className={styles.alerts} title={copy.alerts} level={2}>
          <ul className={styles.alertList}>
            {job.client_alerts.map((alert) => (
              <li key={alert.id}>{alert.body}</li>
            ))}
          </ul>
        </ProblemCard>
      )}
      {job.handoff !== null && <Handoff handoff={job.handoff} />}
      {!newClient && (
        <Link className={styles.history} to={`/jobs/${job.id}/history`}>
          <span className={styles.historyTitle}>{copy.history}</span>
          <span className={styles.historyEnd}>
            {visits !== null && <span>{visits}</span>}
            <Chevron />
          </span>
        </Link>
      )}
    </section>
  );
}
