// The two things a technician must know whatever screen he is on: that the
// phone has no signal (board A2's banner), and that a job's work stopped
// reaching us — ops moved the job under the phone, or the API refused a step —
// which until now only the waiting screen said.

import { ICONS_P2 } from "@maneman/brand/icons";
import { changed as copy, today as todayCopy, whatStopped } from "../content.ts";
import { useNames } from "../lib/useDay.ts";
import { useOutbox } from "../lib/useOutbox.ts";
import { go } from "../route.ts";
import { account } from "../store/outbox.ts";
import { Icon } from "./Icon.tsx";
import styles from "./banner.module.css";

/** Board A2's banner: a gold strip with the line, and the explanation beneath it on ink. */
export function Offline() {
  return (
    <div className={styles.offline} role="status">
      <p className={styles.offlineTitle}>
        <Icon d={ICONS_P2.offline} size={20} />
        {todayCopy.offline.title}
      </p>
      <p className={styles.offlineBody}>{todayCopy.offline.body}</p>
    </div>
  );
}

/** Each job whose queue has stopped, by its client, with what stopped it. */
export function Stopped() {
  const waiting = useOutbox();
  const names = useNames(waiting);
  const stopped = account(waiting.events).flatMap((line) =>
    line.stopped === null ? [] : [{ ...line.stopped, job: line.job_id }],
  );
  if (stopped.length === 0) return null;

  return (
    <div className={styles.stopped} role="alert">
      {stopped.map((each) => (
        <p className={styles.stoppedLine} key={each.job}>
          {copy.line(names.get(each.job) ?? each.job.slice(0, 8), whatStopped(each))}
        </p>
      ))}
      <a
        className={styles.open}
        href="/waiting"
        onClick={(event) => {
          event.preventDefault();
          go("/waiting");
        }}
      >
        {copy.open}
      </a>
    </div>
  );
}
