// The evidence chain, beneath the job's card.
//
//   1 · Arrived       the phone's position, checked against the address, from the earliest check-in
//   Check-in failed   how far away it was, and no way to close a no-show from there
//   2 · Waiting       what is left of the wait, from the booked start at the earliest, and Close as no-show,
//                     dim until it runs out
//   Client's here     the timer stops and the job starts
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

import { capsLook } from "@maneman/ui/Caps";
import { Button } from "@maneman/ui/Button";
import { Icon } from "@maneman/ui/Icon";
import { useAsync, valueOr } from "@maneman/ui/useAsync";
import { useOneAtATime } from "@maneman/ui/useOneAtATime";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import type { Job } from "../api.ts";
import { ConfirmSheet } from "@maneman/ui/ConfirmSheet";
import { notHome as copy, job as jobCopy } from "../content.ts";
import { STROKE } from "../icons.ts";
import { checkedIn, theWait } from "../lib/progress.ts";
import { clock, countdown, metres } from "../lib/when.ts";
import { go, stepPath } from "../route.ts";
import { keepClosed, keptArrival } from "../store/jobs.ts";
import { checkInRefusedAsEarly, events, queue, refusedAsEarly, replay, type Queued } from "../store/outbox.ts";
import { CardFrame } from "./CardFrame.tsx";
import { receiptLine, type ReceiptLine } from "./receipt.ts";
import frame from "../components/frame.module.css";
import styles from "./job.module.css";
import { firstNameOf } from "@rules/lib/names.ts";
import { apiNow } from "@maneman/web-kit/clock";

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
  const [now, setNow] = useState(apiNow);
  useEffect(() => {
    if (!running) return;
    const tick = setInterval(() => {
      setNow(apiNow());
    }, 1000);
    return () => {
      clearInterval(tick);
    };
  }, [running]);
  return now;
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

function evidenceOf(job: Job): ReceiptLine {
  const who = job.client === null ? copy.waiting.theClient : firstNameOf(job.client.name);
  return receiptLine(job.reminder, who);
}

