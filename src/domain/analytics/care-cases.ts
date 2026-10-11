// Care cases in the reporting copy (docs/decisions/0146-the-nightly-analytics-copy.md): each grievance, and each task
// the Tasks board has held (docs/decisions/0147-task-spans.md), with the days it opened and closed. A task ops closed
// by hand, with nothing left to do, is marked so. Records marked as tests are left out.

import { indiaDate } from "../../lib/india-time.ts";
import type { TableRows } from "../../providers/warehouse/index.ts";
import { clientCityOf } from "../clients/places.ts";

interface CaseRow {
  readonly case_key: string;
  readonly kind: string;
  readonly city: string | null;
  readonly task_group: string | null;
  readonly opened_at: string;
  readonly closed_at: string | null;
  readonly without_doing: number;
}

const dayOf = (at: string | null) => (at === null ? null : indiaDate(new Date(at)));

export async function careCaseRows(db: D1Database): Promise<TableRows> {
  const { results } = await db
    .prepare(
      `SELECT 'g:' || g.id AS case_key, 'grievance' AS kind, ${clientCityOf("p")} AS city, NULL AS task_group,
         g.created_at AS opened_at, g.resolved_at AS closed_at, 0 AS without_doing
       FROM grievances g JOIN people p ON p.id = g.person_id WHERE p.test_record = 0
       UNION ALL
       SELECT 't:' || s.id, 'task', s.city, s.task_group, s.opened_at, s.closed_at,
         EXISTS (SELECT 1 FROM task_closures c WHERE c.task_group = s.task_group AND c.subject_id = s.subject_id
           AND c.closed_at BETWEEN s.opened_at AND s.closed_at)
       FROM task_spans s`,
    )
    .all<CaseRow>();
  return {
    table: "fact_care",
    key: ["case_key"],
    stamped: true,
    rows: results.map((row) => ({
      case_key: row.case_key,
      kind: row.kind,
      city: row.city,
      task_group: row.task_group,
      opened_date: indiaDate(new Date(row.opened_at)),
      closed_date: dayOf(row.closed_at),
      closed_without_doing: row.without_doing === 1,
    })),
  };
}
