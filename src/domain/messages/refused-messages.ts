// A WhatsApp message WhatsApp refused after the provider took it (docs/decisions/0276-a-message-whatsapp-refuses.md),
// as Care's Tasks board reads it: about the client's visit, money or look, so Care tell them another way, and close
// the task with what was done. The inbound port marks it failed (./inbound.ts).

import { REFUSALS_NOT_CHASED } from "../../policy/message-refusals.ts";

const NOT_CHASED = REFUSALS_NOT_CHASED.map((kind) => `'${kind}'`).join(", ");

/** The board's messages not delivered: refused, never delivered since, and not yet closed. */
export const MESSAGES_UNDELIVERED = `SELECT 'message_undelivered' AS "group", m.id AS id, m.person_id AS person_id,
         pe.name AS person_name, m.kind AS detail,
         json_object('kind', m.kind,
           'code', CASE WHEN m.last_error LIKE 'refused %' THEN substr(m.last_error, 9) END) AS facts,
         COALESCE(m.sent_at, m.created_at) AS since, NULL AS due_by, '' AS episode
    FROM outbound_messages m INDEXED BY outbound_messages_refused
    JOIN people pe ON pe.id = m.person_id
   WHERE m.state = 'failed' AND m.provider_message_id IS NOT NULL AND m.delivered_at IS NULL
     AND m.kind NOT IN (${NOT_CHASED}) AND pe.erased_at IS NULL
     AND NOT EXISTS (SELECT 1 FROM task_closures c WHERE c.task_group = 'message_undelivered' AND c.subject_id = m.id)`;
