// A long table's heads that sort, the bar above it that narrows it, and the button beneath it that shows the next
// page (./useTableView.ts). A head sorts on a press and reverses on the next; aria-sort says which way it runs.

import { Field, Select, TextInput } from "@maneman/ui/Field";
import { classes } from "@maneman/ui/classes";
import { tables as copy } from "../content.ts";
import type { TableView } from "./useTableView.ts";
import styles from "./table-tools.module.css";

const ARROW = { ascending: "↑", descending: "↓" } as const;

/** The table's column heads, each that sorts a button. The caller puts them in its row, with any of its own. */
export function SortHeads<Row>({ view, className }: { view: TableView<Row>; className?: string }) {
  return view.columns.map((column, at) => {
    const head = classes(className, column.className, column.figure === true ? styles.figure : undefined);
    if (column.sort === undefined) {
      return (
        <th key={column.label} scope="col" className={head}>
          {column.label}
        </th>
      );
    }
    const direction = view.sorted?.column === at ? view.sorted.direction : undefined;
    return (
      <th key={column.label} scope="col" className={head} aria-sort={direction ?? "none"}>
        <button
          className={styles.sort}
          type="button"
          onClick={() => {
            view.sortBy(at);
          }}
        >
          {column.label}
          <span className={styles.arrow} aria-hidden="true">
            {direction === undefined ? "" : ARROW[direction]}
          </span>
        </button>
      </th>
    );
  });
}

/** The search and the lists that narrow the table, and how many rows match. */
export function Narrowing<Row>({ view, label }: { view: TableView<Row>; label: string }) {
  return (
    <div className={styles.bar} role="search" aria-label={label}>
      {view.searchable && (
        <Field label={copy.search}>
          {(control) => (
            <TextInput
              {...control}
              className={styles.search}
              type="search"
              value={view.search}
              onChange={(event) => {
                view.setSearch(event.currentTarget.value);
              }}
            />
          )}
        </Field>
      )}
      {view.columns.map(
        (column, at) =>
          column.choice !== undefined && (
            <Field key={column.label} label={column.label}>
              {(control) => (
                <Select
                  {...control}
                  value={view.chosen[at] ?? ""}
                  onChange={(event) => {
                    view.choose(at, event.currentTarget.value);
                  }}
                >
                  <option value="">{copy.all}</option>
                  {view.options(at).map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          ),
      )}
      <p className={styles.count}>
        {copy.count(view.matching, view.total)}
        {view.narrowed && (
          <button className={styles.clear} type="button" onClick={view.clear}>
            {copy.clear}
          </button>
        )}
      </p>
    </div>
  );
}

/** Beneath the table: that nothing matches, or the button that shows the next page. */
export function TableEnd<Row>({ view, className }: { view: TableView<Row>; className?: string }) {
  if (view.matching === 0) return <p className={classes(styles.end, className)}>{copy.none}</p>;
  if (view.more === null) return null;
  return (
    <p className={classes(styles.end, className)}>
      <button className={styles.clear} type="button" onClick={view.more}>
        {copy.more}
      </button>
    </p>
  );
}
