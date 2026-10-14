// The window.

import { Button } from "@maneman/ui/Button";
import { WindowChoice } from "@maneman/ui/WindowChoice";
import { weekdayDate } from "@maneman/web-kit/dates";
import type { BookingWindow } from "../../api.ts";
import { booking, WINDOW_NAMES, windowHours } from "../../content.ts";
import { windowContinue, type Day } from "../days.ts";
import styles from "../booking.module.css";
import { TITLE_ID, stepOf, Heading } from "./shared.tsx";

/**
 * The day's windows the visit can start in, open or full. Who comes is never promised: a technician never
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
      <WindowChoice
        name="booking-window"
        labelledBy={TITLE_ID}
        options={props.day.windows.map(({ window, open, change_charged: changeCharged, start, end }) => ({
          id: window,
          name: WINDOW_NAMES[window],
          hours: windowHours({ start, end }),
          open,
          note: open && changeCharged ? copy.within(props.noticeHours) : undefined,
        }))}
        chosen={props.chosen}
        fullWord={copy.full}
        onChoose={props.onChoose}
      />
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
