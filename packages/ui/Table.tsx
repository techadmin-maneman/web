// The ops console's table: rows of --ops-row, the head's names small and muted over a rule and held in view as the
// rows scroll, a row marked under the pointer, and a figure set right in figures of one width. A caller's class sets
// the columns. On a phone each row is a card, every value beside its column's name (./table.module.css).

import { useEffect, useRef, type ReactNode } from "react";
import { classes } from "./classes.ts";
import styles from "./table.module.css";

/** What a cell's head says aloud: its words, less any hidden from a screen reader, as a sort's arrow is. */
function spokenText(node: Node): string {
  if (node instanceof Element && node.getAttribute("aria-hidden") === "true") return "";
  if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? "";
  return Array.from(node.childNodes).map(spokenText).join("");
}

/** Names each body cell by its column's head (data-label), so a row read as a card says what each value is. */
function nameCells(table: HTMLTableElement): void {
  const heads: string[] = [];
  for (const cell of Array.from(table.tHead?.rows[0]?.cells ?? [])) {
    const name = spokenText(cell).trim();
    for (let span = 0; span < cell.colSpan; span += 1) heads.push(name);
  }
  for (const body of Array.from(table.tBodies)) {
    for (const row of Array.from(body.rows)) {
      let at = 0;
      for (const cell of Array.from(row.cells)) {
        const name = heads[at] ?? "";
        if (cell.dataset.label !== name) cell.dataset.label = name;
        at += cell.colSpan;
      }
    }
  }
}

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
  const ref = useRef<HTMLTableElement>(null);
  // The cells are named as the rows come and go, so a card names every value however the table changed.
  useEffect(() => {
    const table = ref.current;
    if (table === null || plain) return;
    nameCells(table);
    const watch = new MutationObserver(() => {
      nameCells(table);
    });
    watch.observe(table, { childList: true, subtree: true, characterData: true });
    return () => {
      watch.disconnect();
    };
  }, [plain]);
  return (
    <table
      ref={ref}
      data-cards={plain ? undefined : ""}
      className={classes(plain ? styles.plain : styles.table, controls && styles.controls, className)}
    >
      {children}
    </table>
  );
}

/** The table's classes, for an Astro page, which renders no component of this package's: `plain` as Table takes it. */
export const tableLook = ({ plain = false, className }: { plain?: boolean; className?: string } = {}): string =>
  classes(plain ? styles.plain : styles.table, className);

/**
 * A table wider than its panel, scrolled sideways inside it. The keyboard can reach it, so the columns past the edge
 * can be scrolled to with the arrow keys, and it is named by its panel's title (`labelledBy`).
 */
export function TableScroll({ labelledBy, children }: { readonly labelledBy: string; readonly children: ReactNode }) {
  return (
    // A region the keyboard must reach to scroll it (WCAG 2.1.1): it holds no control of its own to take the focus. Its
    // panel knows it by data-table, and lets it run to its foot (./panel.module.css).
    // eslint-disable-next-line jsx-a11y-x/no-noninteractive-tabindex
    <div className={styles.scroll} tabIndex={0} role="group" aria-labelledby={labelledBy} data-table="">
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
