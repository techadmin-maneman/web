// A long table's heads that sort, the bar above it that narrows it, and the button beneath it that shows the next
// page (./useTableView.ts). A head sorts on a press and reverses on the next; aria-sort says which way it runs.

import { TextButton } from "@maneman/ui/TextLink";
import { Field, Select } from "@maneman/ui/Field";
import { SearchInput } from "@maneman/ui/SearchInput";
import { Toolbar } from "@maneman/ui/Toolbar";
import { SortButton } from "@maneman/ui/Table";
import { classes } from "@maneman/ui/classes";
import { tables as copy } from "../content.ts";
import type { TableView } from "./useTableView.ts";
import styles from "./table-tools.module.css";

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
        <SortButton
          direction={direction}
          onSort={() => {
            view.sortBy(at);
          }}
        >
          {column.label}
        </SortButton>
      </th>
    );
  });
}

/** The search and the lists that narrow the table on one row, and at its end, once narrowed, how many rows match. */
export function Narrowing<Row>({
  view,
  label,
  className,
}: {
  view: TableView<Row>;
  label: string;
  className?: string;
}) {
  return (
    <Toolbar
      label={label}
      className={classes(styles.bar, className)}
      end={
        view.narrowed ? (
          <>
            {copy.count(view.matching, view.total)}
            <TextButton tone="muted" compact onClick={view.clear}>
              {copy.clear}
            </TextButton>
          </>
        ) : undefined
      }
    >
      {view.searchable && <SearchInput label={copy.search} value={view.search} onChange={view.setSearch} />}
      {view.columns.map(
        (column, at) =>
          column.choice !== undefined && (
            <Field key={column.label} label={column.label} labelHidden>
              {(control) => (
                <Select
                  {...control}
                  width="choice"
                  value={view.chosen[at] ?? ""}
                  onChange={(event) => {
                    view.choose(at, event.currentTarget.value);
                  }}
                >
                  <option value="">{copy.allOf(column.label)}</option>
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
    </Toolbar>
  );
}

/** Beneath the table: that nothing matches, or the button that shows the next page. */
export function TableEnd<Row>({ view, className }: { view: TableView<Row>; className?: string }) {
  if (view.matching === 0) return <p className={classes(styles.end, className)}>{copy.none}</p>;
  if (view.more === null) return null;
  return (
    <p className={classes(styles.end, className)}>
      <TextButton tone="muted" compact onClick={view.more}>
        {copy.more}
      </TextButton>
    </p>
  );
}
