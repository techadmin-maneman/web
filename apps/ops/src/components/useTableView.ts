// A long table's view of its rows: sorted by a column, narrowed by a search and by the few values of a column, and
// shown a page at a time. The rows are what the API sent; nothing here asks it again (./TableTools.tsx draws it).

import { useState } from "react";

type Direction = "ascending" | "descending";

/** A column of a table: its head, and what of a row it sorts and narrows by. */
export interface Column<Row> {
  readonly label: string;
  /** The value a row sorts by; without one the column doesn't sort. */
  readonly sort?: (row: Row) => string | number;
  /** The word a row shows in a column of few values, which a list narrows to; without one it has no list. */
  readonly choice?: (row: Row) => string;
  /** A column of figures, set right. */
  readonly figure?: boolean;
  /** The head's own class, where the table styles its columns. */
  readonly className?: string;
}

export interface Sorted {
  readonly column: number;
  readonly direction: Direction;
}

export interface TableView<Row> {
  readonly columns: readonly Column<Row>[];
  /** The rows to draw: narrowed, sorted, and cut to the page. */
  readonly shown: readonly Row[];
  readonly matching: number;
  readonly total: number;
  readonly sorted: Sorted | null;
  readonly sortBy: (column: number) => void;
  readonly searchable: boolean;
  readonly search: string;
  readonly setSearch: (search: string) => void;
  readonly chosen: Readonly<Record<number, string>>;
  readonly choose: (column: number, value: string) => void;
  /** The values a column's list offers, from the rows themselves. */
  readonly options: (column: number) => readonly string[];
  readonly narrowed: boolean;
  readonly clear: () => void;
  /** Shows the next page; null once every matching row is shown. */
  readonly more: (() => void) | null;
}

const PAGE = 50;

const collator = new Intl.Collator("en-IN", { numeric: true, sensitivity: "base" });

function compare(a: string | number, b: string | number): number {
  return typeof a === "number" && typeof b === "number" ? a - b : collator.compare(String(a), String(b));
}

export function useTableView<Row>(
  rows: readonly Row[],
  columns: readonly Column<Row>[],
  options: {
    /** The words a search reads of a row; without it there is no search box. */
    readonly search?: (row: Row) => string;
    /** The order before anyone sorts; without it, the order the rows came in. */
    readonly sorted?: Sorted;
    readonly page?: number;
  } = {},
): TableView<Row> {
  const page = options.page ?? PAGE;
  const [sorted, setSorted] = useState<Sorted | null>(options.sorted ?? null);
  const [search, setSearchTo] = useState("");
  const [chosen, setChosen] = useState<Readonly<Record<number, string>>>({});
  const [limit, setLimit] = useState(page);

  const words = search.trim().toLowerCase();
  const matching = rows.filter(
    (row) =>
      Object.entries(chosen).every(([column, value]) => columns[Number(column)]?.choice?.(row) === value) &&
      (words === "" || options.search?.(row).toLowerCase().includes(words) !== false),
  );
  const by = sorted === null ? undefined : columns[sorted.column]?.sort;
  const ordered =
    sorted === null || by === undefined
      ? matching
      : [...matching].sort((a, b) => (sorted.direction === "ascending" ? 1 : -1) * compare(by(a), by(b)));

  return {
    columns,
    shown: ordered.slice(0, limit),
    matching: matching.length,
    total: rows.length,
    sorted,
    sortBy: (column) => {
      setSorted(
        sorted?.column === column
          ? { column, direction: sorted.direction === "ascending" ? "descending" : "ascending" }
          : { column, direction: "ascending" },
      );
    },
    searchable: options.search !== undefined,
    search,
    setSearch: (next) => {
      setSearchTo(next);
      setLimit(page);
    },
    chosen,
    choose: (column, value) => {
      setChosen(Object.fromEntries(Object.entries({ ...chosen, [column]: value }).filter(([, each]) => each !== "")));
      setLimit(page);
    },
    options: (column) => {
      const choice = columns[column]?.choice;
      if (choice === undefined) return [];
      return [...new Set(rows.map(choice))].filter((value) => value !== "").sort(compare);
    },
    narrowed: words !== "" || Object.keys(chosen).length > 0,
    clear: () => {
      setSearchTo("");
      setChosen({});
      setLimit(page);
    },
    more:
      ordered.length > limit
        ? () => {
            setLimit(limit + page);
          }
        : null,
  };
}
