// One job on the day's list (board A1): time and length down the left, then the
// type, the badge, the client and the sector, and where the job stands once it
// has begun. No amount, anywhere. The client is named from the day before the
// visit, when the job unlocks.

import { capsLook } from "@maneman/ui/Caps";
import { GLYPHS } from "@maneman/brand/icons";
import { Icon } from "@maneman/ui/Icon";
import { Link } from "@maneman/ui/router";
import type { JobSummary } from "../api.ts";
import { badges, job as copy } from "../content.ts";
import { STROKE } from "../icons.ts";
import { kindName } from "../lib/kind.ts";
import { clock, where } from "../lib/when.ts";
import styles from "./today.module.css";

export function JobRow({
  job,
  client,
  state,
}: {
  job: JobSummary;
  client: string | undefined;
  /** "In progress" or "Closed out", or null for a job not begun. */
  state: string | null;
}) {
  return (
    <Link className={styles.row} to={`/jobs/${job.id}`}>
      <span className={styles.when}>
        <span className={styles.time}>{clock(job.starts_at)}</span>
        {job.minutes !== null && <span className={styles.length}>{copy.minutes(job.minutes)}</span>}
      </span>
      <span className={styles.what}>
        <span className={styles.kind}>
          <span className={capsLook(styles.type)}>{kindName(job)}</span>
          <span className={capsLook(styles.badge)}>· {badges[job.badge]}</span>
        </span>
        {client !== undefined && <span className={styles.who}>{client}</span>}
        <span className={styles.where}>{where(job.sector)}</span>
        {state !== null && <span className={styles.state}>{state}</span>}
      </span>
      <Icon className={styles.chevron} d={GLYPHS.chevron} size={19} stroke={STROKE} />
    </Link>
  );
}
