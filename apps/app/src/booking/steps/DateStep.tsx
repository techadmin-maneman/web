// The date.

import { classes } from "@maneman/ui/classes";
import { Button } from "@maneman/ui/Button";
import { weekdayDate } from "@maneman/web-kit/dates";
import { booking } from "../../content.ts";
import { dayInsideNotice, isFull, offeredFullLine, type Day } from "../days.ts";
import styles from "../booking.module.css";
import { TITLE_ID, DAY_NAMES, stepOf, Heading } from "./shared.tsx";

/** A day as a screen reader names it: its date, and whether it is full or inside the notice. */
function dayLabel(day: Day, noticeHours: number): string {
  const copy = booking.date;
  if (isFull(day)) return `${weekdayDate(day.date)}, ${copy.full}`;
  if (dayInsideNotice(day)) return `${weekdayDate(day.date)}, ${copy.within(noticeHours)}`;
  return weekdayDate(day.date);
}

/** Later days, up to the last a visit may be booked on: asking for them, and whether that failed. */
interface LaterDays {
  readonly busy: boolean;
  readonly failed: boolean;
  readonly onShow: () => void;
}

/**
 * Fourteen days, full ones shown but not chosen, those with a window inside the notice marked, and later
 * ones added beneath them on asking. The days are one group of native radio buttons, drawn as the design's squares:
 * one tab stop, and the arrow keys move between the days. `before`: the steps the sheet took before the date.
 * `offered`: the day the visit is offered on.
 */
export function DateStep(props: {
  before: number;
  days: readonly Day[];
  noticeHours: number;
  offered: string | null;
  chosen: string | null;
  /** Null when no later day may be booked. */
  later: LaterDays | null;
  onChoose: (date: string) => void;
  onNext: () => void;
}) {
  const copy = booking.date;
  const fullLine = offeredFullLine(props.days, props.offered, props.chosen);
  const anyInsideNotice = props.days.some(dayInsideNotice);
  return (
    <>
      <Heading title={copy.title} step={stepOf(1, props.before)} />
      {fullLine !== null && <p className={styles.why}>{fullLine}</p>}
      <div className={styles.strip} role="radiogroup" aria-labelledby={TITLE_ID}>
        {props.days.map((day) => {
          const weekday = DAY_NAMES[new Date(`${day.date}T00:00:00Z`).getUTCDay()] ?? "";
          return (
            <label key={day.date} className={styles.day}>
              <input
                className={styles.radio}
                type="radio"
                name="booking-date"
                checked={day.date === props.chosen}
                disabled={isFull(day)}
                aria-label={dayLabel(day, props.noticeHours)}
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
              {dayInsideNotice(day) && <span className={styles.dayLate} aria-hidden="true" />}
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
          <span className={classes(styles.swatch, styles.swatchFull)} />
          {copy.full}
        </span>
        {anyInsideNotice && (
          <span>
            <span className={styles.swatchLate} />
            {copy.within(props.noticeHours)}
          </span>
        )}
      </div>
      {props.later !== null && (
        <Button
          variant="outline"
          size="control"
          className={styles.secondary}
          disabled={props.later.busy}
          busy={props.later.busy}
          onClick={props.later.onShow}
        >
          {copy.later}
        </Button>
      )}
      {props.later?.failed === true && (
        <p className={styles.problem} role="alert">
          {copy.laterFailed}
        </p>
      )}
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
