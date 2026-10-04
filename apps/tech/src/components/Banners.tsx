// The three things a technician must know whatever screen he is on: that the
// phone has no signal (board A2's banner), that it has no room left for what he
// does, and that a job's work stopped reaching us — ops moved the job under the
// phone, or the API refused a step — which until now only the waiting screen said.

import { ICONS_P2 } from "@maneman/brand/icons";
import { buttonLook } from "@maneman/ui/Button";
import { Icon } from "@maneman/ui/Icon";
import { Link } from "@maneman/ui/router";
import { useEffect, useState } from "react";
import { changed as copy, storage, today as todayCopy, whatStopped } from "../content.ts";
import { STROKE } from "../icons.ts";
import { jobLabel } from "../lib/kind.ts";
import { useHeldJobs } from "../lib/useDay.ts";
import { useOutbox } from "../lib/useOutbox.ts";
import { isStorageFull, onStorageFull } from "../store/db.ts";
import type { HeldJob } from "../store/jobs.ts";
import { account, type JobAccount } from "../store/outbox.ts";
import styles from "./banner.module.css";

/** While the phone has just refused a write for want of room (../store/db.ts), above whichever screen is showing. */
export function StorageFull() {
  const [full, setFull] = useState(isStorageFull);
  useEffect(() => onStorageFull(setFull), []);
  if (!full) return null;
  return (
    <div className={styles.full} role="alert">
      <p className={styles.fullTitle}>{storage.title}</p>
      <p className={styles.fullBody}>{storage.body}</p>
    </div>
  );
}

/** Board A2's banner: a paper strip with the line, and the explanation beneath it on ink. */
export function Offline() {
  return (
    <div className={styles.offline} role="status">
      <p className={styles.offlineTitle}>
        <Icon d={ICONS_P2.offline} size={20} stroke={STROKE} />
        {todayCopy.offline.title}
      </p>
      <p className={styles.offlineBody}>{todayCopy.offline.body}</p>
    </div>
  );
}

type StoppedJob = NonNullable<JobAccount["stopped"]>;

/** "4 pm consultation · Gurgaon: Ops moved this job to 9 am tomorrow.", from what the phone holds of the job. */
function stoppedLine(stopped: StoppedJob, held: HeldJob | undefined): string {
  const what = whatStopped(stopped, new Date(), held?.starts_at ?? null);
  return copy.line(jobLabel(held, stopped.startsAt), what);
}

/** Each job whose queue has stopped, by its time, kind and area, with what stopped it. */
export function Stopped() {
  const waiting = useOutbox();
  const held = useHeldJobs(waiting);
  const stopped = account(waiting.events).flatMap((line) =>
    line.stopped === null ? [] : [{ ...line.stopped, job: line.job_id }],
  );
  if (stopped.length === 0) return null;

  return (
    <div className={styles.stopped} role="alert">
      {stopped.map((each) => (
        <p className={styles.stoppedLine} key={each.job}>
          {stoppedLine(each, held.get(each.job))}
        </p>
      ))}
      <Link to="/waiting" className={buttonLook({ variant: "outlineOnInk", size: "small", className: styles.open })}>
        {copy.open}
      </Link>
    </div>
  );
}
