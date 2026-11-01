// A day along the hours, a row for each person down: a column for each step of the day, what fills a stretch spanning
// the steps it holds, and a start someone may take a step of its own. The table lays it out, so nothing is placed by
// hand.
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
export type TimelineLook = "idle" | "busy" | "done" | "underway" | "late" | "proposed" | "free" | "chosen";

export interface TimelineCell {
  readonly key: string;
  /** How many of the day's steps it covers. */
  readonly span: number;
  readonly look: TimelineLook;
  readonly children?: ReactNode;
}

export interface TimelineRow {
  readonly key: string;
  /** Who the row is: a name, and a line beneath it. */
  readonly head: ReactNode;
  readonly cells: readonly TimelineCell[];
}

export function DayTimeline({
  label,
  labelledBy,
  steps,
  rows,
  at = null,
}: {
  readonly label: string;
  /** The heading the scrolling region is named by. */
  readonly labelledBy: string;
  /** Each step of the day, with the words its column heads with; an empty one heads with none. */
  readonly steps: readonly { readonly key: string; readonly label: string }[];
  readonly rows: readonly TimelineRow[];
  /** The step to bring into view along the day, as the start chosen; the chosen cell's own where none is given. */
  readonly at?: string | null;
}) {
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
              <th scope="row" className={styles.head}>
                {row.head}
              </th>
              {row.cells.map((cell) => (
                <td key={cell.key} colSpan={cell.span} className={classes(styles.cell, styles[cell.look])}>
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
