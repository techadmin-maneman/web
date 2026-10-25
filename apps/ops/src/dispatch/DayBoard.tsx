// The board's day along the hours (./DispatchScreen.tsx), which it opens on: each technician's visits that day, done,
// under way or late marked, and where their phone last put them; a visit opens its drawer. While a job is in hand,
// each start it could take there is a button that places it, the start chosen (./day-cells.ts).

import { DayTimeline, type TimelineCell, type TimelineLook } from "@maneman/ui/DayTimeline";
import { Field, Select } from "@maneman/ui/Field";
import { TabButton, Tabs } from "@maneman/ui/Tabs";
import { TextButton } from "@maneman/ui/TextLink";
import { VisuallyHidden } from "@maneman/ui/VisuallyHidden";
import { dayClock, indiaClock, shortDate } from "@maneman/web-kit/dates";
import type { Block, Board, BoardRow } from "../api.ts";
import { dispatch } from "../content.ts";
import { cellsOf, minuteOfDay, stepsOf } from "./day-cells.ts";
import type { Job, Target } from "./job.ts";
import { minutesOf } from "./job.ts";
import type { InHand } from "./MoveBar.tsx";
import styles from "./dispatch.module.css";

const copy = dispatch.day;

type Start = NonNullable<ReturnType<InHand["startsAt"]>>[number];

interface Visit {
  readonly from: number;
  readonly to: number;
  readonly block: Block;
}

/** How a visit reads on the day: done, under way, past its start with nobody there yet, or booked. */
function lookOf(block: Block, now: number): TimelineLook {
  if (block.status === "completed" || block.begun === "closed") return "done";
  if (block.begun === "arrived" || block.begun === "started") return "underway";
  const waiting = block.status === "scheduled" || block.status === "dispatched";
  return waiting && Date.parse(block.starts_at) < now ? "late" : "busy";
}

/** Where the technician's phone last put them that day: the latest visit they arrived at, started or closed. */
function lastAt(blocks: readonly Block[]): string | null {
  const begun = blocks.filter((block) => block.begun !== null).sort((a, b) => b.starts_at.localeCompare(a.starts_at));
  const [latest] = begun;
  if (latest?.begun === undefined || latest.begun === null) return null;
  return copy.at[latest.begun](latest.client ?? dispatch.unknown);
}

const hourLabel = (minute: number) => (minute % 60 === 0 ? dayClock(`${String(minute / 60).padStart(2, "0")}:00`) : "");

interface Props {
  readonly board: Board;
  readonly rows: readonly BoardRow[];
  readonly date: string;
  readonly inHand: InHand | null;
  readonly now: number;
  readonly onOpen: (job: Job, from: HTMLElement) => void;
  readonly onLand: (to: Target) => void;
}

function rowCells(props: Props, row: BoardRow, steps: readonly number[], visits: readonly Visit[]): TimelineCell[] {
  const starts = (props.inHand?.startsAt(row.technician_id, props.date) ?? []).map((start: Start) => ({
    ...start,
    at: minuteOfDay(start.starts_at),
  }));
  return cellsOf(steps, visits, starts).map((cell): TimelineCell => {
    const key = `${row.technician_id}/${String(cell.from)}`;
    if (cell.kind === "idle") return { key, span: cell.span, look: "idle" };
    if (cell.kind === "free") {
      const time = indiaClock(cell.free.starts_at);
      const to = { technician: row, date: props.date, window: cell.free.window, start: cell.free.starts_at };
      return {
        key,
        span: 1,
        look: "free",
        children: (
          <TextButton
            compact
            onClick={() => {
              props.onLand(to);
            }}
          >
            {time}
            <VisuallyHidden>{` · ${copy.placeLabel(time, row.name)}`}</VisuallyHidden>
          </TextButton>
        ),
      };
    }
    const { block } = cell.busy;
    const job = { kind: "block", block, technician: row, date: props.date } as const;
    const kind = block.type === null ? dispatch.unknown : dispatch.typeNames[block.type];
    return {
      key,
      span: cell.span,
      look: lookOf(block, props.now),
      children: (
        <span className={styles.dayVisit}>
          <TextButton
            compact
            onClick={(event) => {
              props.onOpen(job, event.currentTarget);
            }}
          >
            {block.client ?? dispatch.unknown}
          </TextButton>
          <span className={styles.dayVisitWhat}>{`${indiaClock(block.starts_at)} · ${kind}`}</span>
        </span>
      ),
    };
  });
}

export function DayBoard(props: Props) {
  const blocksOf = (row: BoardRow) => row.days.find((day) => day.date === props.date)?.blocks ?? [];
  const visitsOf = (row: BoardRow): Visit[] =>
    blocksOf(row).map((block) => {
      const from = minuteOfDay(block.starts_at);
      return { from, to: from + minutesOf(block.slots), block };
    });
  const steps = stepsOf(props.rows.flatMap(visitsOf));
  const rows = props.rows.map((row) => {
    const at = lastAt(blocksOf(row));
    return {
      key: row.technician_id,
      head: (
        <span className={styles.dayHead}>
          <span>{row.name}</span>
          {at !== null && <span className={styles.dayVisitWhat}>{at}</span>}
        </span>
      ),
      cells: rowCells(props, row, steps, visitsOf(row)),
    };
  });
  const label = copy.label(shortDate(props.date));
  return (
    <>
      <VisuallyHidden as="h2" id="day-board">
        {label}
      </VisuallyHidden>
      <DayTimeline
        label={label}
        labelledBy="day-board"
        steps={steps.map((minute) => ({ key: String(minute), label: hourLabel(minute) }))}
        rows={rows}
      />
    </>
  );
}

export type BoardView = "day" | "week";

/**
 * The board's view as it opens: the day, unless the address names a week, a visit or a search, which the week shows
 * whole, or a view of its own.
 */
export const firstView = (asked: {
  readonly view: BoardView | null;
  readonly from: string | null;
  readonly visit: string | null;
  readonly find: string;
}): BoardView => asked.view ?? (asked.from !== null || asked.visit !== null || asked.find !== "" ? "week" : "day");

/** The day the Day view shows: the one chosen while the week holds it, else today, else the week's first. */
export function shownDay(dates: readonly string[], chosen: string | null, today: string): string | undefined {
  if (chosen !== null && dates.includes(chosen)) return chosen;
  return dates.includes(today) ? today : dates[0];
}

/** Day or Week, and in the Day view, which of the week's days. */
export function ViewChoice(props: {
  readonly view: BoardView;
  readonly onView: (view: BoardView) => void;
  readonly dates: readonly string[];
  readonly day: string | undefined;
  readonly onDay: (day: string) => void;
}) {
  const views = dispatch.views;
  return (
    <div className={styles.viewChoice}>
      <Tabs label={views.label}>
        {(["day", "week"] as const).map((each) => (
          <TabButton
            key={each}
            current={props.view === each}
            onClick={() => {
              props.onView(each);
            }}
          >
            {views[each]}
          </TabButton>
        ))}
      </Tabs>
      {props.view === "day" && props.day !== undefined && (
        <Field label={copy.choose} labelHidden>
          {(control) => (
            <Select
              {...control}
              width="choice"
              value={props.day}
              onChange={(event) => {
                props.onDay(event.currentTarget.value);
              }}
            >
              {props.dates.map((date) => (
                <option key={date} value={date}>
                  {shortDate(date)}
                </option>
              ))}
            </Select>
          )}
        </Field>
      )}
    </div>
  );
}
