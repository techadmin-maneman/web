// The reason a move must carry, asked before anything is sent; the server still runs the clash check
// (docs/decisions/0034-clash-check.md). No amount is shown, since a move ops make never charges the client
// (src/policy/dispatch.ts), and the WhatsApp line shows only for a client who agreed to it, the panel saying to call
// any other (docs/decisions/0069-dispatch-under-concurrency.md).

import { REASON_MAX_CHARS } from "@rules/policy/decision-reasons.ts";
import { classes } from "@maneman/ui/classes";
import { Button } from "@maneman/ui/Button";
import { Dialog } from "@maneman/ui/Dialog";
import { drawerFrame } from "@maneman/ui/Drawer";
import { ChoiceGroup, Field, Radio, TextArea } from "@maneman/ui/Field";
import { indiaClock, shortDate } from "@maneman/web-kit/dates";
import { useState } from "react";
import type { MoveReason } from "../api.ts";
import { dispatch } from "../content.ts";
import styles from "./move-picker.module.css";
import { phoneWords } from "../lib/phone.ts";
import {
  asksTheClientOf,
  changesTime,
  nameOf,
  personOf,
  startOf,
  whenOf,
  type Job,
  type Target,
  windowWord,
} from "./job.ts";

const AN_HOUR = 60 * 60 * 1000;

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

/** "Move and notify" only where a message will go; "Ask Rohit M. to confirm" where the client is asked instead. */
function sendLabel(job: Job, sending: boolean, messaged: boolean, asking: boolean): string {
  const copy = dispatch.move;
  if (asking) return sending ? copy.asking : copy.askSend(nameOf(job));
  if (sending) return copy.sending;
  return messaged ? copy.send : copy.sendQuietly;
}

/** What the client hears when they are asked: on WhatsApp, or by a call from ops. */
function askLine(job: Job): string {
  const person = personOf(job);
  if (person === null || person.whatsapp_visits) return dispatch.move.ask(nameOf(job));
  return dispatch.move.askCall(person.name, phoneWords(person.mobile));
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
  /** `asking`: the client is asked to confirm the move rather than told of it (ADR 0115). */
  readonly onSend: (reason: MoveReason, blackoutReason: string | null, asking: boolean) => void;
  readonly onCancel: () => void;
}

/** Where the visit lands: from where it stood, or at the same time with another technician. */
function whenWords(stood: string | null, lands: string): string {
  const copy = dispatch.move;
  if (stood === null) return copy.to(lands);
  return stood === lands ? copy.stays(lands) : copy.fromTo(stood, lands);
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
  const asking = asksTheClientOf(job, to, reason);

  return (
    <Dialog
      className={classes(drawerFrame, styles.picker)}
      labelledBy="move-title"
      canClose={!sending}
      onDismiss={onCancel}
    >
      <h2 className={styles.pickerTitle} id="move-title">
        {copy.title(nameOf(job), to.technician.name)}
      </h2>
      <p className={styles.pickerWhen}>{whenWords(stood, lands)}</p>
      <ChoiceGroup className={styles.reasons} legend={copy.legend} legendLook="hidden" disabled={sending} ruled>
        {copy.reasons.map((each) => (
          <Radio
            key={each.reason}
            label={each.label}
            name="move-reason"
            value={each.reason}
            checked={reason === each.reason}
            onChange={() => {
              setReason(each.reason);
            }}
          />
        ))}
      </ChoiceGroup>
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
      <p className={styles.consequence}>{asking ? askLine(job) : notice.line}</p>
      {inside !== null && <p className={styles.consequence}>{copy.soon(inside)}</p>}
      {clearingCheckIn && <p className={styles.consequence}>{copy.checkInCleared}</p>}
      <div className={styles.actions}>
        <Button
          variant="primary"
          size="small"
          disabled={!ready || sending}
          busy={sending}
          onClick={() => {
            if (reason !== null) onSend(reason, blackout ? typed : null, asking);
          }}
        >
          {sendLabel(job, sending, notice.messaged, asking)}
        </Button>
        <Button variant="outline" size="small" disabled={sending} onClick={onCancel}>
          {copy.cancel}
        </Button>
      </div>
    </Dialog>
  );
}
