// The booking sheet's steps (boards C2 to C6): the date, the window, paying,
// and what came of it; for a client with more than one service open to them,
// the one they want before those (ADR 0085); and, for a client who has given
// none, the address before the date (ADR 0079). The sheet (BookingSheet.tsx)
// holds the state; each step only draws it. Every step has a heading with the
// sheet's title id, so the sheet is named whatever it shows.

import { ICONS } from "@maneman/brand/icons";
import { Button } from "@maneman/ui/Button";
import { Icon } from "@maneman/ui/Icon";
import { VisuallyHidden } from "@maneman/ui/VisuallyHidden";
import { indiaClock, indiaDate, shortDate, weekdayDate } from "@maneman/web-kit/dates";
import { rupees } from "@maneman/web-kit/money";
import { useState } from "react";
import type { Availability, BookingConsent, BookingWindow, Hold, MoveTerms, OfferedService, Price } from "../api.ts";
import { booking, change, messages, profile, states, VISIT_TYPES, WINDOW_HOURS, WINDOW_NAMES } from "../content.ts";
import { CLOCK } from "../icons.ts";
import { priceFigures } from "../lib/money.ts";
import { useSecondsLeft } from "../lib/useSecondsLeft.ts";
import { firstName } from "../lib/visit.ts";
import { whatsappWith } from "../lib/whatsapp.ts";
import { AddressForm } from "../profile/AddressForm.tsx";
import { CodeBox } from "./CodeBox.tsx";
import { consentLines } from "./consents.ts";
import styles from "./booking.module.css";

type Day = Availability["days"][number];

/** The id every step's heading carries, which names the sheet (BookingSheet.tsx). */
export const TITLE_ID = "booking-title";

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const isFull = (day: Day) => day.windows.every((window) => window.with === null);

/** Whole minutes and seconds: 9:42. */
const minutesAndSeconds = (seconds: number) =>
  `${String(Math.floor(seconds / 60))}:${String(seconds % 60).padStart(2, "0")}`;

/** The seconds a hold has left, counted on the API's clock, which set its expiry. */
export const useHoldLeft = (hold: Hold): number => useSecondsLeft(Date.parse(hold.expires_at));

/** A hold that costs the client nothing now: a free visit, or one a credit covers. Checkout never opens for it. */
export const paysNothing = (hold: Hold): boolean => hold.price.amount === 0 || hold.credit !== null;

/**
 * "Step 1 of 3" and "Step 2 of 3", as the boards number the date and the window, with the pay step the third; one
 * step later, and one step longer, for each the sheet takes before the date: the visit chosen (ADR 0085) and the
 * address asked for (ADR 0079).
 */
const stepOf = (step: number, before: number): string => booking.step(step + before, 3 + before);

function Heading({ title, step, aside }: { title: string; step?: string; aside?: string }) {
  return (
    <div className={styles.heading}>
      <h2 className={styles.title} id={TITLE_ID}>
        {title}
      </h2>
      {step !== undefined && <p className={styles.step}>{step}</p>}
      {aside !== undefined && (
        <p className={styles.held}>
          <Icon d={CLOCK} size={16} />
          {aside}
        </p>
      )}
    </div>
  );
}

/**
 * Said once, a minute before the hold lapses, by a status a screen reader reads as it changes. The
 * count itself is shown and never spoken, or it would be read out every second.
 */
function LastMinute({ left }: { left: number }) {
  return (
    <VisuallyHidden as="p" role="status">
      {left > 0 && left <= 60 ? booking.lastMinute : ""}
    </VisuallyHidden>
  );
}

/**
 * The late fee's line, the same on the pay step (boards C4 and C5) and on moving a visit (C7): the
 * ex-GST figure in the sentence, and the inclusive one muted after it once GST applies.
 */
export function LateFee({ fee, noticeHours }: { fee: Price; noticeHours: number }) {
  const { exGst, inclusive } = priceFigures(fee);
  const copy = booking.lateFee;
  return (
    <>
      {copy.costs(exGst, noticeHours)}
      {inclusive !== null && <span className={styles.inclusive}>{copy.inclusive(inclusive)}</span>}
      {copy.rest}
    </>
  );
}

