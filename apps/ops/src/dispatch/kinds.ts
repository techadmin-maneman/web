// The board's visits by kind: a consultation and fit in one visit is a kind of its own beside the
// four types, and ops may show one kind alone on the day and the week.

import type { TimelineKind } from "@maneman/ui/DayTimeline";
import { indiaDate } from "@maneman/web-kit/dates";
import type { Block, Board, BoardRow } from "../api.ts";

export const BOARD_KINDS = ["all", "service", "consultation", "one_visit", "first_fit", "replacement"] as const;
export type BoardKind = (typeof BOARD_KINDS)[number];
type VisitKind = Exclude<BoardKind, "all">;

/** A visit's kind on the board: a consultation and fit in one visit apart from both. */
export const kindOfBlock = (block: Pick<Block, "type" | "one_visit">): VisitKind | null =>
  block.one_visit ? "one_visit" : block.type;

/** How the day's timeline draws each kind. */
export const TIMELINE_KINDS: Readonly<Record<VisitKind, TimelineKind>> = {
  service: "service",
  consultation: "consultation",
  one_visit: "one_visit",
  first_fit: "fit",
  replacement: "replacement",
};

/** Whether a visit is of the kind chosen; every one is of all. */
export const ofKind = (block: Pick<Block, "type" | "one_visit">, kind: BoardKind): boolean =>
  kind === "all" || kindOfBlock(block) === kind;

/** The rows with only the visits of the kind chosen, each technician kept. */
export function rowsOfKind(rows: BoardRow[], kind: BoardKind): BoardRow[] {
  if (kind === "all") return rows;
  return rows.map((row) => ({
    ...row,
    days: row.days.map((day) => ({ ...day, blocks: day.blocks.filter((block) => ofKind(block, kind)) })),
  }));
}

/** The board with only the visits of the kind chosen, on each technician's days and among those nobody is on. */
export function boardOfKind(board: Board, kind: BoardKind): Board {
  if (kind === "all") return board;
  return {
    ...board,
    technicians: rowsOfKind(board.technicians, kind),
    unassigned: board.unassigned.filter((job) => ofKind(job, kind)),
  };
}

/** Whether any visit, a technician's or nobody's, is of the kind chosen: on the day shown, or in the week. */
export function anyOfKind(board: Board, rows: readonly BoardRow[], kind: BoardKind, date?: string): boolean {
  if (kind === "all") return true;
  const onDay = (day: string) => date === undefined || day === date;
  return (
    board.unassigned.some((job) => onDay(job.date ?? indiaDate(job.starts_at)) && ofKind(job, kind)) ||
    rows.some((row) => row.days.some((day) => onDay(day.date) && day.blocks.some((block) => ofKind(block, kind))))
  );
}
