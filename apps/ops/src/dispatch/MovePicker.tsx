// Board A2: the reason a move must carry, asked for before anything is
// written. The clash check runs on the server before any write to FSM
// (docs/decisions/0034-clash-check.md), so this panel sends nothing until a
// reason is chosen, and the server may still refuse what it sends.
//
// "The client's payment carries over and he is never charged for a move ops
// make, including inside 24 hours" (src/policy/dispatch.ts), so no amount is
// shown here, and within 24 hours the panel says so in the board's own words.
//
// The board's line promises a WhatsApp message. One goes only to a client who
// agreed to WhatsApp about his visits, so for any other the panel says to call
// him, with his number; and a change of technician alone, which leaves his
// window as it was, tells him nothing (docs/decisions/0069-dispatch-under-concurrency.md).

import { Dialog } from "@maneman/ui/Dialog";
import { VisuallyHidden } from "@maneman/ui/VisuallyHidden";
import { shortDate } from "@maneman/web-kit/dates";
import { useState } from "react";
import type { MoveReason } from "../api.ts";
import { dispatch } from "../content.ts";
import styles from "./dispatch.module.css";
import { phoneWords } from "../lib/phone.ts";
import { changesTime, nameOf, personOf, whenOf, type Job, type Target } from "./job.ts";

const A_DAY = 24 * 60 * 60 * 1000;

/** The visit is inside 24 hours, which the board answers with one more line. */
function isSoon(job: Job, now: Date): boolean {
  if (job.kind !== "block") return false;
  const starts = new Date(job.block.starts_at).getTime() - now.getTime();
  return starts < A_DAY;
}

/** What the client hears of this move, in the panel's words, and whether the button may promise a message. */
function noticeOf(job: Job, to: Target): { readonly line: string; readonly messaged: boolean } {
  const copy = dispatch.move;
  const person = personOf(job);
  if (!changesTime(job, to)) return { line: copy.sameTime(nameOf(job)), messaged: false };
  if (person === null) return { line: copy.noClient, messaged: false };
  if (person.whatsapp_visits) return { line: copy.note(nameOf(job)), messaged: true };
  return { line: copy.call(person.name, phoneWords(person.mobile)), messaged: false };
}

/** "Move and notify" only where a message will go. */
function sendLabel(sending: boolean, messaged: boolean): string {
  if (sending) return dispatch.move.sending;
  return messaged ? dispatch.move.send : dispatch.move.sendQuietly;
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
  const copy = dispatch.move;

  const was = whenOf(job);
  const lands = `${shortDate(to.date)}, ${dispatch.windows[to.window] ?? to.window}`;
  const stood =
    was.date === null || was.window === null
      ? null
      : `${shortDate(was.date)}, ${dispatch.windows[was.window] ?? was.window}`;
  const notice = noticeOf(job, to);

  return (
    <Dialog
      className={`${styles.panel} ${styles.picker}`}
      labelledBy="move-title"
      canClose={!sending}
      onDismiss={onCancel}
    >
      <h2 className={styles.pickerTitle} id="move-title">
        {copy.title(nameOf(job), to.technician.name)}
      </h2>
      <p className={styles.pickerWhen}>{stood === null ? copy.to(lands) : copy.fromTo(stood, lands)}</p>
      <fieldset className={styles.reasons} disabled={sending}>
        <VisuallyHidden as="legend">{copy.legend}</VisuallyHidden>
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
      <p className={styles.consequence}>{notice.line}</p>
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
          {sendLabel(sending, notice.messaged)}
        </button>
        <button className={styles.quiet} type="button" disabled={sending} onClick={onCancel}>
          {copy.cancel}
        </button>
      </div>
    </Dialog>
  );
}
