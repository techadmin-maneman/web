// Leads who wrote to us and wait on Care's first reply (docs/decisions/0323-the-unanswered-lead-alert.md): a chat from
// a number we don't know (an active technician's is known), or from someone not yet fitted, whom no Care person has
// ever written to, counted from their
// first message since the chat last opened. Each waits in Care's times; at its alert time Care on shift are told, on
// every console screen and on their phones. A lead who never wrote has nothing to be answered.

import { leadAlertAt, type CareHours } from "../../policy/care-hours.ts";
import { AUTO_REPLY } from "../care/after-hours.ts";

/** A message a Care person wrote, as the lead's first reply counts it: never the system's or the after-hours answer. */
const CARE_WROTE = `m.direction = 'out' AND m.author NOT IN ('system', 'client', ?2) AND COALESCE(m.delivery, 'sent') = 'sent'`;

/** A first fit done, or a consultation done as one visit: the person is a client, not a lead (ADR 0320). */
const FITTED = `SELECT 1 FROM appointments a WHERE a.person_id = c.person_id AND a.deleted_at IS NULL
  AND a.status = 'completed' AND (a.type = 'first_fit' OR (a.type = 'consultation' AND a.one_visit = 'fitted'))`;

/** Chats open since `?1` with a first reply due: nobody at Care has written to their number or to them. */
const FIRST_REPLY_DUE = `SELECT c.id AS conversation_id, c.person_id AS person_id, pe.name AS name, c.mobile_e164 AS mobile,
    (SELECT MIN(i.sent_at) FROM chat_messages i
      WHERE i.conversation_id = c.id AND i.direction = 'in' AND i.sent_at >= c.opened_at) AS since
   FROM conversations c LEFT JOIN people pe ON pe.id = c.person_id
  WHERE c.state = 'open' AND c.last_message_at >= ?1 AND c.last_inbound_at IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM chat_messages m WHERE m.conversation_id = c.id AND ${CARE_WROTE})
    AND NOT EXISTS (SELECT 1 FROM technicians t WHERE t.mobile_e164 = c.mobile_e164 AND t.active = 1)
    AND (c.person_id IS NULL OR (pe.erased_at IS NULL AND NOT EXISTS (${FITTED})
      AND NOT EXISTS (SELECT 1 FROM conversations o JOIN chat_messages m ON m.conversation_id = o.id
        WHERE o.person_id = c.person_id AND ${CARE_WROTE})))`;

/** A lead waiting on Care's first reply, and when Care on shift are told of it. */
export interface WaitingLead {
  /** "<conversation>:<first message>": the one push each wait is told by. */
  readonly wait: string;
  readonly conversation_id: string;
  /** Null for a number we don't know. */
  readonly person_id: string | null;
  readonly name: string | null;
  readonly mobile: string;
  readonly since: string;
  readonly alert_at: string;
}

interface Row {
  readonly conversation_id: string;
  readonly person_id: string | null;
  readonly name: string | null;
  readonly mobile: string;
  readonly since: string | null;
}

/** Every lead waiting on Care's first reply whose chat moved since `from`, the longest waiting first. */
export async function waitingLeads(
  db: D1Database,
  { from, hours }: { readonly from: Date; readonly hours: CareHours },
): Promise<WaitingLead[]> {
  const { results } = await db.prepare(FIRST_REPLY_DUE).bind(from.toISOString(), AUTO_REPLY).all<Row>();
  const leads = results.flatMap((row) => {
    if (row.since === null) return [];
    const since = row.since;
    const alertAt = leadAlertAt(new Date(since), hours).toISOString();
    return [{ ...row, since, wait: `${row.conversation_id}:${since}`, alert_at: alertAt }];
  });
  return leads.sort((a, b) => a.since.localeCompare(b.since));
}
