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
function useBefore(at: number): boolean {
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
  /** What Check in waits on, above it: when it opens, or a position the phone would not give; null while nothing does. */
  readonly helper: string | null;
  readonly arrive: () => void;
}

/** What the check-in says failed: none once here, the fresh read's where it is fresh, else the last read whole. */
function failureOf(read: {
  here: boolean;
  fresh: boolean;
  tooFar: number | null | undefined;
  settled: CheckIn["failed"];
}): CheckIn["failed"] {
  if (read.here) return null;
  if (!read.fresh) return read.settled;
  return read.tooFar === undefined ? null : { distance: read.tooFar };
}

export function useCheckIn(job: Job, queued: readonly Queued[]): CheckIn {
  const [noPosition, setNoPosition] = useState(false);
  const [busy, once] = useOneAtATime();
  // Each read says which outbox it was made after: a failure kept before a retry landed is not the retry's answer.
  const readArrival = useCallback(
    async () => ({ arrival: await keptArrival(job.id), after: queued }),
    [job.id, queued],
  );
  const [read] = useAsync(readArrival, queued);
  const answer = valueOr(read, null);
  const arrival = answer?.arrival ?? null;
  const here = checkedIn(job, queued) || arrival?.passed === true;
  // While the outbox is read again, the last answer read whole stands, so a check-in measured too far never blinks back
  // to Check in; one read before a retry landed is not the retry's answer.
  const fresh = answer?.after === queued;
  const tooFar = arrival?.passed === false ? arrival.distance_m : undefined;
  const [settled, setSettled] = useState<CheckIn["failed"]>(null);
  useEffect(() => {
    if (fresh) setSettled(here || tooFar === undefined ? null : { distance: tooFar });
  }, [fresh, here, tooFar]);
  const failed = failureOf({ here, fresh, tooFar, settled });
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
      const kept = await keptArrival(job.id);
      if (kept?.passed === false) setSettled({ distance: kept.distance_m });
      else go(`/jobs/${job.id}/door`);
    });

  const opens = notYet || checkInRefusedAsEarly(queued, job.id);
  const known = read.state !== "pending";
  return { here, known, failed, busy, notYet, helper: helperOf(job, { noPosition, opens }), arrive };
}

/**
 * The line above Check in: a position the phone would not give, when it opens, or that the address has no pin; none
 * otherwise. How near it must be made is said once a check-in is refused for it (CheckInFailed).
 */
function helperOf(job: Job, state: { readonly noPosition: boolean; readonly opens: boolean }): string | null {
  if (state.noPosition) return copy.arrived.noPosition;
  if (state.opens) return copy.arrived.opensAt(clock(job.checkin_from));
  if (job.address?.lat === null) return copy.arrived.noPin;
  return null;
}

/** A check-in the API measured too far from the door, or could not measure, and what to do. */
export function CheckInFailed({ distance, radius }: { distance: number | null; radius: number | null }) {
  return (
    <div className={styles.failed}>
      <ProblemCard title={copy.failed.title} live>
        {distance === null ? copy.failed.unmeasured : copy.failed.away(metres(distance))} {copy.arrived.body(radius)}{" "}
        {copy.failed.body}
      </ProblemCard>
      <ReachOps className={styles.reach} onPaper />
    </div>
  );
}
