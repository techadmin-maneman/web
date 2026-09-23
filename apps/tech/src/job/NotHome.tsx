// Board B5: the evidence chain, beneath the job's card.
//
//   1 · Arrived   the phone's position, checked against the address
//   Check-in failed   how far away it was, and no way to close a no-show from there
//   2 · Waiting   what is left of the wait, and Close as no-show, dim until it runs out
//   He appears    the timer stops and the job starts
//
// The check-in goes through the outbox like every other write, so an arrival in
// a basement is not lost; the API's answer — passed, the distance, and when the
// wait ends — is kept beside the job and shown here (apps/tech/src/store/jobs.ts).

import { useCallback, useEffect, useState } from "react";
import type { CheckIn, Job } from "../api.ts";
import { notHome as copy, job as jobCopy } from "../content.ts";
import { Icon } from "../components/Icon.tsx";
import { TICK } from "../icons.ts";
import { checkedIn } from "../lib/progress.ts";
import { countdown, metres } from "../lib/when.ts";
import { keepClosed, keptArrival } from "../store/jobs.ts";
import { queue, replay, type Queued } from "../store/outbox.ts";
import { go, stepPath } from "../route.ts";
import styles from "./job.module.css";

/** The phone's own fix, which the API measures against the address (src/policy/check-in.ts). */
function position(): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: true,
      timeout: 15_000,
      maximumAge: 0,
    });
  });
}

/** The countdown, once a second, as the board's "no pulse" asks: whole seconds, nothing else moving. */
function useNow(running: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!running) return;
    const tick = setInterval(() => {
      setNow(Date.now());
    }, 1000);
    return () => {
      clearInterval(tick);
    };
  }, [running]);
  return now;
}

export function NotHome({ job, queued }: { job: Job; queued: readonly Queued[] }) {
  const [arrival, setArrival] = useState<CheckIn | null>(null);
  const [noPosition, setNoPosition] = useState(false);
  const [asking, setAsking] = useState(false);
  const here = checkedIn(job, queued);

  useEffect(() => {
    let current = true;
    void keptArrival(job.id).then((kept) => {
      if (current) setArrival(kept);
    });
    return () => {
      current = false;
    };
  }, [job.id, queued]);

  const arrive = useCallback(async () => {
    setAsking(true);
    setNoPosition(false);
    let fix: GeolocationPosition;
    try {
      fix = await position();
    } catch {
      setAsking(false);
      setNoPosition(true);
      return;
    }
    await queue("check_in", job.id, {
      lat: fix.coords.latitude,
      lng: fix.coords.longitude,
      accuracy_m: fix.coords.accuracy,
      at: new Date().toISOString(),
    });
    await replay();
    setAsking(false);
  }, [job.id]);

  const start = useCallback(async () => {
    await queue("start", job.id, null);
    void replay();
    go(stepPath(job.id, "before_photos"));
  }, [job.id]);

  const close = useCallback(async () => {
    await queue("no_show", job.id, null);
    await keepClosed(job.id);
    void replay();
    go(`/jobs/${job.id}/done`);
  }, [job.id]);

  const waitEndsAt = arrival?.wait_ends_at ?? null;
  const now = useNow(here && waitEndsAt !== null);
  const left = waitEndsAt === null ? 0 : new Date(waitEndsAt).getTime() - now;
  const waitMinutes =
    arrival === null || waitEndsAt === null
      ? 0
      : Math.round((new Date(waitEndsAt).getTime() - new Date(arrival.checked_in_at).getTime()) / 60_000);
  const mayClose = here && waitEndsAt !== null && left <= 0;

  // Sent, and the API has not answered yet: the arrival is on the phone either way.
  const unanswered = here && arrival === null;

  return (
    <>
      {!here && (
        <section className={styles.stage}>
          <p className={styles.stageLabel}>{copy.arrived.step}</p>
          <p className={styles.stageBody}>{copy.arrived.body}</p>
          {noPosition && (
            <p className={styles.stageWarn} role="alert">
              {copy.arrived.noPosition}
            </p>
          )}
          <button className={styles.action} type="button" disabled={asking} onClick={() => void arrive()}>
            {copy.arrived.action}
          </button>
        </section>
      )}

      {arrival !== null && !arrival.passed && (
        <section className={styles.failed} role="alert">
          <p className={styles.failedLabel}>{copy.failed.title}</p>
          <p className={styles.failedLine}>
            {arrival.distance_m === null ? copy.failed.unmeasured : copy.failed.away(metres(arrival.distance_m))}
          </p>
          <p className={styles.stageBody}>{copy.failed.body}</p>
          <button className={styles.second} type="button" disabled={asking} onClick={() => void arrive()}>
            {copy.failed.action}
          </button>
        </section>
      )}

      {here && (
        <section className={styles.stage}>
          <p className={styles.stageLabel}>{copy.waiting.step}</p>
          {unanswered ? (
            <p className={styles.stageBody}>{copy.arrived.queued}</p>
          ) : (
            <>
              <p className={styles.timer}>{countdown(left)}</p>
              <p className={styles.stageBody}>{copy.waiting.left(waitMinutes)}</p>
            </>
          )}
          <p className={styles.evidence}>
            <Icon className={styles.evidenceIcon} d={TICK} size={20} />
            <span>{copy.waiting.evidence}</span>
          </p>
          <button className={styles.dim} type="button" disabled={!mayClose} onClick={() => void close()}>
            {copy.waiting.close}
          </button>
        </section>
      )}

      {here && (
        <section className={styles.stage}>
          <p className={styles.stageLabel}>{copy.appears.title}</p>
          <p className={styles.stageBody}>{copy.appears.body}</p>
          <button className={styles.action} type="button" onClick={() => void start()}>
            {jobCopy.start}
          </button>
        </section>
      )}
    </>
  );
}
