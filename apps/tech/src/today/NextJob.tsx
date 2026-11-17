// Today's next job (docs/prompts/tech-redesign.md, "Today"): where the technician is with it, or when to leave; its
// time and length, the client, the visit and how it is paid, where it is and the drive there; then Navigate, and
// Message and Call once the card the phone kept names the client. Message opens the job's own sheet of words to send.

import { GLYPHS } from "@maneman/brand/icons";
import { Button, ButtonLink } from "@maneman/ui/Button";
import { Icon } from "@maneman/ui/Icon";
import { Link } from "@maneman/ui/router";
import { useAsync, valueOr } from "@maneman/ui/useAsync";
import { given } from "@maneman/web-kit/address";
import { firstNameOf } from "@rules/lib/names.ts";
import { useCallback, useState } from "react";
import type { Job, JobSummary } from "../api.ts";
import { badgesLower, job as jobCopy, today as copy } from "../content.ts";
import { MessageSheet, takesUpdates, type Sent } from "../job/index.ts";
import { kindName } from "../lib/kind.ts";
import { callLink, wayTo } from "../lib/navigate.ts";
import type { RowState } from "../lib/progress.ts";
import { clock, runsOver } from "../lib/when.ts";
import { nextLine } from "../lib/today.ts";
import { useMinute } from "../lib/useMinute.ts";
import { keptJob } from "../store/jobs.ts";
import styles from "./today.module.css";

/** The place in a few words: the tower, the building or the street, and the locality. */
const placeOf = (address: NonNullable<JobSummary["address"]>): string =>
  [address.tower, address.building ?? address.line1, address.locality].filter(given).join(", ");

/** The card the phone kept, for Message and Call; null until there is one. */
function useCard(id: string, cards: number): Job | null {
  const read = useCallback(async () => (await keptJob(id)) ?? null, [id]);
  return valueOr(useAsync(read, cards)[0], null);
}

/** Navigate, then Message and Call once the kept card names the client; Message opens the sheet of words to send. */
function NextActions(props: { readonly job: JobSummary; readonly first: string | null; readonly cards: number }) {
  const { job, first } = props;
  const card = useCard(job.id, props.cards);
  const mobile = card?.client?.mobile ?? null;
  const [messaging, setMessaging] = useState(false);
  const [sent, setSent] = useState<Sent>({});
  return (
    <>
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
            {card !== null && takesUpdates(card) && (
              <Button
                variant="outline"
                size="action"
                className={styles.square}
                aria-label={copy.message(first)}
                onClick={() => {
                  setMessaging(true);
                }}
              >
                <Icon d={GLYPHS.bubble} size="md" />
              </Button>
            )}
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
      {messaging && card !== null && first !== null && (
        <MessageSheet
          job={card}
          who={first}
          sent={sent}
          onSent={(preset, words) => {
            setSent((was) => ({ ...was, [preset]: { words, at: new Date().toISOString() } }));
            setMessaging(false);
          }}
          onClose={() => {
            setMessaging(false);
          }}
        />
      )}
    </>
  );
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
  const now = useMinute();
  const first = client === undefined ? null : firstNameOf(client);
  const where = job.address === null ? job.sector : placeOf(job.address);
  const drive = job.drive_minutes === null ? null : copy.driveTo(job.drive_minutes);
  const { after } = props;
  const over =
    state === "in_progress" && job.next !== null && after !== undefined && runsOver(job, now)
      ? copy.runsOver(clock(job.next.finish_by), clock(after.starts_at))
      : null;
  return (
    <section className={styles.next} aria-labelledby="today-next">
      <Link className={styles.nextLink} to={`/jobs/${job.id}`}>
        <span className={styles.nextLine} id="today-next">
          {nextLine(job, state, now)}
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
      <NextActions job={job} first={first} cards={props.cards} />
    </section>
  );
}
