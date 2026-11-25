// A lead's stages and a lead lost (docs/decisions/0320-lead-stages.md): each stage read from what happened, from the
// person, the Care inbox, the conversions and the visits; and a lead lost, kept beside the person's attribution with
// one of the job sheet's lost reasons (docs/decisions/0149-lost-reasons.md) and the client's objection.

import { AUTO_REPLY } from "../care/after-hours.ts";
import { jobSheet, knownCodes } from "../field/job-sheet-settings.ts";
import { auditStatement, type AuditActor } from "../platform/audit.ts";

/**
 * Records a lead lost, with why (one of the job sheet's lost reasons) and the client's objection, or takes it back where
 * `reason` is null: audited, beside their channel or before they have one. A lead
 * still lost keeps the day it was first lost however often its reason or words change; taking back a lead never lost
 * changes nothing. "unknown_reason" for a code ops never listed.
 */
export async function setLost(
  db: D1Database,
  change: {
    readonly personId: string;
    readonly reason: string | null;
    readonly objection: string | null;
    readonly actor: AuditActor;
    readonly requestId: string;
    readonly now: Date;
  },
): Promise<"set" | "unchanged" | "unknown_reason"> {
  if (change.reason !== null && !knownCodes((await jobSheet(db)).lostReasons).has(change.reason)) {
    return "unknown_reason";
  }
  const kept = await db
    .prepare("SELECT lost_reason, lost_at FROM person_attribution WHERE person_id = ?1")
    .bind(change.personId)
    .first<{ lost_reason: string | null; lost_at: string | null }>();
  const wasLost = kept !== null && kept.lost_reason !== null;
  const lost = change.reason !== null;
  if (!lost && !wasLost) return "unchanged";
  const at = change.now.toISOString();
  await db.batch([
    db
      .prepare(
        `INSERT INTO person_attribution (person_id, lost_reason, lost_objection, lost_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5)
         ON CONFLICT (person_id) DO UPDATE SET lost_reason = excluded.lost_reason,
           lost_objection = excluded.lost_objection, lost_at = excluded.lost_at, updated_at = excluded.updated_at`,
      )
      .bind(change.personId, change.reason, lost ? change.objection : null, lost ? (kept?.lost_at ?? at) : null, at),
    auditStatement(
      db,
      {
        surface: "ops",
        actor: change.actor,
        action: lost ? "client.lost" : "client.lost_taken_back",
        subject: { kind: "person", id: change.personId },
        requestId: change.requestId,
        ...(lost ? { detail: { lost_reason: change.reason } } : {}),
      },
      change.now,
    ),
  ]);
  return "set";
}

/**
 * A lead's stages, each when it was first reached, read from what happened: a lead from when we first held them;
 * Care's first written reply that went (an automatic message, the after-hours one among them, is none, nor a reply
 * WhatsApp refused); qualified when their first consultation was booked;
 * the consultation done; fitted at their first fit done, a consultation and fit in one visit's among them.
 */
export interface LeadStages {
  readonly became_lead_at: string | null;
  readonly first_reply_at: string | null;
  readonly qualified_at: string | null;
  readonly attended_at: string | null;
  readonly fitted_at: string | null;
}

export async function leadStages(db: D1Database, personId: string): Promise<LeadStages> {
  const row = await db
    .prepare(
      `SELECT (SELECT created_at FROM people WHERE id = ?1) AS became_lead_at,
         (SELECT MIN(m.sent_at) FROM chat_messages m JOIN conversations c ON c.id = m.conversation_id
           WHERE c.person_id = ?1 AND m.direction = 'out' AND m.author NOT IN ('system', 'client', ?2)
             AND COALESCE(m.delivery, 'sent') = 'sent') AS first_reply_at,
         (SELECT MIN(occurred_at) FROM conversions WHERE person_id = ?1 AND event = 'consult_booked') AS qualified_at,
         (SELECT MIN(occurred_at) FROM conversions WHERE person_id = ?1 AND event = 'consult_done') AS attended_at,
         (SELECT MIN(a.window_start) FROM appointments a
           WHERE a.person_id = ?1 AND a.deleted_at IS NULL AND a.status = 'completed' AND a.window_start IS NOT NULL
             AND (a.type = 'first_fit' OR (a.type = 'consultation' AND a.one_visit = 'fitted'))) AS fitted_at`,
    )
    .bind(personId, AUTO_REPLY)
    .first<LeadStages>();
  return row ?? { became_lead_at: null, first_reply_at: null, qualified_at: null, attended_at: null, fitted_at: null };
}
