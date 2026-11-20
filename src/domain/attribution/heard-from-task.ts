// The Tasks board's How they heard of us (docs/decisions/0288-attribution-and-conversions.md): a client whose first
// consultation is done, recorded as its conversion, with nothing kept of what they said of how they heard of us. It
// waits from the consultation, and goes once ops keep an answer on the client's page. A consultation further back than
// the board's lapse days is not asked about, and not read: what the board reads stays the consultations of those days.

import { DAY_MS } from "../../lib/durations.ts";
import type { SqlValue } from "../../lib/sql.ts";
import { TASK_LAPSE_DAYS, type TaskGroup } from "../../policy/tasks.ts";

export const HEARD_FROM_QUEUE: {
  readonly group: TaskGroup;
  readonly sql: string;
  readonly binds: (at: { readonly now: string }) => readonly SqlValue[];
} = {
  group: "heard_from_missing",
  sql: `SELECT 'heard_from_missing' AS "group", c.person_id AS id, c.person_id AS person_id, pe.name AS person_name,
         c.occurred_at AS detail, json_object('consulted_at', c.occurred_at) AS facts,
         c.occurred_at AS since, NULL AS due_by, '' AS episode
    FROM conversions c JOIN people pe ON pe.id = c.person_id
    LEFT JOIN person_attribution pa ON pa.person_id = c.person_id
   WHERE c.event = 'consult_done' AND c.occurred_at >= ?1 AND pe.erased_at IS NULL AND pa.heard_from IS NULL
     AND c.occurred_at = (SELECT MIN(x.occurred_at) FROM conversions x
       WHERE x.person_id = c.person_id AND x.event = 'consult_done')`,
  binds: (at) => [new Date(Date.parse(at.now) - TASK_LAPSE_DAYS * DAY_MS).toISOString()],
};
