// A chat past its reply-by time, as a Customer Care task (docs/decisions/0132-the-reply-clock.md): read with the
// board's other queues (src/domain/ops/tasks.ts), and kept once the reply clock has run out.

import { replyBy, type CareHours } from "../../policy/care-hours.ts";
import { CITY_MATTERS_OPEN } from "./city-matters.ts";
import { REMEDIES_AWAITING } from "./remedies.ts";

/** Every chat waiting on us: open, with nothing sent since the client last wrote but the after-hours answer. */
const CHATS_WAITING = `SELECT 'unanswered_chat' AS "group", c.id AS id, c.person_id AS person_id,
     pe.name AS person_name, c.mobile_e164 AS detail, c.last_inbound_at AS since, NULL AS due_by, '' AS episode
  FROM conversations c LEFT JOIN people pe ON pe.id = c.person_id
 WHERE c.state = 'open' AND c.last_inbound_at IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM chat_messages m WHERE m.conversation_id = c.id AND m.direction = 'out'
     AND m.author <> 'auto' AND m.sent_at >= c.last_inbound_at)`;

/**
 * The board's queues from Customer Care's work: a chat waiting on us, kept once its reply-by time passes; a matter sent
 * to a city (./city-matters.ts); and a remedy awaiting a manager (./remedies.ts).
 */
export const CARE_QUEUES: readonly string[] = [CHATS_WAITING, CITY_MATTERS_OPEN, REMEDIES_AWAITING];

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
