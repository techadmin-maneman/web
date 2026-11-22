// The day and the time on it, on one screen, as the design draws them (docs/decisions/0210-booking-by-start-time.md):
// the earliest open time to take at a tap, the days in a row that scrolls, each with how many times are left, and the
// day's times under its morning, afternoon and evening. Who comes is never promised: a technician never takes two of
// a client's visits in a row (docs/decisions/0111-a-technician-never-takes-two-visits-in-a-row.md).

import { CLIENT_ICONS, GLYPHS, ICONS } from "@maneman/brand/icons";
import { classes } from "@maneman/ui/classes";
import { DateStrip, type StripDate } from "@maneman/ui/DateStrip";
import { Icon } from "@maneman/ui/Icon";
import { ListRow, ListRows } from "@maneman/ui/ListRow";
import { describedBy, Missing } from "@maneman/ui/Missing";
import { TextButton } from "@maneman/ui/TextLink";
import { TimeChoice } from "@maneman/ui/TimeChoice";
import { dayClock, fullMonth, indiaClock, shortDate, weekdayDate } from "@maneman/web-kit/dates";
import { Button } from "@maneman/ui/Button";
import type { ReactNode } from "react";
import type { Availability } from "../../api.ts";
import { arrivalHours, BOOKING_WINDOW_ORDER, booking, missing, WINDOW_NAMES } from "../../content.ts";
import { earliestOpen, isFull, offeredFullLine, openStarts, type Day } from "../days.ts";
import styles from "../booking.module.css";
import { DAY_NAMES, Frame, type StepAt } from "./shared.tsx";

const copy = booking.when;
const MONTH_ID = "booking-month";

/** A day as the strip draws it: how many of its times are left, or that it is full, which cannot be chosen. */
function stripDate(day: Day): StripDate {
  const left = openStarts(day);
  return {
    date: day.date,
    weekday: DAY_NAMES[new Date(`${day.date}T00:00:00Z`).getUTCDay()] ?? "",
    number: String(Number(day.date.slice(8))),
    label: left === 0 ? `${weekdayDate(day.date)}, ${copy.full}` : `${weekdayDate(day.date)}, ${copy.left(left)}`,
    open: left > 0,
    note: left === 0 ? copy.full : copy.left(left),
  };
}

/** The day's starts under its parts of the day, open or taken. */
function periodsOf(day: Day) {
  return BOOKING_WINDOW_ORDER.map((window) => {
    const hours = day.windows.find((each) => each.window === window);
    const inside = day.starts.filter(
      (start) => hours !== undefined && start.time >= hours.start && start.time < hours.end,
    );
    return {
      name: WINDOW_NAMES[window],
      // The day's starts that add least driving say so (docs/decisions/0293-steering-booking-times.md).
      times: inside.map((start) => ({
        id: start.starts_at,
        label: dayClock(start.time),
        open: start.open,
        note: start.recommended ? copy.recommended : undefined,
      })),
    };
  });
}

/** How many minutes after the time picked the technician may arrive: the same for every start. */
function arrivalMinutes(days: readonly Day[]): number | null {
  const start = days.find((day) => day.starts.length > 0)?.starts[0];
  if (start === undefined) return null;
  return Math.round((Date.parse(start.arrives_by) - Date.parse(start.starts_at)) / 60_000);
}

/** Later days, up to the last a visit may be booked on: asking for them, and whether that failed. */
export interface LaterDays {
  readonly busy: boolean;
  readonly failed: boolean;
  readonly onShow: () => void;
}

/** "Earliest: Tue 18 Nov, 9:30 am", taken at a tap. */
function Earliest({ days, onChoose }: { days: readonly Day[]; onChoose: (date: string, startsAt: string) => void }) {
  const earliest = earliestOpen(days);
  if (earliest === null) return null;
  return (
    <ListRows className={styles.suggest}>
      <ListRow
        icon={GLYPHS.clock}
        title={copy.earliest(shortDate(earliest.date), indiaClock(earliest.start.starts_at))}
        meta={copy.tapToChoose}
        chevron
        onClick={() => {
          onChoose(earliest.date, earliest.start.starts_at);
        }}
      />
    </ListRows>
  );
}