/** While the sheet asks for the days: named for a screen reader, drawn as the design's loading block. */
export function LoadingStep() {
  return (
    <>
      <VisuallyHidden as="h2" id={TITLE_ID}>
        {states.loading}
      </VisuallyHidden>
      <div className={styles.loading} aria-busy="true" />
    </>
  );
}

/**
 * The address, before any slot, for a client who has given none (ADR 0079): Profile's own form, under its heading.
 * No board draws it. `refused`: the API refused a hold for want of one, so the sheet came back here. `before`: the
 * steps the sheet takes before the date, of which this is the last.
 */
export function AddressStep({ refused, before, onSaved }: { refused: boolean; before: number; onSaved: () => void }) {
  const copy = booking.address;
  return (
    <>
      <Heading title={profile.where} step={booking.step(before, 3 + before)} />
      <p className={styles.why} role={refused ? "alert" : undefined}>
        {refused ? copy.refused : copy.why}
      </p>
      <AddressForm address={null} saveLabel={copy.save} onSaved={onSaved} />
    </>
  );
}

/**
 * No board draws it: every service open to the client, when there is more than one, a kind at a time in the order
 * ops keep them, each with how long it takes and what it costs from the first day it can be booked (ADR 0085). The
 * services are native radio buttons of one name, drawn as the window step's rows: one choice among them all, one
 * tab stop, and the arrow keys move between them. `before`: the steps the sheet will take before the date.
 */
export function ServiceStep(props: {
  before: number;
  services: readonly OfferedService[];
  chosen: OfferedService | null;
  onChoose: (service: OfferedService) => void;
  onNext: () => void;
}) {
  const copy = booking.service;
  const kinds = [...new Set(props.services.map((service) => service.type))];
  const title = kinds.length === 1 && kinds[0] === "first_fit" ? copy.titleFirstFit : copy.title;
  return (
    <>
      <Heading title={title} step={booking.step(1, 3 + props.before)} />
      {kinds.map((kind) => (
        <div key={kind} className={styles.kind}>
          <h3 className={styles.label} id={`booking-kind-${kind}`}>
            {VISIT_TYPES[kind]}
          </h3>
          <div className={styles.windows} role="radiogroup" aria-labelledby={`booking-kind-${kind}`}>
            {props.services
              .filter((service) => service.type === kind)
              .map((service) => {
                const { exGst, inclusive } = priceFigures(service.price);
                return (
                  <label key={service.tier} className={styles.window}>
                    <input
                      className={styles.radio}
                      type="radio"
                      name="booking-service"
                      checked={service.type === props.chosen?.type && service.tier === props.chosen.tier}
                      onChange={() => {
                        props.onChoose(service);
                      }}
                    />
                    <span>
                      <span className={styles.windowName}>{service.name}</span>
                      <span className={styles.windowTime}>{booking.length(service.minutes)}</span>
                    </span>
                    <span className={styles.serviceMoney}>
                      <span className={styles.windowName}>{service.price.amount === 0 ? copy.free : exGst}</span>
                      {inclusive !== null && <span className={styles.windowTime}>{copy.incl(inclusive)}</span>}
                    </span>
                  </label>
                );
              })}
          </div>
        </div>
      ))}
      <Button
        variant="primary"
        size="action"
        className={styles.primary}
        disabled={props.chosen === null}
        onClick={props.onNext}
      >
        {copy.continue}
      </Button>
    </>
  );
}

/**
 * Board C2: fourteen days, full ones shown but not chosen. The days are one group of native radio
 * buttons, drawn as the design's squares: one tab stop, and the arrow keys move between the days.
 * `before`: the steps the sheet took before the date.
 */
