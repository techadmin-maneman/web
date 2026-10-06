// Board C3: the window.

import { classes } from "@maneman/ui/classes";
import { Button } from "@maneman/ui/Button";
import { weekdayDate } from "@maneman/web-kit/dates";
import type { BookingWindow } from "../../api.ts";
import { booking, WINDOW_HOURS, WINDOW_NAMES } from "../../content.ts";
import { windowContinue, type Day } from "../days.ts";
import styles from "../booking.module.css";
import { TITLE_ID, stepOf, Heading } from "./shared.tsx";

/**
 * Board C3: the day's windows the visit can start in, open or full. Who comes is never promised: a technician never
 * takes two of a client's visits in a row (docs/decisions/0111-a-technician-never-takes-two-visits-in-a-row.md). A
 * window inside the notice is marked, and a day that costs nothing goes on to a confirmation, not a payment.
 */
export function WindowStep(props: {
  before: number;
  day: Day;
  noticeHours: number;
  chosen: BookingWindow | null;
  busy: boolean;
  problem: string | null;
  onChoose: (window: BookingWindow) => void;
  onNext: () => void;
}) {
  const copy = booking.window;

  return (
    <>
      <Heading title={copy.title} step={stepOf(2, props.before)} />
      <p className={styles.dayLine}>{weekdayDate(props.day.date)}</p>
      <div className={styles.windows} role="radiogroup" aria-labelledby={TITLE_ID}>
        {props.day.windows.map(({ window, open, change_charged: changeCharged }) => {
          return (
            <label key={window} className={styles.window}>
              <input
                className={styles.radio}
                type="radio"
                name="booking-window"
                checked={window === props.chosen}
                disabled={!open}
                onChange={() => {
                  props.onChoose(window);
                }}
              />
              <span>
                <span className={styles.windowName}>{WINDOW_NAMES[window]}</span>
                <span className={styles.windowTime}>{WINDOW_HOURS[window]}</span>
                {open && changeCharged && (
                  <span className={classes(styles.windowTime, styles.windowLate)}>
                    {copy.within(props.noticeHours)}
                  </span>
                )}
              </span>
              {!open && <span className={styles.windowNote}>{copy.full}</span>}
            </label>
          );
        })}
      </div>
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
        {windowContinue(props.day)}
      </Button>
    </>
  );
}
