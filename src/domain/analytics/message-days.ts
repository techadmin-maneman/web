// The messages we sent, by India day and kind, in the reporting copy (docs/decisions/0146-the-nightly-analytics-copy.md):
// how many went, reached the phone, were read, or failed. Messages to records marked as tests are left out.

import type { TableRows } from "../../providers/warehouse/index.ts";
import { indiaDateSql } from "../../lib/india-time.ts";

export async function messageDayRows(db: D1Database): Promise<TableRows> {
  const { results } = await db
    .prepare(
      `SELECT ${indiaDateSql("COALESCE(m.sent_at, m.created_at)")} AS day, m.kind,
         SUM(m.state = 'sent') AS sent, SUM(m.delivered_at IS NOT NULL) AS delivered,
         SUM(m.read_at IS NOT NULL) AS read, SUM(m.state = 'failed') AS failed
       FROM outbound_messages m JOIN people p ON p.id = m.person_id
       WHERE m.state IN ('sent', 'failed') AND p.test_record = 0
       GROUP BY day, m.kind`,
    )
    .all<{ day: string; kind: string; sent: number; delivered: number; read: number; failed: number }>();
  return { table: "fact_message_day", key: ["day", "kind"], stamped: true, rows: results };
}
