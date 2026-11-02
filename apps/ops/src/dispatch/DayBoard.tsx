// The board's day along the hours (./DispatchScreen.tsx), which it opens on: the visits nobody is on, pinned at the top;
// then each technician's visits that day in their kind's look, done, under way or late marked, beneath their name the
// visits and hours booked and how full the day is, a day off as a band; the hour it is now marked down the day. A visit
// opens its drawer. While a job is in hand, each start it could take is a button that places it (../lib/day-cells.ts).

import {
  DayTimeline,
  type TimelineCell,
  type TimelineKind,
  type TimelineLook,
  type TimelineRow,
} from "@maneman/ui/DayTimeline";
import { TextButton } from "@maneman/ui/TextLink";
import { VisuallyHidden } from "@maneman/ui/VisuallyHidden";
import { indiaClock, indiaDate, shortDate } from "@maneman/web-kit/dates";
import type { Block, Board, BoardRow, Unassigned } from "../api.ts";
import { dispatch, tasks } from "../content.ts";
import { cellsOf, hourLabel, minuteOfDay, stepsOf } from "../lib/day-cells.ts";
import type { Job, Target } from "./job.ts";
import { minutesOf } from "./job.ts";
import type { InHand } from "./MoveBar.tsx";
import styles from "./dispatch.module.css";

const copy = dispatch.day;

/** How long a step of the day is, in minutes (../lib/day-cells.ts). */
const STEP_MINUTES = 30;

const KIND_OF: Readonly<Record<NonNullable<Block["type"]>, TimelineKind>> = {
  consultation: "consultation",
  service: "service",
  replacement: "replacement",
  first_fit: "fit",
};

const kindOf = (type: Block["type"]): TimelineKind | undefined => (type === null ? undefined : KIND_OF[type]);

type Start = NonNullable<ReturnType<InHand["startsAt"]>>[number];

interface Visit {
  readonly from: number;
  readonly to: number;
  readonly block: Block;
  /** For a visit drawn where a proposed move would take it: whose it is now, and its day, which its drawer opens on. */
  readonly ghostOf?: { readonly technician: BoardRow; readonly date: string };
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
    const { block, ghostOf } = cell.busy;
    const job = {
      kind: "block",
      block,
      technician: ghostOf?.technician ?? row,
      date: ghostOf?.date ?? props.date,
    } as const;
    const kind = block.type === null ? dispatch.unknown : dispatch.typeNames[block.type];
    const at = indiaClock(ghostOf === undefined ? block.starts_at : (block.proposal?.starts_at ?? block.starts_at));
    return {
      key,
      span: cell.span,
      look: ghostOf === undefined ? lookOf(block, props.now) : "proposed",
      kind: ghostOf === undefined ? kindOf(block.type) : undefined,
      children: (
        <span className={styles.dayVisit}>
          <TextButton
            compact
            onClick={(event) => {
              props.onOpen(job, event.currentTarget);
            }}
          >
            {block.client ?? dispatch.unknown}
            {ghostOf !== undefined && <VisuallyHidden>{`, ${dispatch.chips.proposed}`}</VisuallyHidden>}
          </TextButton>
          <span className={styles.dayVisitWhat}>
            {ghostOf === undefined ? `${at} · ${kind}` : `${at} · ${dispatch.chips.proposed}`}
          </span>
        </span>
      ),
    };
  });
}