export function DateStep(props: {
  before: number;
  days: Day[];
  chosen: string | null;
  onChoose: (date: string) => void;
  onNext: () => void;
}) {
  const copy = booking.date;
  return (
    <>
      <Heading title={copy.title} step={stepOf(1, props.before)} />
      <div className={styles.strip} role="radiogroup" aria-labelledby={TITLE_ID}>
        {props.days.map((day) => {
          const full = isFull(day);
          const weekday = DAY_NAMES[new Date(`${day.date}T00:00:00Z`).getUTCDay()] ?? "";
          return (
            <label key={day.date} className={styles.day}>
              <input
                className={styles.radio}
                type="radio"
                name="booking-date"
                checked={day.date === props.chosen}
                disabled={full}
                aria-label={`${weekdayDate(day.date)}${full ? `, ${copy.full}` : ""}`}
                onChange={() => {
                  props.onChoose(day.date);
                }}
              />
              <span className={styles.weekday} aria-hidden="true">
                {weekday}
              </span>
              <span className={styles.number} aria-hidden="true">
                {String(Number(day.date.slice(8)))}
              </span>
            </label>
          );
        })}
      </div>
      <div className={styles.legend} aria-hidden="true">
        <span>
          <span className={styles.swatch} />
          {copy.available}
        </span>
        <span>
          <span className={`${styles.swatch} ${styles.swatchFull}`} />
          {copy.full}
        </span>
      </div>
      <Button
        variant="primary"
        size="action"
        className={styles.primary}
        disabled={props.chosen === null}
        onClick={props.onNext}
      >
        {copy.continue}
      </Button>
    </>
  );
}

/** Board C3: the day's three windows, and whether the regular technician is free. */
export function WindowStep(props: {
  before: number;
  day: Day;
  regular: Availability["regular"];
  chosen: BookingWindow | null;
  busy: boolean;
  problem: string | null;
  onChoose: (window: BookingWindow) => void;
  onNext: () => void;
}) {
  const copy = booking.window;
  const regularName = props.regular === null ? null : firstName(props.regular.name);
  const chosen = props.day.windows.find((each) => each.window === props.chosen);

  const noteFor = (who: Day["windows"][number]["with"]) => {
    if (who === null) return copy.full;
    if (who === "regular" && regularName !== null) return copy.regularFree(regularName);
    return copy.another;
  };

  return (
    <>
      <Heading title={copy.title} step={stepOf(2, props.before)} />
      <p className={styles.dayLine}>{weekdayDate(props.day.date)}</p>
      <div className={styles.windows} role="radiogroup" aria-labelledby={TITLE_ID}>
        {props.day.windows.map(({ window, with: who }) => (
          <label key={window} className={styles.window}>
            <input
              className={styles.radio}
              type="radio"
              name="booking-window"
              checked={window === props.chosen}
              disabled={who === null}
              onChange={() => {
                props.onChoose(window);
              }}
            />
            <span>
              <span className={styles.windowName}>{WINDOW_NAMES[window]}</span>
              <span className={styles.windowTime}>{WINDOW_HOURS[window]}</span>
            </span>
            <span className={styles.windowNote}>{noteFor(who)}</span>
          </label>
        ))}
      </div>
      {props.regular !== null && regularName !== null && chosen !== undefined && (
        <div className={styles.regular}>
          <span className={styles.initials} aria-hidden="true">
            {props.regular.initials}
          </span>
          <p>{chosen.with === "regular" ? copy.regularLine(regularName) : copy.anotherLine(regularName)}</p>
        </div>
      )}
      {props.problem !== null && (
        <p className={styles.problem} role="alert">
          {props.problem}
        </p>
      )}
      <Button
        variant="primary"
        size="action"
        className={styles.primary}
        disabled={props.chosen === null || props.busy}
        busy={props.busy}
        onClick={props.onNext}
      >
        {copy.continue}
      </Button>
    </>
  );
}

/** What the pay step names: the service booked, or, for a move, the visit moved or its late fee. */
function itemName(hold: Hold, moving: MoveTerms | undefined): string {
  const what = hold.service.name;
  if (moving?.cost === "free") return change.moveItem(what);
  if (moving?.cost === "late_fee") return change.lateFeeItem(what);
  return what;
}

