// One job on the day's list: time and length down the left, then the
// type, the badge, the client and the sector, and where the job stands once it
// has begun. No amount, anywhere. The client is named from the day before the
// visit, when the job unlocks.

import { badgeLook, capsLook } from "@maneman/ui/Caps";
import { GLYPHS } from "@maneman/brand/icons";
import { Icon } from "@maneman/ui/Icon";
import { Link } from "@maneman/ui/router";
import { ButtonLink } from "@maneman/ui/Button";
import type { JobSummary } from "../api.ts";
import { badges, job as copy, today } from "../content.ts";
import { wayTo } from "../lib/navigate.ts";
import { kindName } from "../lib/kind.ts";
import { clock, where } from "../lib/when.ts";
import styles from "./today.module.css";

export function JobRow({
  job,
  client,
  state,
  closed = false,
}: {
  job: JobSummary;
  client: string | undefined;
  /** "In progress" or "Closed out", or null for a job not begun. */
  state: string | null;
  /** A job done with: drawn quieter, so the eye goes to what is left. */
  closed?: boolean;
}) {
  return (
    <Link className={closed ? styles.closedRow : styles.row} to={`/jobs/${job.id}`}>
      <span className={styles.when}>
        <span className={styles.time}>{clock(job.starts_at)}</span>
        {job.minutes !== null && <span className={styles.length}>{copy.minutes(job.minutes)}</span>}
      </span>
      <span className={styles.what}>
        <span className={styles.kind}>
          <span className={capsLook(styles.type)}>{kindName(job)}</span>
          {/* The badge sits beside the kind, or on a line of its own where the row is narrow: no dot to strand. */}
          <span className={badgeLook("muted", job.badge === "at_visit" ? styles.badgeLine : undefined)}>
            {badges[job.badge]}
          </span>
        </span>
        {client !== undefined && <span className={styles.who}>{client}</span>}
        <span className={styles.where}>{where(job.sector)}</span>
        {state !== null && <span className={styles.state}>{state}</span>}
      </span>
      <Icon className={styles.chevron} d={GLYPHS.chevron} size="sm" weight="heavy" />
    </Link>
  );
}

/**
 * Beneath a job on today's list: Navigate once its address unlocks, the drive to the next job, and, for a job under
 * way that runs into the next, when to be done by.
 */
export function JobFoot({ job, next, over }: { job: JobSummary; next: JobSummary | undefined; over: boolean }) {
  if (job.address === null && job.next === null) return null;
  return (
    <div className={styles.foot}>
      {job.address !== null && (
        // A new tab, so a technician who has taken the route back still has the app open behind it.
        <ButtonLink
          variant="outlineOnInk"
          size="small"
          className={styles.navigate}
          href={wayTo(job.address)}
          target="_blank"
          rel="noopener noreferrer"
        >
          <Icon d={GLYPHS.pin} size="sm" weight="heavy" />
          <span>{copy.navigate}</span>
        </ButtonLink>
      )}
      {job.next !== null && <span className={styles.drive}>{today.drive(job.next.drive_minutes)}</span>}
      {over && job.next !== null && next !== undefined && (
        <p className={styles.over}>{today.runsOver(clock(job.next.finish_by), clock(next.starts_at))}</p>
      )}
    </div>
  );
}