/** The time picked and when the technician arrives, over Continue, with what holding it went wrong with. */
function WhenFooter(props: {
  day: Day | undefined;
  chosen: string | null;
  noticeHours: number;
  busy: boolean;
  problem: string | null;
  onNext: () => void;
}) {
  const start = props.day?.starts.find((each) => each.starts_at === props.chosen);
  return (
    <>
      {start !== undefined && props.day !== undefined && (
        <p className={styles.summary} role="status">
          {copy.summary(shortDate(props.day.date), arrivalHours(start))}
          {start.change_charged && <span className={styles.late}>{` ${copy.within(props.noticeHours)}`}</span>}
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
        aria-describedby={describedBy("pick-time", props.chosen === null)}
        busy={props.busy}
        onClick={props.onNext}
      >
        {copy.continue}
      </Button>
      <Missing id="pick-time" what={props.chosen === null ? missing.pickTime : null} />
    </>
  );
}

/** What moving the visit costs, over the days: in the error's tone where the move is charged. */
function MoveNotice({ line, charged }: { line: ReactNode; charged: boolean }) {
  return (
    <div className={classes(styles.notice, charged && styles.noticeError)}>
      <Icon className={styles.noticeIcon} d={charged ? CLIENT_ICONS.alert : ICONS.tick} size="md" />
      <p>{line}</p>
    </div>
  );
}

/** The month, the days in a row that scrolls, and the times on the day chosen. */
function DayAndTimes(props: {
  days: readonly Day[];
  date: string | null;
  chosenStart: string | null;
  later: LaterDays | null;
  onChooseDate: (date: string) => void;
  onChooseStart: (startsAt: string) => void;
}) {
  const { days } = props;
  const day = days.find((each) => each.date === props.date);
  const month = day?.date ?? days[0]?.date;
  return (
    <>
      <div className={styles.monthRow}>
        {month !== undefined && (
          <p className={styles.month} id={MONTH_ID}>
            {fullMonth(month.slice(0, 7))}
          </p>
        )}
        {props.later !== null && (
          <TextButton tone="plain" disabled={props.later.busy} onClick={props.later.onShow}>
            {copy.later}
          </TextButton>
        )}
      </div>
      <DateStrip
        name="booking-date"
        scrolls
        className={styles.strip}
        labelledBy={MONTH_ID}
        days={days.map(stripDate)}
        chosen={props.date}
        onChoose={props.onChooseDate}
      />
      {props.later?.failed === true && (
        <p className={styles.problem} role="alert">
          {copy.laterFailed}
        </p>
      )}
      {day !== undefined && !isFull(day) && (
        <TimeChoice
          name="booking-time"
          className={styles.times}
          labelledBy={MONTH_ID}
          periods={periodsOf(day)}
          chosen={props.chosenStart}
          fullWord={copy.fullyBooked}
          openWord={copy.open}
          takenWord={copy.taken}
          onChoose={props.onChooseStart}
        />
      )}
    </>
  );
}

export function WhenStep(props: {
  title: string;
  step: StepAt;
  onBack: (() => void) | undefined;
  onClose: () => void;
  availability: Availability;
  /** What moving the visit costs, for a move; `charged`: the move costs the client. */
  moveNotice: { readonly line: ReactNode; readonly charged: boolean } | null;
  /** Why the days open later than the visit's own first day: its hair system not in stock in the client's size. */
  stockNote: string | null;
  /** The day the visit is offered on. */
  offered: string | null;
  date: string | null;
  chosenStart: string | null;
  /** Null when no later day may be booked. */
  later: LaterDays | null;
  busy: boolean;
  problem: string | null;
  onChooseDate: (date: string) => void;
  onChooseStart: (startsAt: string) => void;
  onEarliest: (date: string, startsAt: string) => void;
  onNext: () => void;
}) {
  const { availability } = props;
  const { days } = availability;
  const fullLine = offeredFullLine(days, props.offered, props.date);
  const minutes = arrivalMinutes(days);
  return (
    <Frame
      title={props.title}
      step={props.step}
      onBack={props.onBack}
      onClose={props.onClose}
      footer={
        <WhenFooter
          day={days.find((each) => each.date === props.date)}
          chosen={props.chosenStart}
          noticeHours={availability.change_notice_hours}
          busy={props.busy}
          problem={props.problem}
          onNext={props.onNext}
        />
      }
    >
      {props.moveNotice !== null && <MoveNotice {...props.moveNotice} />}
      {props.stockNote !== null && (
        <div className={styles.notice}>
          <Icon className={styles.noticeIcon} d={CLIENT_ICONS.layers} size="md" />
          <p>{props.stockNote}</p>
        </div>
      )}
      {fullLine !== null && <p className={styles.why}>{fullLine}</p>}
      <Earliest days={days} onChoose={props.onEarliest} />
      <DayAndTimes
        days={days}
        date={props.date}
        chosenStart={props.chosenStart}
        later={props.later}
        onChooseDate={props.onChooseDate}
        onChooseStart={props.onChooseStart}
      />
      {minutes !== null && <p className={styles.arrival}>{copy.arrival(minutes)}</p>}
    </Frame>
  );
}
