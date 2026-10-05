// Boards C5 and C6: what came of paying, the hold that ran out, the booking confirmed, and a wait.

import { ICONS } from "@maneman/brand/icons";
import { Button } from "@maneman/ui/Button";
import { Icon } from "@maneman/ui/Icon";
import { shortDate, weekdayDate } from "@maneman/web-kit/dates";
import { rupees } from "@maneman/web-kit/money";
import { useState } from "react";
import type { Hold } from "../../api.ts";
import { booking, change, messages, VISIT_TYPES, WINDOW_HOURS } from "../../content.ts";
import { whatsappWith } from "../../lib/whatsapp.ts";
import { NoteSheet } from "../NoteSheet.tsx";
import styles from "../booking.module.css";
import { firstNameOf } from "../../../../../src/lib/names.ts";
import { TITLE_ID, minutesAndSeconds, useHoldLeft, LastMinute } from "./shared.tsx";

/** Board C6: the payment failed, and the hold's time left. Checkout offers every way to pay again. */
export function FailedStep(props: { hold: Hold; busy: boolean; onRetry: () => void }) {
  const { hold, busy, onRetry } = props;
  const copy = booking.failed;
  const left = useHoldLeft(hold);
  return (
    // Busy while the payment is being started again, so a screen reader is told the step is working.
    <div aria-busy={busy}>
      <p className={styles.caption}>{copy.label}</p>
      <div className={styles.failed}>
        <div role="alert">
          <h2 className={styles.outcome} id={TITLE_ID}>
            {copy.title}
          </h2>
        </div>
        {/* Outside the alert, which a screen reader reads again whenever it changes: here, every second. */}
        <p className={styles.outcomeLine}>{copy.held(minutesAndSeconds(left))}</p>
        <LastMinute left={left} />
      </div>
      <Button variant="primary" size="action" className={styles.primary} disabled={busy} busy={busy} onClick={onRetry}>
        {copy.retry}
      </Button>
    </div>
  );
}

/** Board C6: the hold lapsed before the payment. */
export function ExpiredStep({ onPickAgain }: { onPickAgain: () => void }) {
  return (
    <div role="alert">
      <p className={styles.caption}>{booking.expired.label}</p>
      <h2 className={styles.outcome} id={TITLE_ID}>
        {booking.expired.title}
      </h2>
      <Button variant="primary" size="action" className={styles.primary} onClick={onPickAgain}>
        {booking.expired.pickAgain}
      </Button>
    </div>
  );
}

/** What booking took, on the confirmation: a visit credit, or the money paid; for a free visit, nothing. */
function Settled({ hold }: { hold: Hold }) {
  const copy = booking;
  if (hold.credit !== null) {
    return (
      <p className={styles.paid}>
        <span>{copy.pay.credit.used}</span>
        <span className={styles.paidAmount}>{copy.pay.credit.remaining(hold.credit.remaining)}</span>
      </p>
    );
  }
  if (hold.price.amount === 0) return null;
  return (
    <p className={styles.paid}>
      <span>{copy.confirmed.paid}</span>
      <span className={styles.paidAmount}>{rupees(hold.price.amount)}</span>
    </p>
  );
}

/**
 * Board C6: booked. The reminder the day before is promised only to a client who has switched on
 * WhatsApp about their visits, since it is sent to no one else.
 */
export function ConfirmedStep(props: { hold: Hold; moved: boolean; reminded: boolean; onDone: () => void }) {
  const { hold, moved, reminded, onDone } = props;
  const copy = booking.confirmed;
  const technician = firstNameOf(hold.technician.name);
  const when = `${weekdayDate(hold.date)}, ${WINDOW_HOURS[hold.window]}`;
  return (
    <div className={styles.confirmed} role="status">
      <h2 className={styles.confirmedLabel} id={TITLE_ID}>
        {moved ? change.moved : copy.label}
      </h2>
      <Icon className={styles.confirmedTick} d={ICONS.tick} size={26} />
      <p className={styles.confirmedTitle}>{when}</p>
      {reminded && <p className={styles.confirmedLine}>{copy.tellsYou}</p>}
      <Settled hold={hold} />
      <ConfirmedNote hold={hold} technician={technician} />
      <button className={styles.done} type="button" onClick={onDone}>
        {copy.close}
      </button>
    </div>
  );
}

/**
 * Add a note, on the visit just booked: kept on it for the technician, as Home's card keeps one. A booking whose visit
 * is not written yet sends it to us on WhatsApp instead.
 */
function ConfirmedNote({ hold, technician }: { hold: Hold; technician: string }) {
  const [open, setOpen] = useState(false);
  const message = messages.note(VISIT_TYPES[hold.type], shortDate(hold.date));
  if (hold.visit_id === null) {
    return (
      <a className={styles.note} href={whatsappWith(message)} rel="noopener">
        {booking.confirmed.note(technician)}
      </a>
    );
  }
  return (
    <>
      <button
        className={styles.note}
        type="button"
        onClick={() => {
          setOpen(true);
        }}
      >
        {booking.confirmed.note(technician)}
      </button>
      {open && (
        <NoteSheet
          visitId={hold.visit_id}
          technician={technician}
          initial={null}
          message={message}
          onClose={() => {
            setOpen(false);
          }}
        />
      )}
    </>
  );
}

/** Waiting for Razorpay's confirmation and the booking, or what came of it when it was not a booking. */
export function WaitStep({ text, onClose }: { text: string; onClose?: () => void }) {
  return (
    <div role="status">
      <h2 className={styles.outcome} id={TITLE_ID}>
        {text}
      </h2>
      {onClose !== undefined && (
        <Button variant="outline" size="control" className={styles.secondary} onClick={onClose}>
          {booking.close}
        </Button>
      )}
    </div>
  );
}
