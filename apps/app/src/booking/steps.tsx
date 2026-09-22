// The booking sheet's steps (boards C2 to C6): the date, the window, paying,
// and what came of it. The sheet (BookingSheet.tsx) holds the state; each step
// only draws it.

import { ICONS } from "@maneman/brand/icons";
import { shortDate, weekdayDate } from "@maneman/web-kit/dates";
import { rupees } from "@maneman/web-kit/money";
import type { Availability, BookingWindow, Hold } from "../api.ts";
import { Icon } from "../components/Icon.tsx";
import { booking, messages, VISIT_TYPES, WINDOW_HOURS, WINDOW_NAMES } from "../content.ts";
import { CHECK, CLOCK } from "../icons.ts";
import { useCountdown } from "../lib/useCountdown.ts";
import { firstName } from "../lib/visit.ts";
import { whatsappWith } from "../lib/whatsapp.ts";
import type { PayMethod } from "./checkout.ts";
import styles from "./booking.module.css";

type Day = Availability["days"][number];

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const isFull = (day: Day) => day.windows.every((window) => window.with === null);

/** An instant in India's time, whose date and clock the lines below read. */
const inIndia = (instant: string) => new Date(Date.parse(instant) + 330 * 60_000);

/** An instant as India's clock: "12 pm", "9:30 am". */
function clock(instant: string): string {
  const india = inIndia(instant);
  const hours = india.getUTCHours();
  const minutes = india.getUTCMinutes();
  const hour = hours % 12 === 0 ? 12 : hours % 12;
  return `${String(hour)}${minutes === 0 ? "" : `:${String(minutes).padStart(2, "0")}`} ${hours < 12 ? "am" : "pm"}`;
}

/** Whole minutes and seconds: 9:42. */
const minutesAndSeconds = (seconds: number) =>
  `${String(Math.floor(seconds / 60))}:${String(seconds % 60).padStart(2, "0")}`;

/** The seconds a hold has left, counted down in whole seconds, from its expiry. */
export function useHoldLeft(hold: Hold): number {
  return useCountdown(Math.max(0, Math.round((Date.parse(hold.expires_at) - Date.now()) / 1000)), hold.id);
}

function Heading({ title, step, aside }: { title: string; step?: number; aside?: string }) {
  return (
    <div className={styles.heading}>
      <h2 className={styles.title} id="booking-title">
        {title}
      </h2>
      {step !== undefined && <p className={styles.step}>{booking.step(step)}</p>}
      {aside !== undefined && (
        <p className={styles.held}>
          <Icon d={CLOCK} size={16} />
          {aside}
        </p>
      )}
    </div>
  );
}

