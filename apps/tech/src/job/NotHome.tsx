// Board B5: the evidence chain, beneath the job's card.
//
//   1 · Arrived       the phone's position, checked against the address
//   Check-in failed   how far away it was, and no way to close a no-show from there
//   2 · Waiting       what is left of the wait, and Close as no-show, dim until it runs out
//   He appears        the timer stops and the job starts
//
// The stage's one action — I have arrived, then Start job — sits at the foot of
// the screen where every screen keeps it. Close as no-show is never gold and
// never beside it: it is outlined in the waiting stage, and it asks first,
// because it can bring the client a charge.
//
// The check-in goes through the outbox like every other write, so an arrival in
// a basement is not lost. The wait runs to the end the API gave — in the
// check-in's answer, kept beside the job (apps/tech/src/store/jobs.ts), or on
// the card, for a phone that lost its copy — and with no signal it counts from
// the tap. A no-show can close only once the API holds the check-in, since it
// runs the wait on its own clock too (ADR 0065).

import { Button } from "@maneman/ui/Button";
import { useOneAtATime } from "@maneman/ui/useOneAtATime";
import { useEffect, useState, type ReactNode } from "react";
import type { CheckIn, Job } from "../api.ts";
import { Confirm } from "../components/Confirm.tsx";
import { Icon } from "../components/Icon.tsx";
import { notHome as copy, job as jobCopy } from "../content.ts";
import { TICK } from "../icons.ts";
import { checkedIn, theWait } from "../lib/progress.ts";
import { clock, countdown, metres } from "../lib/when.ts";
import { go, stepPath } from "../route.ts";
import { keepClosed, keptArrival } from "../store/jobs.ts";
import { queue, refusedAsEarly, replay, type Queued } from "../store/outbox.ts";
import { CardFrame } from "./CardFrame.tsx";
import { firstName } from "./JobCard.tsx";
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

/** Board B5's receipt: whether the day-before WhatsApp reached the client, or ops' three facts when none was sent. */
function evidenceOf(job: Job): string {
  const who = job.client === null ? "" : firstName(job.client.name);
  if (job.reminder === null) return copy.waiting.evidence;
  const delivered = job.reminder.delivered_at;
  return delivered === null ? copy.waiting.notDelivered(who) : copy.waiting.delivered(who, clock(delivered));
}

