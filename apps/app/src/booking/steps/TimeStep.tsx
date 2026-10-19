// The time (docs/decisions/0210-booking-by-start-time.md).

import { Button } from "@maneman/ui/Button";
import { TimeChoice } from "@maneman/ui/TimeChoice";
import { dayClock, indiaClock, weekdayDate } from "@maneman/web-kit/dates";
import { lengthWords } from "@maneman/web-kit/visit-length";
import { BOOKING_WINDOW_ORDER, booking, WINDOW_NAMES } from "../../content.ts";
import { timeContinue, type Day } from "../days.ts";
import styles from "../booking.module.css";
import { TITLE_ID, stepOf, Heading } from "./shared.tsx";

const copy = booking.window;

/**
 * The day's starts a step apart, under its morning, afternoon and evening, open or taken. Who comes is never promised:
 * a technician never takes two of a client's visits in a row (docs/decisions/0111-a-technician-never-takes-two-visits-in-a-row.md).
 * The time chosen says when the technician arrives by, and a time inside the notice is marked.
 */
export function TimeStep(props: {
  before: number;
  day: Day;
  minutes: number;
  noticeHours: number;
  chosen: string | null;
  busy: boolean;
  problem: string | null;
  onChoose: (startsAt: string) => void;
  onNext: () => void;
}) {
  const { day } = props;
  const periods = BOOKING_WINDOW_ORDER.map((window) => {
    const hours = day.windows.find((each) => each.window === window);
    const inside = day.starts.filter(
      (start) => hours !== undefined && start.time >= hours.start && start.time < hours.end,
    );
    return {
      name: WINDOW_NAMES[window],
      times: inside.map((start) => ({ id: start.starts_at, label: dayClock(start.time), open: start.open })),
    };
  });
  const chosen = day.starts.find((start) => start.starts_at === props.chosen);

  return (
    <>
      <Heading title={copy.title} step={stepOf(2, props.before)} />
      <p className={styles.dayLine}>{weekdayDate(day.date)}</p>
      <p className={styles.dayLine}>{copy.takes(lengthWords(props.minutes))}</p>
      <TimeChoice
        name="booking-time"
        labelledBy={TITLE_ID}
        periods={periods}
        chosen={props.chosen}
        fullWord={copy.fullyBooked}
        takenWord={copy.taken}
        onChoose={props.onChoose}
      />
      {chosen !== undefined && (
        <p className={styles.dayLine} role="status">
          {copy.arrives(indiaClock(chosen.starts_at), indiaClock(chosen.arrives_by))}
          {chosen.change_charged && <span className={styles.late}>{` ${copy.within(props.noticeHours)}`}</span>}
        </p>
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
        {timeContinue(day)}
      </Button>
    </>
  );
}
