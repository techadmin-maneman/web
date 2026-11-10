// Checking in at the door (docs/decisions/0243-job-and-the-door.md): the phone's position, measured by the API
// against the address (src/policy/check-in.ts), from the job's opening time. A check-in that passes, or one waiting for
// signal, goes on to At the door; one measured too far stays on the job, saying how far.

import { ProblemCard } from "@maneman/ui/ProblemCard";
import { useAsync, valueOr } from "@maneman/ui/useAsync";
import { useOneAtATime } from "@maneman/ui/useOneAtATime";
import { apiNow } from "@maneman/web-kit/clock";
import { useCallback, useEffect, useState } from "react";
import type { Job } from "../api.ts";
import { notHome as copy } from "../content.ts";
import { ReachOps } from "../frame/ReachOps.tsx";
import { buzz } from "../lib/haptics.ts";
import { checkedIn } from "../lib/progress.ts";
import { clock, metres } from "../lib/when.ts";
import { go } from "../route.ts";
import { keptArrival } from "../store/jobs.ts";
import { checkInRefusedAsEarly, queue, replay, type Queued } from "../store/outbox.ts";
import styles from "./check-in.module.css";

/** The phone's own fix, which the API measures against the address. */
function position(): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: true,
      timeout: 15_000,
      maximumAge: 0,
    });
  });
}

/** Whether the API's clock is still before `at`; the screen is drawn again the moment it is not. */
export function useBefore(at: number): boolean {
  const [before, setBefore] = useState(() => apiNow() < at);
  useEffect(() => {
    const left = at - apiNow();
    setBefore(left > 0);
    if (left <= 0) return;
    const opens = setTimeout(() => {
      setBefore(false);
    }, left);
    return () => {
      clearTimeout(opens);
    };
  }, [at]);
  return before;
}

export interface CheckIn {
  /** At the door: the card says so, or the phone's own answer does until it catches up. */
  readonly here: boolean;
  /** Whether the phone's own answer has been read yet: until it has, `here` may still turn true. */
  readonly known: boolean;
  /** Measured too far, or not measured at all. */
  readonly failed: { readonly distance: number | null } | null;
  readonly busy: boolean;
  /** Before the job's opening time, when the API would refuse one. */
  readonly notYet: boolean;
  /** The line above Check in: when it opens, a position the phone would not give, or how near it must be made. */
  readonly helper: string;
  readonly arrive: () => void;
}

export function useCheckIn(job: Job, queued: readonly Queued[]): CheckIn {
  const [noPosition, setNoPosition] = useState(false);
  const [busy, once] = useOneAtATime();
  const readArrival = useCallback(() => keptArrival(job.id), [job.id]);
  const [read] = useAsync(readArrival, queued);
  const arrival = valueOr(read, null);
  const here = checkedIn(job, queued) || arrival?.passed === true;
  const failed = !here && arrival?.passed === false ? { distance: arrival.distance_m } : null;
  const notYet = useBefore(Date.parse(job.checkin_from));

  const arrive = () =>
    void once(async () => {
      setNoPosition(false);
      let fix: GeolocationPosition;
      try {
        fix = await position();
      } catch {
        setNoPosition(true);
        return;
      }
      const at = new Date(apiNow()).toISOString();
      const body = { lat: fix.coords.latitude, lng: fix.coords.longitude, accuracy_m: fix.coords.accuracy, at };
      buzz();
      await queue("check_in", job.id, body, job.starts_at);
      await replay();
      // Measured too far stays here to say so; passed, or waiting for signal, is at the door.
      if ((await keptArrival(job.id))?.passed !== false) go(`/jobs/${job.id}/door`);
    });

  const opens = notYet || checkInRefusedAsEarly(queued, job.id);
  const known = read.state !== "pending";
  return { here, known, failed, busy, notYet, helper: helperOf(job, { noPosition, opens }), arrive };
}

/** The line above Check in: a position the phone would not give, when it opens, or how near it must be made. */
function helperOf(job: Job, state: { readonly noPosition: boolean; readonly opens: boolean }): string {
  if (state.noPosition) return copy.arrived.noPosition;
  if (state.opens) return copy.arrived.opensAt(clock(job.checkin_from));
  if (job.address?.lat === null) return copy.arrived.noPin;
  return copy.arrived.body(job.checkin_radius_m);
}

/** A check-in the API measured too far from the door, or could not measure, and what to do. */
export function CheckInFailed({ distance }: { distance: number | null }) {
  return (
    <div className={styles.failed}>
      <ProblemCard title={copy.failed.title} live>
        {distance === null ? copy.failed.unmeasured : copy.failed.away(metres(distance))} {copy.failed.body}
      </ProblemCard>
      <ReachOps className={styles.reach} onPaper />
    </div>
  );
}