/** What the pay step's button says: what is paid, or, with nothing to pay, what is confirmed. */
function payLabel(hold: Hold, moving: MoveTerms | undefined): string {
  if (!paysNothing(hold)) return booking.pay.pay(rupees(hold.price.amount));
  return moving === undefined ? booking.pay.confirm : change.confirmMove;
}

/** The pay step's figure: nothing for a visit a credit covers, "Free" for one that costs nothing, else its price. */
function amountLine(hold: Hold, covered: boolean, free: boolean): string {
  if (covered) return booking.pay.credit.zero;
  return free ? booking.pay.free : rupees(hold.price.amount_ex_gst);
}

/**
 * What changing the visit later costs, beneath the pay step's lines, as the booking is sold
 * (docs/decisions/0088-every-policy-in-the-console.md): for a visit moved in place, that its payment carries over;
 * for one sold to charge a late fee, the fee; for one sold to cost nothing late, that it is free at any time; for any
 * other, the hour it may be changed free until. A credit's own note, below, says what cancelling late costs, so a
 * covered visit that costs its credit late says nothing here.
 */
function ChangeTerms({ hold, moving, covered }: { hold: Hold; moving: MoveTerms | undefined; covered: boolean }) {
  const line = `${styles.line ?? ""} ${styles.soft ?? ""}`;
  if (moving !== undefined) {
    return (
      <p className={line}>{moving.paid > 0 ? change.move.free(rupees(moving.paid)) : change.move.freeNothingPaid}</p>
    );
  }
  if (hold.late_change_charge === "late_fee" && hold.late_fee !== null) {
    return (
      <p className={line}>
        <LateFee fee={hold.late_fee} noticeHours={hold.change_notice_hours} />
      </p>
    );
  }
  if (hold.late_change_charge === "nothing") return <p className={line}>{booking.pay.freeAnyTime}</p>;
  if (covered) return null;
  return (
    <p className={line}>
      {booking.pay.freeUntil(`${indiaClock(hold.free_until)}, ${shortDate(indiaDate(hold.free_until))}`)}
    </p>
  );
}

/**
 * What booking also agrees to, one tap away beneath Pay: the notice the consent is recorded on, word for word.
 * Nothing when the client has decided both purposes.
 */
function AgreedByBooking({ consents }: { consents: readonly BookingConsent[] }) {
  const lines = consentLines(consents);
  if (lines.length === 0) return null;
  return (
    <details className={styles.consents}>
      <summary className={styles.consentsOpen}>{booking.pay.consents.open}</summary>
      {lines.map((line) => (
        <p key={line}>{line}</p>
      ))}
    </details>
  );
}