/** Board C2: fourteen days, full ones shown but not chosen. */
export function DateStep(props: {
  days: Day[];
  chosen: string | null;
  onChoose: (date: string) => void;
  onNext: () => void;
}) {
  const copy = booking.date;
  return (
    <>
      <Heading title={copy.title} step={1} />
      <div className={styles.strip} role="radiogroup" aria-labelledby="booking-title">
        {props.days.map((day) => {
          const full = isFull(day);
          const chosen = day.date === props.chosen;
          const weekday = DAY_NAMES[new Date(`${day.date}T00:00:00Z`).getUTCDay()] ?? "";
          return (
            <button
              key={day.date}
              className={chosen ? `${styles.day} ${styles.chosen}` : full ? `${styles.day} ${styles.full}` : styles.day}
              type="button"
              role="radio"
              aria-checked={chosen}
              aria-label={`${weekdayDate(day.date)}${full ? `, ${copy.full}` : ""}`}
              disabled={full}
              onClick={() => {
                props.onChoose(day.date);
              }}
            >
              <span className={styles.weekday}>{weekday}</span>
              <span className={styles.number}>{String(Number(day.date.slice(8)))}</span>
            </button>
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
      <button className={styles.primary} type="button" disabled={props.chosen === null} onClick={props.onNext}>
        {copy.continue}
      </button>
    </>
  );
}

/** Board C3: the day's three windows, and whether the regular technician is free. */
export function WindowStep(props: {
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
  return (
    <>
      <Heading title={copy.title} step={2} />
      <p className={styles.dayLine}>{weekdayDate(props.day.date)}</p>
      <div className={styles.windows} role="radiogroup" aria-labelledby="booking-title">
        {props.day.windows.map(({ window, with: who }) => {
          const full = who === null;
          const note =
            who === null
              ? copy.full
              : who === "regular" && regularName !== null
                ? copy.regularFree(regularName)
                : copy.another;
          const isChosen = window === props.chosen;
          return (
            <button
              key={window}
              className={
                isChosen
                  ? `${styles.window} ${styles.chosen}`
                  : full
                    ? `${styles.window} ${styles.full}`
                    : styles.window
              }
              type="button"
              role="radio"
              aria-checked={isChosen}
              disabled={full}
              onClick={() => {
                props.onChoose(window);
              }}
            >
              <span>
                <span className={styles.windowName}>{WINDOW_NAMES[window]}</span>
                <span className={styles.windowTime}>{WINDOW_HOURS[window]}</span>
              </span>
              <span className={styles.windowNote}>{note}</span>
            </button>
          );
        })}
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
      <button
        className={styles.primary}
        type="button"
        disabled={props.chosen === null || props.busy}
        onClick={props.onNext}
      >
        {copy.continue}
      </button>
    </>
  );
}

/** Board C4, and C5's first fit: the held visit, what it costs, and how to pay. */
export function PayStep(props: {
  hold: Hold;
  method: PayMethod;
  busy: boolean;
  problem: string | null;
  onMethod: (method: PayMethod) => void;
  onPay: () => void;
}) {
  const { hold } = props;
  const copy = booking.pay;
  const left = useHoldLeft(hold);
  const technician = firstName(hold.technician.name);
  const free = hold.price.amount === 0;
  const isFirstFit = hold.type === "first_fit";
  return (
    <>
      <Heading title={copy.title} aside={copy.held(minutesAndSeconds(left))} />
      <div className={styles.summary}>
        <div className={styles.item}>
          <div>
            <p className={styles.itemName}>{isFirstFit ? copy.firstFit : VISIT_TYPES[hold.type]}</p>
            <p className={styles.itemWhen}>{`${shortDate(hold.date)}, ${WINDOW_HOURS[hold.window]}`}</p>
            {isFirstFit && <p className={styles.itemWhen}>{copy.firstFitBlock}</p>}
          </div>
          <div className={styles.money}>
            <p className={styles.amount}>{free ? copy.free : rupees(hold.price.amount_ex_gst)}</p>
            {!free && <p className={styles.incl}>{copy.incl(rupees(hold.price.amount))}</p>}
          </div>
        </div>
        {isFirstFit && <p className={styles.line}>{copy.guarantee(technician)}</p>}
        {hold.late_fee !== null ? (
          <p className={`${styles.line} ${styles.soft}`}>{copy.lateFee(rupees(hold.late_fee.amount_ex_gst))}</p>
        ) : (
          <p className={`${styles.line} ${styles.soft}`}>
            {copy.freeUntil(
              `${clock(hold.free_until)}, ${shortDate(inIndia(hold.free_until).toISOString().slice(0, 10))}`,
            )}
          </p>
        )}
      </div>
      {!free && (
        <>
          <h3 className={styles.label}>{copy.with}</h3>
          <div className={styles.methods} role="radiogroup" aria-label={copy.with}>
            {(["upi", "card"] as const).map((method) => (
              <button
                key={method}
                className={method === props.method ? `${styles.method} ${styles.picked}` : styles.method}
                type="button"
                role="radio"
                aria-checked={method === props.method}
                onClick={() => {
                  props.onMethod(method);
                }}
              >
                <span>{copy[method]}</span>
                <span className={styles.tick} aria-hidden="true">
                  {method === props.method && <Icon d={CHECK} size={13} />}
                </span>
              </button>
            ))}
          </div>
        </>
      )}
      {props.problem !== null && (
        <p className={styles.problem} role="alert">
          {props.problem}
        </p>
      )}
      <button className={styles.primary} type="button" disabled={props.busy || left === 0} onClick={props.onPay}>
        {free ? copy.confirm : copy.pay(rupees(hold.price.amount))}
      </button>
      {!free && <p className={styles.moneyNote}>{copy.neverHandlesMoney(technician)}</p>}
    </>
  );
}

/** Board C6: the payment failed, and the hold's time left. */
export function FailedStep({ hold, onRetry, onAnother }: { hold: Hold; onRetry: () => void; onAnother: () => void }) {
  const copy = booking.failed;
  const left = useHoldLeft(hold);
  return (
    <div role="alert">
      <p className={styles.caption}>{copy.label}</p>
      <div className={styles.failed}>
        <p className={styles.outcome}>{copy.title}</p>
        <p className={styles.outcomeLine}>{copy.held(minutesAndSeconds(left))}</p>
      </div>
      <div className={styles.pair}>
        <button className={styles.primary} type="button" onClick={onRetry}>
          {copy.retry}
        </button>
        <button className={styles.secondary} type="button" onClick={onAnother}>
          {copy.another}
        </button>
      </div>
    </div>
  );
}

/** Board C6: the hold lapsed before the payment. */
export function ExpiredStep({ onPickAgain }: { onPickAgain: () => void }) {
  return (
    <div role="alert">
      <p className={styles.outcome}>{booking.expired.title}</p>
      <button className={styles.primary} type="button" onClick={onPickAgain}>
        {booking.expired.pickAgain}
      </button>
    </div>
  );
}

/** Board C6: booked. */
export function ConfirmedStep({ hold, onDone }: { hold: Hold; onDone: () => void }) {
  const copy = booking.confirmed;
  const technician = firstName(hold.technician.name);
  const when = `${weekdayDate(hold.date)}, ${WINDOW_HOURS[hold.window]}`;
  return (
    <div className={styles.confirmed} role="status">
      <p className={styles.confirmedLabel}>{copy.label}</p>
      <Icon className={styles.confirmedTick} d={ICONS.tick} size={26} />
      <p className={styles.confirmedTitle}>{when}</p>
      <p className={styles.confirmedLine}>{copy.tellsYou(technician)}</p>
      {hold.price.amount > 0 && (
        <p className={styles.paid}>
          <span>{copy.paid}</span>
          <span className={styles.paidAmount}>{rupees(hold.price.amount)}</span>
        </p>
      )}
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
      <p className={styles.outcome}>{text}</p>
      {onClose !== undefined && (
        <button className={styles.secondary} type="button" onClick={onClose}>
          {booking.close}
        </button>
      )}
    </div>
  );
}
