// Board A2: the reason a move must carry, asked for before anything is
// written. The clash check runs on the server before any write to FSM
// (docs/decisions/0034-clash-check.md), so this panel sends nothing until a
// reason is chosen, and the server may still refuse what it sends.
//
// "The client's payment carries over and he is never charged for a move ops
// make, including inside 24 hours" (src/policy/dispatch.ts), so no amount is
// shown here, and within 24 hours the panel says so in the board's own words.

import { shortDate } from "@maneman/web-kit/dates";
import { useEffect, useRef, useState } from "react";
import type { MoveReason } from "../api.ts";
import { dispatch } from "../content.ts";
import styles from "./dispatch.module.css";
import { clientOf, nameOf, whenOf, type Job, type Target } from "./job.ts";

const A_DAY = 24 * 60 * 60 * 1000;

/** The visit is inside 24 hours, which the board answers with one more line. */
function isSoon(job: Job, now: Date): boolean {
  if (job.kind !== "block") return false;
  const starts = new Date(job.block.starts_at).getTime() - now.getTime();
  return starts < A_DAY;
}

interface Props {
  readonly job: Job;
  readonly to: Target;
  readonly sending: boolean;
  readonly onSend: (reason: MoveReason) => void;
  readonly onCancel: () => void;
}

export function MovePicker({ job, to, sending, onSend, onCancel }: Props) {
  const [reason, setReason] = useState<MoveReason | null>(null);
  const panel = useRef<HTMLDivElement>(null);
  const copy = dispatch.move;

  useEffect(() => {
    panel.current?.focus();
  }, []);

  const was = whenOf(job);
  const lands = `${shortDate(to.date)}, ${dispatch.windows[to.window] ?? to.window}`;
  const stood =
    was.date === null || was.window === null
      ? null
      : `${shortDate(was.date)}, ${dispatch.windows[was.window] ?? was.window}`;

  return (
    <div
      className={`${styles.panel} ${styles.picker}`}
      ref={panel}
      role="dialog"
      aria-modal="true"
      aria-labelledby="move-title"
      tabIndex={-1}
    >
      <h2 className={styles.pickerTitle} id="move-title">
        {copy.title(nameOf(job), to.technician.name)}
      </h2>
      <p className={styles.pickerWhen}>{stood === null ? copy.to(lands) : copy.fromTo(stood, lands)}</p>
      <fieldset className={styles.reasons}>
        <legend className={styles.hidden}>{copy.legend}</legend>
        {copy.reasons.map((each) => (
          <label className={styles.reason} key={each.reason}>
            <input
              className={styles.radio}
              type="radio"
              name="move-reason"
              value={each.reason}
              checked={reason === each.reason}
              onChange={() => {
                setReason(each.reason);
              }}
            />
            <span>{each.label}</span>
          </label>
        ))}
      </fieldset>
      <p className={styles.consequence}>{copy.note(clientOf(job))}</p>
      {isSoon(job, new Date()) && <p className={styles.consequence}>{copy.soon}</p>}
      <div className={styles.actions}>
        <button
          className={styles.send}
          type="button"
          disabled={reason === null || sending}
          onClick={() => {
            if (reason !== null) onSend(reason);
          }}
        >
          {sending ? copy.sending : copy.send}
        </button>
        <button className={styles.quiet} type="button" disabled={sending} onClick={onCancel}>
          {copy.cancel}
        </button>
      </div>
    </div>
  );
}