export function NotHome({ job, queued, card }: { job: Job; queued: readonly Queued[]; card: ReactNode }) {
  const [arrival, setArrival] = useState<CheckIn | null>(null);
  const [noPosition, setNoPosition] = useState(false);
  const [asking, once] = useOneAtATime();
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    let current = true;
    void keptArrival(job.id).then((kept) => {
      if (current) setArrival(kept);
    });
    return () => {
      current = false;
    };
  }, [job.id, queued]);

  // The card says so once it has caught up; until then the phone's own answer does.
  const here = checkedIn(job, queued) || arrival?.passed === true;
  const failed = !here && arrival?.passed === false;

  const wait = theWait(job, queued, arrival);
  const now = useNow(here && wait.endsAt !== null);
  const left = wait.endsAt === null ? 0 : wait.endsAt - now;
  const mayClose = wait.confirmed && wait.endsAt !== null && left <= 0;

  const arrive = () =>
    once(async () => {
      setNoPosition(false);
      let fix: GeolocationPosition;
      try {
        fix = await position();
      } catch {
        setNoPosition(true);
        return;
      }
      const at = new Date().toISOString();
      const body = { lat: fix.coords.latitude, lng: fix.coords.longitude, accuracy_m: fix.coords.accuracy, at };
      await queue("check_in", job.id, body, job.starts_at);
      await replay();
    });

  const start = () =>
    once(async () => {
      await queue("start", job.id, null, job.starts_at);
      void replay();
      go(stepPath(job.id, "before_photos"));
    });

  // The card stands aside for a close-out while the no-show is on its way, so
  // whether the API refused it as early is the outbox's to remember, not this screen's.
  const close = () =>
    once(async () => {
      setConfirming(false);
      await queue("no_show", job.id, null, job.starts_at);
      await replay();
      // The phone's clock ran ahead of ours: nothing was recorded, and the wait goes on.
      if (refusedAsEarly(job.id)) return;
      await keepClosed(job.id);
      go(`/jobs/${job.id}/done`);
    });

  /** The stage's one action: Start job once he is at the door, I have arrived before, none while a check-in has failed. */
  function doorAction(): ReactNode {
    if (here) {
      return (
        <Button
          variant="gold"
          size="action"
          className={styles.action}
          disabled={asking}
          busy={asking}
          onClick={() => void start()}
        >
          {jobCopy.start}
        </Button>
      );
    }
    if (failed) return null;
    return (
      <Button
        variant="gold"
        size="action"
        className={styles.action}
        disabled={asking}
        busy={asking}
        onClick={() => void arrive()}
      >
        {copy.arrived.action}
      </Button>
    );
  }

  return (
    <CardFrame job={job} foot={doorAction()}>
      {card}

      {!here && !failed && (
        <section className={styles.stage}>
          <p className={styles.stageLabel}>{copy.arrived.step}</p>
          <p className={styles.stageBody}>{copy.arrived.body}</p>
          {noPosition && (
            <p className={styles.stageWarn} role="alert">
              {copy.arrived.noPosition}
            </p>
          )}
        </section>
      )}

      {failed && (
        <section className={styles.failed} role="alert">
          <p className={styles.failedLabel}>{copy.failed.title}</p>
          <p className={styles.failedLine}>
            {arrival.distance_m === null ? copy.failed.unmeasured : copy.failed.away(metres(arrival.distance_m))}
          </p>
          <p className={styles.stageNote}>{copy.failed.body}</p>
          {noPosition && <p className={styles.stageWarn}>{copy.arrived.noPosition}</p>}
          <Button
            variant="outlineOnInk"
            size="control"
            className={styles.second}
            disabled={asking}
            busy={asking}
            onClick={() => void arrive()}
          >
            {copy.failed.action}
          </Button>
        </section>
      )}

      {here && (
        <section className={styles.stage}>
          <p className={styles.stageLabel}>{copy.waiting.step}</p>
          {wait.endsAt !== null && <p className={styles.timer}>{countdown(left)}</p>}
          <p className={styles.stageNote} role="status">
            {waitLine(wait.confirmed, mayClose, job.no_show_wait_min)}
          </p>
          <p className={styles.evidence}>
            <Icon className={styles.evidenceIcon} d={TICK} size={20} />
            <span>{evidenceOf(job)}</span>
          </p>
          {refusedAsEarly(job.id) && (
            <p className={styles.stageWarn} role="alert">
              {copy.waiting.early}
            </p>
          )}
          <Button
            variant="outlineOnInk"
            size="action"
            className={styles.outline}
            disabled={!mayClose || asking}
            onClick={() => {
              setConfirming(true);
            }}
          >
            {copy.waiting.close}
          </Button>
        </section>
      )}

      {here && (
        <section className={styles.stage}>
          <p className={styles.stageLabel}>{copy.appears.title}</p>
          {job.client !== null && (
            <p className={styles.failedLine}>{copy.appears.atTheDoor(firstName(job.client.name))}</p>
          )}
          <p className={styles.stageNote}>{copy.appears.body}</p>
        </section>
      )}

      {confirming && (
        <Confirm
          title={copy.confirm.title}
          body={copy.confirm.body}
          yes={copy.confirm.yes}
          no={copy.confirm.no}
          onYes={() => void close()}
          onNo={() => {
            setConfirming(false);
          }}
        />
      )}
    </CardFrame>
  );
}

/** What the wait says beneath the timer: how long it runs, that it is over, or that it waits for signal. */
function waitLine(confirmed: boolean, over: boolean, minutes: number): string {
  if (!confirmed) return copy.waiting.fromTap;
  return over ? copy.waiting.over : copy.waiting.left(minutes);
}
