// A reporting store that keeps what it is given, for tests and local runs: the same stamping and deleting as the real
// one, so a test can see a night's rows, what changed, and the run it logged.

import type { Row, RunLog, TableRows, WarehouseProvider } from "./index.ts";

export interface StubWarehouse extends WarehouseProvider {
  readonly tables: Map<string, Map<string, Row>>;
  readonly runs: RunLog[];
}

const keyOf = (row: Row, key: readonly string[]) => key.map((column) => String(row[column])).join("|");

const same = (one: Row, other: Row) => Object.keys(one).every((column) => one[column] === other[column]);

export function createStubWarehouse(): StubWarehouse {
  const tables = new Map<string, Map<string, Row>>();
  const runs: RunLog[] = [];
  return {
    tables,
    runs,
    ranOn: (date) => Promise.resolve(runs.some((run) => run.date === date)),
    replace: ({ table, key, rows }: TableRows) => {
      const held = tables.get(table) ?? new Map<string, Row>();
      const tonight = new Map(rows.map((row) => [keyOf(row, key), row] as const));
      let changed = 0;
      for (const [name, row] of tonight) {
        const was = held.get(name);
        if (was === undefined || !same(row, was)) changed += 1;
      }
      tables.set(table, tonight);
      return Promise.resolve({ written: rows.length, changed });
    },
    count: (table) => Promise.resolve(tables.get(table)?.size ?? 0),
    sum: (table, column) =>
      Promise.resolve(
        [...(tables.get(table)?.values() ?? [])].reduce((total, row) => total + Number(row[column] ?? 0), 0),
      ),
    logRun: (run) => {
      runs.push(run);
      return Promise.resolve();
    },
    size: () => Promise.resolve(0),
    close: () => Promise.resolve(),
  };
}
