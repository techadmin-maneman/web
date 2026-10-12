// Who may read what in the reporting copy (docs/decisions/0154-targets-and-reporting-access.md): each grant of each
// member of staff let into the console, as the Staff list holds it, so Zoho Analytics can share each dashboard to them
// filtered to their places. Someone taken off the Staff list, or switched off, leaves it the same night.

import type { TableRows } from "../../providers/warehouse/index.ts";

interface GrantRow {
  readonly email: string;
  readonly department: string;
  readonly level: string;
  readonly geography: string;
  readonly place: string | null;
}

export async function accessRows(db: D1Database): Promise<TableRows> {
  const { results } = await db
    .prepare(
      `SELECT g.email, g.department, g.level, g.geography, g.place FROM staff_grants g
       JOIN staff s ON s.email = g.email WHERE s.active = 1`,
    )
    .all<GrantRow>();
  return {
    table: "access",
    key: ["email", "department", "geography", "place"],
    stamped: false,
    rows: results.map((row) => ({ ...row, place: row.place ?? "" })),
  };
}
