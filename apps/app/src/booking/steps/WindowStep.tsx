// Board C3: the window.

import { classes } from "@maneman/ui/classes";
import { Button } from "@maneman/ui/Button";
import { weekdayDate } from "@maneman/web-kit/dates";
import type { Availability, BookingWindow } from "../../api.ts";
import { booking, WINDOW_HOURS, WINDOW_NAMES } from "../../content.ts";
import { windowContinue, windowNote, type Day } from "../days.ts";
import styles from "../booking.module.css";
import { firstNameOf } from "../../../../../src/lib/names.ts";
import { TITLE_ID, stepOf, Heading } from "./shared.tsx";

/**
 * Board C3: the day's windows the visit can start in, and who would come: the regular technician by name, or another
 * where the client has a regular one. A client who has none is told nothing of who. A window inside the notice is
 * marked, and a day that costs nothing goes on to a confirmation, not a payment.
 */
export function WindowStep(props: {
  before: number;
  day: Day;
  noticeHours: number;
  regular: Availability["regular"];
  chosen: BookingWindow | null;
  busy: boolean;
  problem: string | null;
  onChoose: (window: BookingWindow) => void;
  onNext: () => void;
}) {
  const copy = booking.window;
  const regularName = props.regular === null ? null : firstNameOf(props.regular.name);
  const chosen = props.day.windows.find((each) => each.window === props.chosen);

  return (
    <>
      <Heading title={copy.title} step={stepOf(2, props.before)} />
      <p className={styles.dayLine}>{weekdayDate(props.day.date)}</p>
      <div className={styles.windows} role="radiogroup" aria-labelledby={TITLE_ID}>
        {props.day.windows.map(({ window, with: who, change_charged: changeCharged }) => {
          const note = windowNote(who, regularName);
          return (
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
                {who !== null && changeCharged && (
                  <span className={classes(styles.windowTime, styles.windowLate)}>
                    {copy.within(props.noticeHours)}
                  </span>
                )}
              </span>
              {note !== null && <span className={styles.windowNote}>{note}</span>}
            </label>
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