/** The visits nobody is on that day, pinned at the top in the warning's tone; each opens its drawer. */
function nobodyRow(props: Props, steps: readonly number[], jobs: readonly Unassigned[]): TimelineRow {
  const spans = jobs.map((job) => {
    const from = minuteOfDay(job.starts_at);
    return { from, to: from + minutesOf(job.slots), job };
  });
  return {
    key: "nobody",
    head: tasks.groups.unassigned_visit,
    meta: copy.nobodyMeta(jobs.length),
    tone: "warning",
    cells: cellsOf(steps, spans, []).map((cell): TimelineCell => {
      const key = `nobody/${String(cell.from)}`;
      if (cell.kind !== "busy") return { key, span: cell.span, look: "idle" };
      const { job } = cell.busy;
      const kind = job.type === null ? dispatch.unknown : dispatch.typeNames[job.type];
      return {
        key,
        span: cell.span,
        look: "unassigned",
        children: (
          <span className={styles.dayVisit}>
            <TextButton
              compact
              onClick={(event) => {
                props.onOpen({ kind: "unassigned", job }, event.currentTarget);
              }}
            >
              {job.client ?? dispatch.unknown}
            </TextButton>
            <span className={styles.dayVisitWhat}>{`${indiaClock(job.starts_at)} · ${kind}`}</span>
          </span>
        ),
      };
    }),
  };
}

/** The step it is now, on today's day; null on any other. */
function nowStep(steps: readonly number[], date: string, now: number): string | null {
  const iso = new Date(now).toISOString();
  if (indiaDate(iso) !== date) return null;
  const minute = minuteOfDay(iso);
  const step = [...steps].reverse().find((each) => each <= minute);
  return step === undefined || minute >= (steps.at(-1) ?? 0) + STEP_MINUTES ? null : String(step);
}

export function DayBoard(props: Props) {
  const blocksOf = (row: BoardRow) => row.days.find((day) => day.date === props.date)?.blocks ?? [];
  // The visits a proposed move would bring to this day, on the technician it would go to, until the client answers.
  const ghosts = props.board.technicians.flatMap((technician) =>
    technician.days.flatMap((day) =>
      day.blocks.flatMap((block) => {
        const proposal = block.proposal;
        if (proposal?.date !== props.date || proposal.starts_at === null) return [];
        const from = minuteOfDay(proposal.starts_at);
        const visit: Visit = {
          from,
          to: from + minutesOf(block.slots),
          block,
          ghostOf: { technician, date: day.date },
        };
        return [{ on: proposal.technician_id, visit }];
      }),
    ),
  );
  const visitsOf = (row: BoardRow): Visit[] => [
    ...blocksOf(row).map((block) => {
      const from = minuteOfDay(block.starts_at);
      return { from, to: from + minutesOf(block.slots), block };
    }),
    ...ghosts.filter((ghost) => ghost.on === row.technician_id).map((ghost) => ghost.visit),
  ];
  const nobody = props.board.unassigned.filter((job) => (job.date ?? indiaDate(job.starts_at)) === props.date);
  const nobodySpans = nobody.map((job) => {
    const from = minuteOfDay(job.starts_at);
    return { from, to: from + minutesOf(job.slots) };
  });
  const steps = stepsOf([...props.rows.flatMap(visitsOf), ...nobodySpans]);
  const dayMinutes = steps.length * STEP_MINUTES;
  const rows: TimelineRow[] = props.rows.map((row) => {
    const visits = visitsOf(row).filter((visit) => visit.ghostOf === undefined);
    const booked = visits.reduce((sum, visit) => sum + visit.to - visit.from, 0);
    const at = lastAt(blocksOf(row));
    const away = props.board.leave.some(
      (leave) =>
        leave.technician_id === row.technician_id &&
        leave.from <= props.date &&
        props.date <= leave.to &&
        leave.from_time === null,
    );
    return {
      key: row.technician_id,
      head: row.name,
      meta: at ?? copy.rowMeta(row.zone, visits.length, booked),
      load: dayMinutes === 0 ? 0 : booked / dayMinutes,
      cells:
        away && visits.length === 0
          ? [{ key: `${row.technician_id}/away`, span: steps.length, look: "leave", children: dispatch.board.away }]
          : rowCells(props, row, steps, visitsOf(row)),
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
        rows={nobody.length === 0 ? rows : [nobodyRow(props, steps, nobody), ...rows]}
        now={nowStep(steps, props.date, props.now)}
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
