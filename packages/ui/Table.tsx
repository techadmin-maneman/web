// The ops console's table: rows of --ops-row, the head's names small and muted over a rule and held in view as the
// rows scroll, a row marked under the pointer, and a figure set right in figures of one width. A caller's class sets
// the columns.

import type { ReactNode } from "react";
import { classes } from "./classes.ts";
import styles from "./table.module.css";

/**
 * `plain` keeps a table's meaning and none of the console's look, for a table that is a drawing of its own: the
 * dispatch board's week, or a sheet printed for a supplier. `controls` is for rows that hold boxes and buttons, which
 * make the row's height: its cells have no room above or below, and the first and last sit in from the panel's edge.
 */
export function Table({
  className,
  plain = false,
  controls = false,
  children,
}: {
  className?: string | undefined;
  plain?: boolean;
  controls?: boolean;
  children: ReactNode;
}) {
  return (
    <table className={classes(plain ? styles.plain : styles.table, controls && styles.controls, className)}>
      {children}
    </table>
  );
}

/**
 * A table wider than its panel, scrolled sideways inside it. The keyboard can reach it, so the columns past the edge
 * can be scrolled to with the arrow keys, and it is named by its panel's title (`labelledBy`).
 */
export function TableScroll({ labelledBy, children }: { readonly labelledBy: string; readonly children: ReactNode }) {
  return (
    // A region the keyboard must reach to scroll it (WCAG 2.1.1): it holds no control of its own to take the focus.
    // eslint-disable-next-line jsx-a11y-x/no-noninteractive-tabindex
    <div className={styles.scroll} tabIndex={0} role="group" aria-labelledby={labelledBy}>
      {children}
    </div>
  );
}

/** A column of figures, right aligned, as every board sets a count or an amount. */
export const FIGURE = styles.figure;

const ARROWS = { ascending: "↑", descending: "↓" } as const;

/**
 * A column head's name as the button that sorts by it, with the arrow of the order it sorts in. Its `th` carries
 * aria-sort, which a screen reader reads.
 */
export function SortButton({
  direction,
  onSort,
  children,
}: {
  readonly direction: "ascending" | "descending" | undefined;
  readonly onSort: () => void;
  readonly children: ReactNode;
}) {
  return (
    <button type="button" className={styles.sort} onClick={onSort}>
      {children}
      {direction !== undefined && <span aria-hidden="true">{ARROWS[direction]}</span>}
    </button>
  );
}
