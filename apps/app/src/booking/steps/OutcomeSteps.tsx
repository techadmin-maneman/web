// What came of paying, as the design draws it: a wait while it is confirmed, the time released, and the visit booked,
// on the navy.

import { GLYPHS, ICONS } from "@maneman/brand/icons";
import { Button } from "@maneman/ui/Button";
import { Icon } from "@maneman/ui/Icon";
import { Spinner } from "@maneman/ui/Spinner";
import { TextButton, TextLink } from "@maneman/ui/TextLink";
import { addDays, shortDate, todayInIndia, weekdayDate } from "@maneman/web-kit/dates";
import { rupees } from "@maneman/web-kit/money";
import { useState, type ReactNode } from "react";
import type { Address, Hold, MoveTerms } from "../../api.ts";
import { arrivalHours, booking, messages, VISIT_TYPES } from "../../content.ts";
import { AddToCalendar } from "../../visits/index.ts";
import { whatsappWith } from "../../lib/whatsapp.ts";
import { NoteSheet } from "../NoteSheet.tsx";
import bookingSheet from "../booking.module.css";
import styles from "./outcome-steps.module.css";
import { firstNameOf } from "@rules/lib/names.ts";
import { Frame, TITLE_ID } from "./shared.tsx";

/** The hold lapsed before the payment: nothing was charged, and the client picks again. */
export function ExpiredStep({ onPickAgain, onClose }: { onPickAgain: () => void; onClose: () => void }) {
  const copy = booking.expired;
  return (
    <Frame
      onClose={onClose}
      footer={
        <Button variant="primary" size="action" className={bookingSheet.primary} onClick={onPickAgain}>
          {copy.pickAgain}
        </Button>
      }
    >
      <div className={styles.middle} role="alert">
        <Icon className={styles.released} d={GLYPHS.clock} size="xl" />
        <h2 className={styles.title} id={TITLE_ID}>
          {copy.title}
        </h2>
        <p className={styles.line}>{copy.line}</p>
      </div>
    </Frame>
  );
}

/**
 * Waiting for Razorpay's word and the booking, turning, with the way out at its head; or what came of it when it was
 * not a booking, with Close at its foot. Its title and line are said as they change.
 */
export function WaitStep(props: { title: string; line?: string; waiting?: boolean; onClose: () => void }) {
  const { waiting = false } = props;
  return (
    <Frame
      onClose={waiting ? props.onClose : undefined}
      footer={
        waiting ? undefined : (
          <Button variant="outline" size="action" className={bookingSheet.primary} onClick={props.onClose}>
            {booking.close}
          </Button>
        )
      }
    >
      <div className={styles.middle} role="status">
        {waiting && <Spinner className={styles.spinner} />}
        <h2 className={styles.title} id={TITLE_ID}>
          {props.title}
        </h2>
        {props.line !== undefined && <p className={styles.line}>{props.line}</p>}
      </div>
    </Frame>
  );
}

/** A name beside its value on the navy, as the design's booked screen lists them. */
function Fact({ name, children }: { name: string; children: ReactNode }) {
  return (
    <div className={styles.fact}>
      <dt>{name}</dt>
      <dd>{children}</dd>
    </div>
  );
}

/** What booking took: a visit credit, the money paid, what a move kept, or, for a free visit, nothing. */
function paymentOf(hold: Hold, moving: MoveTerms | undefined): string {
  const copy = booking.confirmed;
  if (hold.credit !== null) return copy.credit;
  if (hold.price.amount > 0) return copy.paid(rupees(hold.price.amount));
  return moving !== undefined && (moving.paid > 0 || moving.credit !== null) ? copy.carriedOver : copy.free;
}

/**
 * Booked, on the navy: the day, when the technician arrives, who, where and what was paid, the calendars, Done, and a
 * note for the technician. The reminder the day before is promised only to a client who has switched on WhatsApp
 * about their visits, since it is sent to no one else.
 */
export function ConfirmedStep(props: {
  hold: Hold;
  moving: MoveTerms | undefined;
  address: Address | null;
  reminded: boolean;
  onDone: () => void;
}) {
  const { hold, reminded } = props;
  const copy = booking.confirmed;
  const technician = firstNameOf(hold.technician.name);
  const remindsTheDayBefore = reminded && hold.date > addDays(todayInIndia(Date.now()), 1);
  return (
    <div className={styles.confirmed} role="status">
      <div className={styles.confirmedBody}>
        <span className={styles.check}>
          <Icon d={ICONS.tick} size="lg" />
        </span>
        {/* What was booked names the sheet; the day beneath it is drawn the larger, as the design draws it. */}
        <h2 className={styles.confirmedLabel} id={TITLE_ID}>
          {props.moving === undefined ? copy.label[hold.type] : copy.moved}
        </h2>
        <p className={styles.confirmedDate}>{weekdayDate(hold.date)}</p>
        <p className={styles.arrives}>{copy.arrives(arrivalHours(hold))}</p>
        <dl className={styles.facts}>
          <Fact name={copy.technician}>{hold.technician.name}</Fact>
          {/* A move keeps its visit's own address, which the profile's may no longer be. */}
          {props.address !== null && props.moving === undefined && (
            <Fact name={copy.address}>{props.address.line1}</Fact>
          )}
          <Fact name={copy.payment}>{paymentOf(hold, props.moving)}</Fact>
        </dl>
        {remindsTheDayBefore && <p className={styles.told}>{copy.tellsYou}</p>}
        <div className={styles.calendar}>
          <AddToCalendar
            visit={{
              id: hold.visit_id ?? hold.id,
              starts_at: hold.starts_at,
              ends_at: hold.ends_at,
              arrives_by: hold.arrives_by,
              name: VISIT_TYPES[hold.type],
              technician,
            }}
            onInk
          />
        </div>
      </div>
      <div className={styles.confirmedFooter}>
        <Button variant="gold" size="action" className={bookingSheet.primary} onClick={props.onDone}>
          {copy.close}
        </Button>
        <ConfirmedNote hold={hold} technician={technician} />
      </div>
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
      <TextLink tone="ink" className={styles.note} href={whatsappWith(message)}>
        {booking.confirmed.note(technician)}
      </TextLink>
    );
  }
  return (
    <>
      <TextButton
        tone="ink"
        className={styles.note}
        onClick={() => {
          setOpen(true);
        }}
      >
        {booking.confirmed.note(technician)}
      </TextButton>
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
