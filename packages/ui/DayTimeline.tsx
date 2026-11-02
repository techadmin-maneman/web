// A day along the hours, a row for each person down: a column for each step of the day, what fills a stretch spanning
// the steps it holds, and a start someone may take a step of its own. A row's name may carry a line and how much of
// its day is booked; a row may warn, as the visits with nobody on them do; a visit wears its kind; leave is a band; and
// the step it is now is marked down the day. The table lays it out, so nothing is placed by hand.
//
//   <DayTimeline label="Thursday's visits" labelledBy="day-title" steps={steps} rows={rows} />

import { useEffect, useRef, type ReactNode } from "react";
import { classes } from "./classes.ts";
import { TableScroll } from "./Table.tsx";
import styles from "./day-timeline.module.css";

/**
 * How a stretch of the day reads: nothing in it, a visit, one done, one under way, one running late, a start free, or
 * the start chosen.
 */
export type TimelineLook =
  "idle" | "busy" | "done" | "underway" | "late" | "proposed" | "free" | "chosen" | "unassigned" | "leave";

/** A visit's kind, which its fill and its edge show: the dispatch board's own. */
export type TimelineKind = "consultation" | "service" | "replacement" | "fit";

export interface TimelineCell {
  readonly key: string;
  /** How many of the day's steps it covers. */
  readonly span: number;
  readonly look: TimelineLook;
  readonly kind?: TimelineKind | undefined;
  readonly children?: ReactNode;
}

export interface TimelineRow {
  readonly key: string;
  /** Who the row is: their name. */
  readonly head: ReactNode;
  /** A line beneath the name: where they work, their visits and hours. */
  readonly meta?: ReactNode;
  /** How much of the day shown is booked, 0 to 1, as a bar beneath. */
  readonly load?: number | undefined;
  /** A row that warns, as the visits with nobody on them, pinned at the top. */
  readonly tone?: "warning" | undefined;
  readonly cells: readonly TimelineCell[];
}

const KINDS: Readonly<Record<TimelineKind, string | undefined>> = {
  consultation: styles.consultation,
  service: styles.service,
  replacement: styles.replacement,
  fit: styles.fit,
};

/**
 * The row's cells with the step it is now starting a cell of its own: an empty stretch across it is cut there, so the
 * mark falls on the step. A visit across it keeps the mark beneath it.
 */
function cutAtNow(cells: readonly TimelineCell[], now: number | null): { cell: TimelineCell; atNow: boolean }[] {
  if (now === null) return cells.map((cell) => ({ cell, atNow: false }));
  let at = 0;
  return cells.flatMap((cell) => {
    const from = at;
    at += cell.span;
    if (cell.look === "idle" && now > from && now < at)
      return [
        { cell: { ...cell, span: now - from }, atNow: false },
        { cell: { ...cell, key: `${cell.key}/now`, span: at - now }, atNow: true },
      ];
    return [{ cell, atNow: from === now }];
  });
}

/** The key to a day's visits: each kind's look beside its name, and the look of one nobody is on. */
export function TimelineLegend({
  label,
  kinds,
  nobody,
}: {
  readonly label: string;
  readonly kinds: readonly { readonly kind: TimelineKind; readonly name: string }[];
  readonly nobody: string;
}) {
  return (
    <ul className={styles.legend} aria-label={label}>
      {kinds.map(({ kind, name }) => (
        <li key={kind} className={styles.key}>
          <span className={classes(styles.swatch, KINDS[kind])} aria-hidden="true" />
          {name}
        </li>
      ))}
      <li className={styles.key}>
        <span className={classes(styles.swatch, styles.unassigned)} aria-hidden="true" />
        {nobody}
      </li>
    </ul>
  );
}

function RowHead({ row }: { readonly row: TimelineRow }) {
  return (
    <th scope="row" className={classes(styles.head, row.tone === "warning" && styles.warning)}>
      <span className={styles.name}>{row.head}</span>
      {row.meta !== undefined && <span className={styles.meta}>{row.meta}</span>}
      {row.load !== undefined && (
        <progress
          className={styles.load}
          max={100}
          value={Math.round(Math.min(1, Math.max(0, row.load)) * 100)}
          aria-hidden="true"
        />
      )}
    </th>
  );
}

export function DayTimeline({
  label,
  labelledBy,
  steps,
  rows,
  at = null,
  now = null,
}: {
  readonly label: string;
  /** The heading the scrolling region is named by. */
  readonly labelledBy: string;
  /** Each step of the day, with the words its column heads with; an empty one heads with none. */
  readonly steps: readonly { readonly key: string; readonly label: string }[];
  readonly rows: readonly TimelineRow[];
  /** The step to bring into view along the day, as the start chosen; the chosen cell's own where none is given. */
  readonly at?: string | null;
  /** The step it is now, marked down the day; null on another day. */
  readonly now?: string | null;
}) {
  const nowStep = now === null ? -1 : steps.findIndex((step) => step.key === now);
  const table = useRef<HTMLTableElement>(null);
  const chosen =
    at ??
    rows.flatMap((row) =>
      row.cells.filter((cell) => cell.look === "chosen").map((cell) => `${row.key}:${cell.key}`),
    )[0] ??
    null;
  useEffect(() => {
    const box = table.current;
    const scroller = box?.parentElement;
    if (!box || !scroller || chosen === null) return;
    const target =
      at === null
        ? box.querySelector<HTMLElement>(`.${styles.chosen ?? "chosen"}`)
        : box.querySelector<HTMLElement>(`th[data-step="${CSS.escape(at)}"]`);
    if (!target) return;
    // Along the hours alone, past the names that stay put on the left, the step in the middle of what shows.
    const names = box.querySelector<HTMLElement>(`.${styles.head ?? "head"}`)?.offsetWidth ?? 0;
    const room = scroller.clientWidth - names;
    scroller.scrollLeft = Math.max(0, target.offsetLeft - names - (room - target.offsetWidth) / 2);
  }, [at, chosen]);
  return (
    <TableScroll labelledBy={labelledBy}>
      <table ref={table} className={styles.timeline} aria-label={label}>
        <thead>
          <tr>
            <td className={styles.corner} />
            {steps.map((step) => (
              <th key={step.key} scope="col" className={styles.step} data-step={step.key}>
                {step.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key}>
              <RowHead row={row} />
              {cutAtNow(row.cells, nowStep < 0 ? null : nowStep).map(({ cell, atNow }) => (
                <td
                  key={cell.key}
                  colSpan={cell.span}
                  className={classes(
                    styles.cell,
                    styles[cell.look],
                    cell.kind !== undefined && KINDS[cell.kind],
                    atNow && styles.now,
                  )}
                >
                  {cell.children}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </TableScroll>
  );
}
