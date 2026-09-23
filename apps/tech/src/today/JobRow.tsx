// One job on the day's list (board A1): time down the left, then the type, the
// badge, the client and the sector. No amount, anywhere.
//
// The day's list carries no client: the API gives one only with the card, from
// the day before the visit, so the name is the one the phone kept when it
// fetched the cards (apps/tech/src/lib/useDay.ts).

import type { JobSummary } from "../api.ts";
import { Icon } from "../components/Icon.tsx";
import { badges, job as copy, types } from "../content.ts";
import { CHEVRON } from "../icons.ts";
import { clockShort, where } from "../lib/when.ts";
import { go } from "../route.ts";
import styles from "./today.module.css";

export function JobRow({ job, client }: { job: JobSummary; client: string | undefined }) {
  const path = `/jobs/${job.id}`;
  return (
    <a
      className={styles.row}
      href={path}
      onClick={(event) => {
        event.preventDefault();
        go(path);
      }}
    >
      <span className={styles.when}>
        <span className={styles.time}>{clockShort(job.starts_at)}</span>
      </span>
      <span className={styles.what}>
        <span className={styles.kind}>
          <span className={styles.type}>{job.type === null ? copy.locked.title : types[job.type]}</span>
          <span className={styles.badge}>· {badges[job.badge]}</span>
        </span>
        {client !== undefined && <span className={styles.who}>{client}</span>}
        <span className={styles.where}>{where(job.sector)}</span>
      </span>
      <Icon className={styles.chevron} d={CHEVRON} size={19} />
    </a>
  );
}
