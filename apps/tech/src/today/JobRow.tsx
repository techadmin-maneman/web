// One job on the day's list (board A1): time and slots down the left, then the
// type, the badge, the client and the sector. No amount, anywhere.

import type { JobSummary } from "../api.ts";
import { Icon } from "../components/Icon.tsx";
import { badges, job as copy, types } from "../content.ts";
import { CHEVRON } from "../icons.ts";
import { clockShort, where } from "../lib/when.ts";
import { go } from "../route.ts";
import styles from "./today.module.css";

export function JobRow({ job }: { job: JobSummary }) {
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
        <span className={styles.slots}>{copy.slots(job.slots)}</span>
      </span>
      <span className={styles.what}>
        <span className={styles.kind}>
          <span className={styles.type}>{types[job.type]}</span>
          <span className={styles.badge}>· {badges[job.badge]}</span>
        </span>
        <span className={styles.who}>{job.client_name}</span>
        <span className={styles.where}>{where(job.sector, job.distance_km)}</span>
      </span>
      <Icon className={styles.chevron} d={CHEVRON} size={19} />
    </a>
  );
}
