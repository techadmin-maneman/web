// Each month's targets in the reporting copy (docs/decisions/0154-targets-and-reporting-access.md), city by city, as
// set on the console's Targets page: what every scorecard sets plan beside actual.

import type { TableRows } from "../../providers/warehouse/index.ts";

export async function targetRows(db: D1Database): Promise<TableRows> {
  const { results } = await db
    .prepare("SELECT month, city, measure, target FROM targets")
    .all<{ month: string; city: string; measure: string; target: number }>();
  return {
    table: "fact_target",
    key: ["month", "city", "measure"],
    stamped: true,
    rows: results.map((row) => ({ ...row, month: `${row.month}-01` })),
  };
}