export function NotHome({ job, queued, card }: { job: Job; queued: readonly Queued[]; card: ReactNode }) {
  const [noPosition, setNoPosition] = useState(false);
  const [asking, once] = useOneAtATime();
  const [confirming, setConfirming] = useState(false);

  const readArrival = useCallback(() => keptArrival(job.id), [job.id]);
  const arrival = valueOr(useAsync(readArrival, queued)[0], null);

  // The card says so once it has caught up; until then the phone's own answer does.
  const here = checkedIn(job, queued) || arrival?.passed === true;
  const failed = !here && arrival?.passed === false;

  // Before the earliest check-in the API would refuse one, so the phone does not offer it.
  const notYet = useBefore(Date.parse(job.checkin_from));
  const saysWhenItOpens = notYet || checkInRefusedAsEarly(queued, job.id);

  const wait = theWait(job, queued, arrival);
  const now = useNow(here && wait.endsAt !== null);
  const left = wait.endsAt === null ? 0 : wait.endsAt - now;
  const mayClose = wait.confirmed && wait.endsAt !== null && left <= 0;
  const receipt = evidenceOf(job);
  const waitBegun = wait.endsAt === null || wait.endsAt - job.no_show_wait_min * 60_000 <= now;

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
      const at = new Date(apiNow()).toISOString();
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
      if (refusedAsEarly(await events(), job.id)) return;
      await keepClosed(job.id);
      go(`/jobs/${job.id}/done`);
    });

  // The stage's one action: Start job once they are at the door, I have arrived before, none while a check-in has failed.
  const door = here ? (
    <DoorButton busy={asking} onTap={() => void start()}>
      {jobCopy.start}
    </DoorButton>
  ) : (
    <DoorButton busy={asking} disabled={notYet} onTap={() => void arrive()}>
      {copy.arrived.action}
    </DoorButton>
  );

  return (
    <CardFrame job={job} foot={failed ? null : door}>
      {card}
      {!here && !failed && <Arriving job={job} opensAt={saysWhenItOpens} noPosition={noPosition} />}
      {failed && (
        <CheckInFailed
          distance={arrival.distance_m}
          noPosition={noPosition}
          busy={asking}
          onAgain={() => void arrive()}
        />
      )}
      {here && (
        <Waiting
          left={wait.endsAt === null ? null : left}
          line={waitLine(job, { begun: waitBegun, confirmed: wait.confirmed, over: mayClose })}
          receipt={receipt}
          early={refusedAsEarly(queued, job.id)}
          mayClose={mayClose && !asking}
          onClose={() => {
            setConfirming(true);
          }}
        />
      )}
      {here && <Appears job={job} />}

      {confirming && (
        <ConfirmSheet
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

/** The door's one action, gold at the foot of the card. */
function DoorButton(props: { busy: boolean; disabled?: boolean; onTap: () => void; children: ReactNode }) {
  return (
    <Button
      variant="gold"
      size="action"
      className={frame.action}
      disabled={props.busy || props.disabled === true}
      busy={props.busy}
      onClick={props.onTap}
    >
      {props.children}
    </Button>
  );
}

/** Before the check-in: how close it must be made, when it opens if not yet, and a position the phone would not give. */
function Arriving({ job, opensAt, noPosition }: { job: Job; opensAt: boolean; noPosition: boolean }) {
  return (
    <section className={styles.stage}>
      <p className={capsLook(styles.stageLabel)}>{copy.arrived.step}</p>
      <p className={styles.stageBody}>{copy.arrived.body(job.checkin_radius_m)}</p>
      {opensAt && (
        <p className={styles.stageOpens} role="status">
          {copy.arrived.opensAt(clock(job.checkin_from))}
        </p>
      )}
      {noPosition && (
        <p className={styles.stageWarn} role="alert">
          {copy.arrived.noPosition}
        </p>
      )}
    </section>
  );
}

/** A check-in the API measured too far from the door, and the way to try again. */
function CheckInFailed(props: { distance: number | null; noPosition: boolean; busy: boolean; onAgain: () => void }) {
  return (
    <section className={styles.failed} role="alert">
      <p className={capsLook(styles.failedLabel)}>{copy.failed.title}</p>
      <p className={styles.failedLine}>
        {props.distance === null ? copy.failed.unmeasured : copy.failed.away(metres(props.distance))}
      </p>
      <p className={styles.stageNote}>{copy.failed.body}</p>
      {props.noPosition && <p className={styles.stageWarn}>{copy.arrived.noPosition}</p>}
      <Button
        variant="outlineOnInk"
        size="control"
        className={styles.second}
        disabled={props.busy}
        busy={props.busy}
        onClick={props.onAgain}
      >
        {copy.failed.action}
      </Button>
    </section>
  );
}

/** The no-show wait: what is left of it, the reminder's receipt as evidence, and the close once it has run. */
function Waiting(props: {
  left: number | null;
  line: string;
  receipt: ReceiptLine;
  early: boolean;
  mayClose: boolean;
  onClose: () => void;
}) {
  return (
    <section className={styles.stage}>
      <p className={capsLook(styles.stageLabel)}>{copy.waiting.step}</p>
      {props.left !== null && <p className={styles.timer}>{countdown(props.left)}</p>}
      <p className={styles.stageNote} role="status">
        {props.line}
      </p>
      <p className={styles.evidence}>
        <Icon className={styles.evidenceIcon} d={props.receipt.icon} size={20} stroke={STROKE} />
        <span>{props.receipt.text}</span>
      </p>
      {props.early && (
        <p className={styles.stageWarn} role="alert">
          {copy.waiting.early}
        </p>
      )}
      <Button
        variant="outlineOnInk"
        size="action"
        className={styles.outline}
        disabled={!props.mayClose}
        onClick={props.onClose}
      >
        {copy.waiting.close}
      </Button>
    </section>
  );
}

/** The client came to the door after all: the job starts as any other. */
function Appears({ job }: { job: Job }) {
  return (
    <section className={styles.stage}>
      <p className={capsLook(styles.stageLabel)}>{copy.appears.title}</p>
      {job.client !== null && (
        <p className={styles.failedLine}>{copy.appears.atTheDoor(firstNameOf(job.client.name))}</p>
      )}
      <p className={styles.stageNote}>{copy.appears.body}</p>
    </section>
  );
}

/** What the wait says beneath the timer: when it starts, how long it runs, that it is over, or that it waits for signal. */
function waitLine(job: Job, wait: { begun: boolean; confirmed: boolean; over: boolean }): string {
  if (!wait.begun) return copy.waiting.fromStart(clock(job.starts_at));
  if (!wait.confirmed) return copy.waiting.fromTap;
  return wait.over ? copy.waiting.over : copy.waiting.left(job.no_show_wait_min);
}
