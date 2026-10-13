// A reporting store that keeps what it is given, for tests and local runs: the same staging, stamping and deleting as
// the real one, so a test can see a night's rows, what changed, and the run it logged.

import {
  metaOf,
  rowKey,
  type Row,
  type RunLog,
  type TableMeta,
  type TableRows,
  type WarehouseProvider,
} from "./index.ts";

export interface StubWarehouse extends WarehouseProvider {
  readonly tables: Map<string, Map<string, Row>>;
  readonly runs: RunLog[];
}

const same = (one: Row, other: Row) => Object.keys(one).every((column) => one[column] === other[column]);

export function createStubWarehouse(): StubWarehouse {
  const tables = new Map<string, Map<string, Row>>();
  const runs: RunLog[] = [];
  /** Each run's staged rows, by table. */
  const staged = new Map<string, Map<string, readonly Row[]>>();

  /** One table made to hold what was staged for it; how many of its rows were new or changed. */
  function applied({ table, key, keepBefore }: TableMeta, rows: readonly Row[]): number {
    const held = tables.get(table) ?? new Map<string, Row>();
    const kept = [...held].filter(
      ([, row]) => keepBefore !== undefined && String(row[keepBefore.column]) < keepBefore.from,
    );
    tables.set(table, new Map([...kept, ...rows.map((row) => [rowKey(row, key), row] as const)]));
    return rows.filter((row) => {
      const was = held.get(rowKey(row, key));
      return was === undefined || !same(row, was);
    }).length;
  }

  return {
    tables,
    runs,
    ranOn: (date) => Promise.resolve(runs.some((run) => run.date === date)),
    stage: (run: string, table: TableRows) => {
      const forRun = staged.get(run) ?? new Map<string, readonly Row[]>();
      forRun.set(table.table, table.rows);
      staged.set(run, forRun);
      return Promise.resolve(metaOf(table));
    },
    swap: (run, metas) => {
      const forRun = staged.get(run) ?? new Map<string, readonly Row[]>();
      let written = 0;
      let changed = 0;
      for (const meta of metas) {
        const rows = forRun.get(meta.table) ?? [];
        written += rows.length;
        changed += applied(meta, rows);
      }
      staged.delete(run);
      return Promise.resolve({ written, changed });
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
