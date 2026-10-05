// Board A2: the reason a move must carry, asked for before anything is
// written. The clash check runs on the server before anything is written
// (docs/decisions/0034-clash-check.md), so this panel sends nothing until a
// reason is chosen, and the server may still refuse what it sends.
//
// "The client's payment carries over and he is never charged for a move ops
// make, including inside 24 hours" (src/policy/dispatch.ts), so no amount is
// shown here, and inside the notice the visit was sold under the panel says so
// in the board's own words, with that notice where the board writes 24 hours.
// "Their payment carries over" follows only a visit that was paid for, in
// money or credit: a free consultation, or one paid once the client is fitted,
// has nothing to carry.
//
// The board's line promises a WhatsApp message. One goes only to a client who
// agreed to WhatsApp about his visits, so for any other the panel says to call
// him, with his number; and a change of technician alone, which leaves his
// window as it was, tells him nothing (docs/decisions/0069-dispatch-under-concurrency.md).

import { classes } from "@maneman/ui/classes";
import { Button } from "@maneman/ui/Button";
import { Dialog } from "@maneman/ui/Dialog";
import { Field, TextArea } from "@maneman/ui/Field";
import { VisuallyHidden } from "@maneman/ui/VisuallyHidden";
import { indiaClock, shortDate } from "@maneman/web-kit/dates";
import { useState } from "react";
import type { MoveReason } from "../api.ts";
import { dispatch } from "../content.ts";
import styles from "./dispatch.module.css";
import { phoneWords } from "../lib/phone.ts";
import { changesTime, nameOf, personOf, startOf, whenOf, type Job, type Target, windowWord } from "./job.ts";

const AN_HOUR = 60 * 60 * 1000;

/** The longest blackout reason the server keeps. */
const REASON_MAX_CHARS = 300;

/** The notice the visit was sold under, in hours, when the visit is inside it: the board answers with one more line. */
function noticeInside(job: Job, now: Date): number | null {
  if (job.kind !== "block") return null;
  const starts = new Date(job.block.starts_at).getTime() - now.getTime();
  return starts < job.block.notice_hours * AN_HOUR ? job.block.notice_hours : null;
}

/** What the client hears of this move, in the panel's words, and whether the button may promise a message. */
function noticeOf(job: Job, to: Target, landsAt: string | null): { readonly line: string; readonly messaged: boolean } {
  const copy = dispatch.move;
  const person = personOf(job);
  if (!changesTime(job, to, landsAt)) return { line: copy.sameTime(nameOf(job)), messaged: false };
  const badge = job.kind === "block" ? job.block.badge : job.job.badge;
  const paid = badge === "prepaid" || badge === "credit";
  const withPayment = (line: string) => (paid ? `${line} ${copy.carries}` : line);
  if (person === null) return { line: withPayment(copy.noClient), messaged: false };
  if (person.whatsapp_visits) return { line: withPayment(copy.note(nameOf(job))), messaged: true };
  return { line: withPayment(copy.call(person.name, phoneWords(person.mobile))), messaged: false };
}

/** "Move and notify" only where a message will go. */
function sendLabel(sending: boolean, messaged: boolean): string {
  if (sending) return dispatch.move.sending;
  return messaged ? dispatch.move.send : dispatch.move.sendQuietly;
}

/** "Sat 20 Sep, 10:30 am" where the board knows the start the move takes; else "Sat 20 Sep, morning". */
function landsWords(to: Target, landsAt: string | null): string {
  if (landsAt !== null) return `${shortDate(to.date)}, ${indiaClock(landsAt)}`;
  return `${shortDate(to.date)}, ${windowWord(to.window)}`;
}

/** Where the job stands now, by its start: "Fri 19 Sep, 9 am". */
function stoodWords(job: Job): string | null {
  const { date } = whenOf(job);
  return date === null ? null : `${shortDate(date)}, ${indiaClock(startOf(job))}`;
}

interface Props {
  readonly job: Job;
  readonly to: Target;
  /** The start the move takes there, as the server answered; null where it could not say. */
  readonly landsAt: string | null;
  /** Ops blacked out the day the move goes to, so it goes only with a reason. */
  readonly blackout: boolean;
  readonly sending: boolean;
  /** Ops chose, after the drawer's warning, to clear the technician's check-in. */
  readonly clearingCheckIn: boolean;
  readonly onSend: (reason: MoveReason, blackoutReason: string | null) => void;
  readonly onCancel: () => void;
}

export function MovePicker({ job, to, landsAt, blackout, sending, clearingCheckIn, onSend, onCancel }: Props) {
  const [reason, setReason] = useState<MoveReason | null>(null);
  const [blackoutReason, setBlackoutReason] = useState("");
  const copy = dispatch.move;

  const lands = landsWords(to, landsAt);
  const stood = stoodWords(job);
  const notice = noticeOf(job, to, landsAt);
  const inside = noticeInside(job, new Date());
  const typed = blackoutReason.trim();
  const ready = reason !== null && (!blackout || typed !== "");

  return (
    <Dialog
      className={classes(styles.panel, styles.picker)}
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
      {blackout && (
        <>
          <p className={styles.consequence}>{copy.blackout(shortDate(to.date))}</p>
          <Field className={styles.blackoutReason} label={copy.blackoutReason}>
            {(control) => (
              <TextArea
                {...control}
                maxLength={REASON_MAX_CHARS}
                value={blackoutReason}
                disabled={sending}
                onChange={(event) => {
                  setBlackoutReason(event.target.value);
                }}
              />
            )}
          </Field>
        </>
      )}
      <p className={styles.consequence}>{notice.line}</p>
      {inside !== null && <p className={styles.consequence}>{copy.soon(inside)}</p>}
      {clearingCheckIn && <p className={styles.consequence}>{copy.checkInCleared}</p>}
      <div className={styles.actions}>
        <Button
          variant="primary"
          size="small"
          disabled={!ready || sending}
          busy={sending}
          onClick={() => {
            if (reason !== null) onSend(reason, blackout ? typed : null);
          }}
        >
          {sendLabel(sending, notice.messaged)}
        </Button>
        <Button variant="outline" size="small" disabled={sending} onClick={onCancel}>
          {copy.cancel}
        </Button>
      </div>
    </Dialog>
  );
}
