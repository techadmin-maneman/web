// The date.

import { classes } from "@maneman/ui/classes";
import { Button } from "@maneman/ui/Button";
import { DateStrip, type DateStripClasses, type StripDate } from "@maneman/ui/DateStrip";
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

const DATE_CLASSES: DateStripClasses = {
  strip: styles.strip,
  day: styles.day,
  radio: styles.radio,
  weekday: styles.weekday,
  number: styles.number,
  mark: styles.dayLate,
};

/** A day as the strip draws it: full ones drawn but not chosen, those with a window inside the notice marked. */
function stripDate(day: Day, noticeHours: number): StripDate {
  return {
    date: day.date,
    weekday: DAY_NAMES[new Date(`${day.date}T00:00:00Z`).getUTCDay()] ?? "",
    number: String(Number(day.date.slice(8))),
    label: dayLabel(day, noticeHours),
    open: !isFull(day),
    marked: dayInsideNotice(day),
  };
}

/** Later days, up to the last a visit may be booked on: asking for them, and whether that failed. */
interface LaterDays {
  readonly busy: boolean;
  readonly failed: boolean;
  readonly onShow: () => void;
}

/**
 * Fourteen days, full ones shown but not chosen, those with a window inside the notice marked, and later
 * ones added beneath them on asking. `before`: the steps the sheet took before the date.
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
      <DateStrip
        name="booking-date"
        labelledBy={TITLE_ID}
        days={props.days.map((day) => stripDate(day, props.noticeHours))}
        chosen={props.chosen}
        onChoose={props.onChoose}
        classes={DATE_CLASSES}
      />
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
