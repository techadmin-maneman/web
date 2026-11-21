// A chat past its reply-by time, as a Customer Care task (docs/decisions/0132-the-reply-clock.md): read with the
// board's other queues (src/domain/ops/tasks.ts), and kept once the reply clock has run out.

import { replyBy, type CareHours } from "../../policy/care-hours.ts";
import type { SqlValue } from "../../lib/sql.ts";
import type { TaskGroup } from "../../policy/tasks.ts";
import { HEARD_FROM_QUEUE } from "../attribution/heard-from-task.ts";
import { CITY_MATTERS_OPEN } from "./city-matters.ts";
import { REMEDIES_AWAITING } from "./remedies.ts";
import { MESSAGES_UNDELIVERED } from "./undelivered-messages.ts";

/** Every chat waiting on us: open, with nothing sent since the client last wrote but the after-hours answer. */
const CHATS_WAITING = `SELECT 'unanswered_chat' AS "group", c.id AS id, c.person_id AS person_id,
     pe.name AS person_name, c.mobile_e164 AS detail, json_object('mobile', c.mobile_e164) AS facts,
     c.last_inbound_at AS since, NULL AS due_by, '' AS episode
  FROM conversations c LEFT JOIN people pe ON pe.id = c.person_id
 WHERE c.state = 'open' AND c.last_inbound_at IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM chat_messages m WHERE m.conversation_id = c.id AND m.direction = 'out'
     AND m.author <> 'auto' AND m.sent_at >= c.last_inbound_at)`;

/**
 * An erasure Care finish by hand in the CRM: the record found by its lead ID, or by the person's ID where the lead
 * was never kept or has changed, deleted, then deleted again from the recycle bin, which keeps the old name and
 * number. From the erasure until Care close it.
 */
const ERASURES_TO_FOLLOW_UP = `SELECT 'erasure_follow_up' AS "group", f.person_id AS id, f.person_id AS person_id,
         pe.name AS person_name, pe.zoho_lead_id AS detail, json_object('lead', pe.zoho_lead_id, 'person', f.person_id) AS facts,
         f.erased_at AS since, NULL AS due_by, '' AS episode
    FROM erasure_follow_ups f JOIN people pe ON pe.id = f.person_id
   WHERE NOT EXISTS (SELECT 1 FROM task_closures c WHERE c.task_group = 'erasure_follow_up' AND c.subject_id = f.person_id)`;

/**
 * The board's queues from Customer Care's work: a chat waiting on us, kept once its reply-by time passes; a message
 * WhatsApp refused, until Care have told the client another way (./undelivered-messages.ts); a matter sent to a
 * city (./city-matters.ts); and a remedy awaiting a manager (./remedies.ts); and an erasure Care finish in the CRM;
 * and a client consulted whom nobody has asked how they heard of us (../attribution/heard-from-task.ts).
 */
export const CARE_QUEUES: readonly {
  readonly group: TaskGroup;
  readonly sql: string;
  readonly binds?: (at: { readonly lapsedBefore: string }) => readonly SqlValue[];
}[] = [
  { group: "unanswered_chat", sql: CHATS_WAITING },
  { group: "message_undelivered", sql: MESSAGES_UNDELIVERED },
  { group: "city_matter", sql: CITY_MATTERS_OPEN },
  { group: "remedy_approval", sql: REMEDIES_AWAITING },
  { group: "erasure_follow_up", sql: ERASURES_TO_FOLLOW_UP },
  HEARD_FROM_QUEUE,
];

interface BoardRow {
  readonly group: string;
  readonly since: string;
  readonly due_by: string | null;
}

/** The board's rows, each chat due by its reply-by time, and a chat still within it left off. */
export function overdueChats<Row extends BoardRow>(rows: readonly Row[], hours: CareHours, now: Date): Row[] {
  return rows.flatMap((row) => {
    if (row.group !== "unanswered_chat") return [row];
    const due = replyBy(new Date(row.since), hours);
    return due <= now ? [{ ...row, due_by: due.toISOString() }] : [];
  });
}
