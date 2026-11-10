// The rest of Today (docs/prompts/tech-redesign.md, "Today"): a row for each job but the next, its time and length,
// the client, the visit, the area and how it is paid, and the drive with when to leave; a job done with ruled in the
// ink and quieter, with how it closed; then tomorrow, which opens the Schedule.

import { GLYPHS } from "@maneman/brand/icons";
import { Icon } from "@maneman/ui/Icon";
import { ListRow, ListRows } from "@maneman/ui/ListRow";
import { Link } from "@maneman/ui/router";
import { SectionHead } from "@maneman/ui/SectionHead";
import type { JobSummary } from "../api.ts";
import { badgesLower, job as jobCopy, today as copy } from "../content.ts";
import { kindName } from "../lib/kind.ts";
import { outcomeOf, type RowState } from "../lib/progress.ts";
import type { Queued } from "../store/outbox.ts";
import { apiDate, clock, runsOver } from "../lib/when.ts";
import styles from "./today.module.css";

/** How a job done with closed, in a word: as it landed, or as the phone has it on its way. */
function closedAs(job: JobSummary, queued: readonly Queued[]): string {
  const outcome = outcomeOf(job, queued);
  if (outcome === null) return job.status === "completed" ? copy.closed.done : copy.closed.other;
  return copy.closed[outcome];
}

/**
 * The row's third line: how it closed, that it runs into the next job, where the technician is with it, or the drive
 * and when to leave.
 */
function lastLine(job: JobSummary, state: RowState | null, ahead: Ahead): string | null {
  if (state === "closed") return closedAs(job, ahead.queued);
  if (state === "in_progress" && job.next !== null && ahead.later !== undefined && runsOver(job, apiDate())) {
    return copy.runsOver(clock(job.next.finish_by), clock(ahead.later.starts_at));
  }
  if (state === "in_progress") return copy.next.inProgress;
  if (state === "at_the_door") return copy.next.atTheDoor;
  if (job.drive_minutes === null || job.leave_by === null) return null;
  return copy.driveAndLeave(job.drive_minutes, clock(job.leave_by));
}

/** What a row's last line reads beyond the job: the next job still to do, and the phone's writes on their way. */
interface Ahead {
  readonly later: JobSummary | undefined;
  readonly queued: readonly Queued[];
}

function Row(props: {
  readonly job: JobSummary;
  readonly state: RowState | null;
  readonly client: string | undefined;
  readonly ahead: Ahead;
}) {
  const { job, state } = props;
  const closed = state === "closed";
  const what = [kindName(job), job.sector, badgesLower[job.badge]].filter((part) => part !== null).join(" · ");
  const last = lastLine(job, state, props.ahead);
  return (
    <ListRow
      to={`/jobs/${job.id}`}
      rule={closed ? "done" : undefined}
      lead={
        <span className={closed ? styles.quiet : undefined}>
          <span className={styles.rowTime}>{clock(job.starts_at)}</span>
          {job.minutes !== null && <span className={styles.rowLength}>{jobCopy.minutes(job.minutes)}</span>}
        </span>
      }
      title={<span className={closed ? styles.quiet : undefined}>{props.client ?? kindName(job)}</span>}
      meta={
        <>
          <span className={styles.rowLine}>{what}</span>
          {last !== null && <span className={closed ? styles.rowClosed : styles.rowLine}>{last}</span>}
        </>
      }
      end={<Icon className={styles.chevron} d={GLYPHS.chevron} size="sm" />}
    />
  );
}

export function LaterToday(props: {
  readonly jobs: readonly JobSummary[];
  readonly states: ReadonlyMap<string, RowState | null>;
  readonly names: ReadonlyMap<string, string>;
  readonly queued: readonly Queued[];
}) {
  const { jobs, states } = props;
  return (
    <section className={styles.later} aria-labelledby="today-later">
      <SectionHead
        title={copy.later}
        size="list"
        id="today-later"
        end={
          <Link className={styles.dayView} to="/week">
            {copy.dayView}
          </Link>
        }
      />
      {jobs.length === 0 ? (
        <p className={styles.none}>{copy.noMore}</p>
      ) : (
        <ListRows className={styles.rows}>
          {jobs.map((job, index) => (
            <Row
              key={job.id}
              job={job}
              state={states.get(job.id) ?? null}
              client={job.client_name ?? props.names.get(job.id)}
              ahead={{
                later: jobs.slice(index + 1).find((after) => states.get(after.id) !== "closed"),
                queued: props.queued,
              }}
            />
          ))}
        </ListRows>
      )}
    </section>
  );
}

/** Tomorrow's jobs in a line: how many and from when, which opens the Schedule; or that nothing is booked. */
export function Tomorrow({ jobs, loaded }: { readonly jobs: readonly JobSummary[]; readonly loaded: boolean }) {
  if (!loaded) return null;
  const [first] = jobs;
  return (
    <Link className={styles.tomorrow} to="/week">
      <span>
        <strong>{copy.tomorrow}</strong>
        {" · "}
        {first === undefined ? copy.nothingBooked : copy.tomorrowJobs(jobs.length, clock(first.starts_at))}
      </span>
      <Icon className={styles.chevron} d={GLYPHS.chevron} size="sm" />
    </Link>
  );
}