/** Board C4, and C5's first fit: the held visit, what it costs, and Pay. */
export function PayStep(props: {
  hold: Hold;
  moving?: MoveTerms | undefined;
  busy: boolean;
  problem: string | null;
  /** Whether to ask to remind the client the day before: not when they have already switched it on. */
  askToRemind: boolean;
  /** The photograph purposes booking also agrees to. */
  consents: readonly BookingConsent[];
  remind: boolean;
  onRemind: (remind: boolean) => void;
  onPay: () => void;
  /** The hold priced again, once a discount code is applied or removed. */
  onHold: (hold: Hold) => void;
}) {
  const { hold, moving } = props;
  const copy = booking.pay;
  const left = useHoldLeft(hold);
  const technician = firstName(hold.technician.name);
  const covered = hold.credit !== null;
  const free = paysNothing(hold);
  // A move in place keeps the visit as it was booked: only its new time, and what the move costs, are shown.
  const inPlace = moving !== undefined && moving.cost !== "charged";
  const isFirstFit = hold.type === "first_fit" && !inPlace;
  // A code is for a visit sold, never a move, nor one a credit pays for, nor a consultation, which costs nothing.
  const takesACode = moving === undefined && !covered && hold.type !== "consultation";
  const listPrice = hold.discount?.list_price ?? null;
  // A code being applied or taken off may change the price: Pay waits for it, so the order is for the price shown.
  const [codeSending, setCodeSending] = useState(false);
  return (
    <>
      <Heading title={copy.title} aside={copy.held(minutesAndSeconds(left))} />
      <LastMinute left={left} />
      <div className={styles.summary}>
        <div className={styles.item}>
          <div>
            <p className={styles.itemName}>{itemName(hold, moving)}</p>
            <p className={styles.itemWhen}>{`${shortDate(hold.date)}, ${WINDOW_HOURS[hold.window]}`}</p>
            {/* Board C5 draws "Two slots · 3 hours": the length is now the service's own (ADR 0085). */}
            {isFirstFit && <p className={styles.itemWhen}>{booking.length(hold.service.minutes)}</p>}
          </div>
          <div className={styles.money}>
            {covered && <p className={styles.was}>{rupees(hold.price.amount_ex_gst)}</p>}
            {listPrice !== null && <p className={styles.was}>{rupees(listPrice.amount_ex_gst)}</p>}
            <p className={styles.amount}>{amountLine(hold, covered, free)}</p>
            {!free && <p className={styles.incl}>{copy.incl(rupees(hold.price.amount))}</p>}
          </div>
        </div>
        {hold.credit !== null && (
          <p className={styles.creditLine}>
            <span>{copy.credit.used}</span>
            <span>{copy.credit.remaining(hold.credit.remaining)}</span>
          </p>
        )}
        {isFirstFit && <p className={styles.line}>{copy.guarantee}</p>}
        <ChangeTerms hold={hold} moving={inPlace ? moving : undefined} covered={covered} />
      </div>
      {takesACode && <CodeBox hold={hold} busy={props.busy} onHold={props.onHold} onSending={setCodeSending} />}
      {props.askToRemind && (
        <label className={styles.remind}>
          <input
            type="checkbox"
            checked={props.remind}
            onChange={(event) => {
              props.onRemind(event.target.checked);
            }}
          />
          <span>{copy.remind}</span>
        </label>
      )}
      {props.problem !== null && (
        <p className={styles.problem} role="alert">
          {props.problem}
        </p>
      )}
      <Button
        variant="primary"
        size="action"
        className={styles.primary}
        disabled={props.busy || codeSending || left === 0}
        busy={props.busy}
        onClick={props.onPay}
      >
        {payLabel(hold, moving)}
      </Button>
      {!free && <p className={styles.moneyNote}>{copy.neverHandlesMoney(technician)}</p>}
      {covered && hold.late_change_charge !== "nothing" && (
        <p className={styles.creditNote}>{copy.credit.note(hold.change_notice_hours)}</p>
      )}
      <AgreedByBooking consents={props.consents} />
    </>
  );
}

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
 * Board C6: booked. The technician's message the day before is promised only to a client who has
 * switched on WhatsApp about their visits, since it is sent to no one else.
 */
export function ConfirmedStep(props: { hold: Hold; moved: boolean; reminded: boolean; onDone: () => void }) {
  const { hold, moved, reminded, onDone } = props;
  const copy = booking.confirmed;
  const technician = firstName(hold.technician.name);
  const when = `${weekdayDate(hold.date)}, ${WINDOW_HOURS[hold.window]}`;
  return (
    <div className={styles.confirmed} role="status">
      <h2 className={styles.confirmedLabel} id={TITLE_ID}>
        {moved ? change.moved : copy.label}
      </h2>
      <Icon className={styles.confirmedTick} d={ICONS.tick} size={26} />
      <p className={styles.confirmedTitle}>{when}</p>
      {reminded && <p className={styles.confirmedLine}>{copy.tellsYou(technician)}</p>}
      <Settled hold={hold} />
      <a
        className={styles.note}
        href={whatsappWith(messages.note(VISIT_TYPES[hold.type], shortDate(hold.date)))}
        rel="noopener"
      >
        {copy.note(technician)}
      </a>
      <button className={styles.done} type="button" onClick={onDone}>
        {copy.close}
      </button>
    </div>
  );
}

/** Waiting for Razorpay's confirmation and FSM, or what came of it when it was not a booking. */
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
