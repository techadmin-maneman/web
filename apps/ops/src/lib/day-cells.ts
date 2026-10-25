// One technician's day as the board's Day view draws it (packages/ui/DayTimeline.tsx): a step for each half hour from
// the day's first to its last, a visit spanning the half hours it holds, each start a job in hand could take a step of
// its own, and the time between run together.

import { indiaTimeOf } from "@maneman/web-kit/dates";

/** A step of the day, in minutes: the starts clients pick from are this far apart. */
const STEP_MINUTES = 30;

/** Where the day begins and ends on the board when nothing falls outside: 8 am to 8 pm. */
const DAY_FROM = 8 * 60;
const DAY_TO = 20 * 60;

/** An instant's minute of India's day: "2026-09-22T06:00:00Z" → 690, 11:30. */
export function minuteOfDay(iso: string): number {
  const [hours = 0, minutes = 0] = indiaTimeOf(iso).split(":").map(Number);
  return hours * 60 + minutes;
}

const down = (minute: number) => Math.floor(minute / STEP_MINUTES) * STEP_MINUTES;
const up = (minute: number) => Math.ceil(minute / STEP_MINUTES) * STEP_MINUTES;

/**
 * The steps the day runs over, by their first minute: 8 am to 8 pm, wider where something falls outside; or, `fitted`,
 * from the first thing in it to the last, where the day is read in a narrow drawer.
 */
export function stepsOf(spans: readonly { readonly from: number; readonly to: number }[], fitted = false): number[] {
  const froms = spans.map((span) => down(span.from));
  const tos = spans.map((span) => up(Math.max(span.to, span.from + STEP_MINUTES)));
  const first = fitted && froms.length > 0 ? Math.min(...froms) : Math.min(DAY_FROM, ...froms);
  const last = fitted && tos.length > 0 ? Math.max(...tos) : Math.max(DAY_TO, ...tos);
  const steps: number[] = [];
  for (let minute = first; minute < last; minute += STEP_MINUTES) steps.push(minute);
  return steps;
}

export type DayCell<Busy, Free> =
  | { readonly kind: "idle"; readonly from: number; readonly span: number }
  | { readonly kind: "busy"; readonly from: number; readonly span: number; readonly busy: Busy }
  | { readonly kind: "free"; readonly from: number; readonly span: 1; readonly free: Free };

/**
 * The row's cells over the steps: a visit from the step it starts in for as many steps as it holds, a start in its
 * step where no visit is, and the rest run together. A visit over another's time is drawn from where the first ends.
 */
export function cellsOf<
  Busy extends { readonly from: number; readonly to: number },
  Free extends { readonly at: number },
>(steps: readonly number[], busy: readonly Busy[], free: readonly Free[]): DayCell<Busy, Free>[] {
  const cells: DayCell<Busy, Free>[] = [];
  const byStart = [...busy].sort((a, b) => a.from - b.from);
  let at = 0;
  while (at < steps.length) {
    const minute = steps[at] ?? 0;
    const visit = byStart.find((each) => down(each.from) <= minute && each.to > minute);
    if (visit !== undefined) {
      const span = Math.max(1, steps.filter((step) => step >= minute && step < visit.to).length);
      cells.push({ kind: "busy", from: minute, span, busy: visit });
      at += span;
      continue;
    }
    const start = free.find((each) => down(each.at) === minute);
    if (start !== undefined) {
      cells.push({ kind: "free", from: minute, span: 1, free: start });
      at += 1;
      continue;
    }
    const last = cells.at(-1);
    if (last?.kind === "idle") cells[cells.length - 1] = { ...last, span: last.span + 1 };
    else cells.push({ kind: "idle", from: minute, span: 1 });
    at += 1;
  }
  return cells;
}
