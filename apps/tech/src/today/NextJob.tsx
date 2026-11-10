// Today's next job (docs/prompts/tech-redesign.md, "Today"): where the technician is with it, or when to leave; its
// time and length, the client, the visit and how it is paid, where it is and the drive there; then Navigate, and
// Message and Call once the card the phone kept names the client.

import { GLYPHS } from "@maneman/brand/icons";
import { ButtonLink } from "@maneman/ui/Button";
import { Icon } from "@maneman/ui/Icon";
import { Link } from "@maneman/ui/router";
import { useAsync, valueOr } from "@maneman/ui/useAsync";
import { given } from "@maneman/web-kit/address";
import { whatsappChat } from "@maneman/web-kit/whatsapp";
import { firstNameOf } from "@rules/lib/names.ts";
import { useCallback } from "react";
import type { JobSummary } from "../api.ts";
import { badgesLower, job as jobCopy, today as copy } from "../content.ts";
import { kindName } from "../lib/kind.ts";
import { callLink, wayTo } from "../lib/navigate.ts";
import type { RowState } from "../lib/progress.ts";
import { apiDate, clock, runsOver } from "../lib/when.ts";
import { keptJob } from "../store/jobs.ts";
import styles from "./today.module.css";

const MINUTE_MS = 60_000;

/** How far ahead "leave in" counts in minutes; further off, the line says when. */
const LEAVE_IN_WITHIN = 90;

/** The line above the next job's time: at the door, under way, or when to leave for it. */
export function nextLine(job: Pick<JobSummary, "leave_by">, state: RowState | null, now: Date): string {
  if (state === "at_the_door") return copy.next.atTheDoor;
  if (state === "in_progress") return copy.next.inProgress;
  if (job.leave_by === null) return copy.next.next;
  const minutes = Math.ceil((Date.parse(job.leave_by) - now.getTime()) / MINUTE_MS);
  if (minutes <= 0) return copy.next.leaveNow;
  return minutes <= LEAVE_IN_WITHIN ? copy.next.leaveIn(minutes) : copy.next.leaveBy(clock(job.leave_by));
}

/** The place in a few words: the tower, the building or the street, and the locality. */
const placeOf = (address: NonNullable<JobSummary["address"]>): string =>
  [address.tower, address.building ?? address.line1, address.locality].filter(given).join(", ");

/** The client's mobile from the card the phone kept, for Message and Call; null until there is one. */
function useMobile(id: string, cards: number): string | null {
  const read = useCallback(async () => (await keptJob(id))?.client?.mobile ?? null, [id]);
  return valueOr(useAsync(read, cards)[0], null);
}

export function NextJob(props: {
  readonly job: JobSummary;
  readonly state: RowState | null;
  readonly client: string | undefined;
  /** The job still to do after it, which one under way may run into. */
  readonly after: JobSummary | undefined;
  /** How many times the cards have been kept since the screen opened, so the client's number is read again. */
  readonly cards: number;
}) {
  const { job, state, client } = props;
  const mobile = useMobile(job.id, props.cards);
  const first = client === undefined ? null : firstNameOf(client);
  const where = job.address === null ? job.sector : placeOf(job.address);
  const drive = job.drive_minutes === null ? null : copy.driveTo(job.drive_minutes);
  const { after } = props;
  const over =
    state === "in_progress" && job.next !== null && after !== undefined && runsOver(job, apiDate())
      ? copy.runsOver(clock(job.next.finish_by), clock(after.starts_at))
      : null;
  return (
    <section className={styles.next} aria-labelledby="today-next">
      <Link className={styles.nextLink} to={`/jobs/${job.id}`}>
        <span className={styles.nextLine} id="today-next">
          {nextLine(job, state, apiDate())}
        </span>
        <span className={styles.nextWhen}>
          <span className={styles.nextTime}>{clock(job.starts_at)}</span>
          {job.minutes !== null && <span className={styles.nextLength}>{jobCopy.minutes(job.minutes)}</span>}
        </span>
        <span className={styles.nextWho}>{client ?? kindName(job)}</span>
        <span className={styles.nextWhat}>{[kindName(job), badgesLower[job.badge]].join(" · ")}</span>
        {where !== null && <span className={styles.nextWhere}>{[where, drive].filter(given).join(" · ")}</span>}
      </Link>
      {over !== null && <p className={styles.nextOver}>{over}</p>}
      <div className={styles.nextActions}>
        {job.address !== null && (
          // A new tab, so a technician who has taken the route back still has the app open behind it.
          <ButtonLink
            variant="primary"
            size="action"
            className={styles.navigate}
            href={wayTo(job.address)}
            target="_blank"
            rel="noopener noreferrer"
          >
            <Icon d={GLYPHS.navigate} size="md" />
            <span>{jobCopy.navigate}</span>
          </ButtonLink>
        )}
        {mobile !== null && first !== null && (
          <>
            <ButtonLink
              variant="outline"
              size="action"
              className={styles.square}
              href={whatsappChat(mobile)}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={copy.message(first)}
            >
              <Icon d={GLYPHS.bubble} size="md" />
            </ButtonLink>
            <ButtonLink
              variant="outline"
              size="action"
              className={styles.square}
              href={callLink(mobile)}
              aria-label={copy.call(first)}
            >
              <Icon d={GLYPHS.phone} size="md" />
            </ButtonLink>
          </>
        )}
      </div>
    </section>
  );
}
