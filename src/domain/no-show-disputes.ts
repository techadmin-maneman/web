// A client's dispute of a no-show's charge, and ops' ruling on it (src/policy/no-show.ts, RULES[6];
// docs/decisions/0096-a-no-shows-charge-and-its-dispute.md).
//
// "The client disputes a charge in the app, and ops rule Refund or Uphold in the console with a reason, and the
// client is told." One dispute a charge, of a charge that took something: money it kept, or the credit it spent.
// Refunded gives both back, as a waiver that gives them does; upheld keeps them. The client's reason and ops' are
// kept on the dispute alone: the audit log holds IDs and codes only (ADR 0031), and an erasure blanks both.

import { chargedCredit, isDisputable, type DisputeRuling } from "../policy/no-show.ts";
import type { Charge } from "../policy/moving-a-visit.ts";
import { auditStatementIfRuled, auditStatementIfWritten, type AuditEntry, type RulingClaim } from "./audit.ts";
import { CHARGE_TAKEN, creditBack, type NoShowRefund } from "./no-shows.ts";
import { rulingMessage } from "./visit-messages.ts";

interface ChargedCase {
  id: string;
  charge: Charge | null;
  kept_amount: number | null;
  credit_spent: number | null;
  dispute_id: string | null;
}

export type Raised =
  | { readonly kind: "raised"; readonly id: string }
  | { readonly kind: "not_found" }
  | { readonly kind: "not_disputable" }
  | { readonly kind: "already_disputed" };

/**
 * Raises the client's dispute of the charge on their visit: its latest case, charged, with a charge that took
 * something. The one-a-charge key settles two taps at once, and the audit entry goes in only with the dispute.
 */
export async function raiseDispute(
  db: D1Database,
  input: {
    readonly personId: string;
    readonly appointmentId: string;
    readonly reason: string;
    readonly now: Date;
    readonly audit: (disputeId: string) => AuditEntry;
  },
): Promise<Raised> {
  const charged = await db
    .prepare(
      `SELECT n.id, n.charge, ${CHARGE_TAKEN}, d.id AS dispute_id
       FROM no_show_cases n JOIN appointments a ON a.id = n.appointment_id
       LEFT JOIN no_show_disputes d ON d.case_id = n.id
       WHERE n.appointment_id = ?1 AND a.person_id = ?2 AND n.decision = 'charged'
       ORDER BY n.created_at DESC LIMIT 1`,
    )
    .bind(input.appointmentId, input.personId)
    .first<ChargedCase>();
  if (charged === null) return { kind: "not_found" };
  if (charged.dispute_id !== null) return { kind: "already_disputed" };
  // A charge ruled before charges were recorded says nothing of what it took, so there is nothing to rule back.
  if (charged.charge === null || charged.kept_amount === null) return { kind: "not_disputable" };
  if (!isDisputable({ kept: charged.kept_amount, creditSpent: charged.credit_spent === 1 })) {
    return { kind: "not_disputable" };
  }

  const id = crypto.randomUUID();
  const [inserted] = await db.batch([
    db
      .prepare(
        `INSERT INTO no_show_disputes (id, case_id, person_id, reason, created_at) VALUES (?1, ?2, ?3, ?4, ?5)
         ON CONFLICT (case_id) DO NOTHING`,
      )
      .bind(id, charged.id, input.personId, input.reason, input.now.toISOString()),
    auditStatementIfWritten(db, input.audit(id), input.now, { table: "no_show_disputes", id }),
  ]);
  return inserted?.meta.changes === 1 ? { kind: "raised", id } : { kind: "already_disputed" };
}

/** A dispute ops have still to rule on, with the evidence of its case. */
export interface OpenDispute {
  readonly id: string;
  readonly case_id: string;
  readonly appointment_id: string;
  /** Whose visit it was; null once they have been erased. */
  readonly person: { readonly id: string; readonly name: string } | null;
  /** The client's own words; null once they have been erased. */
  readonly reason: string | null;
  readonly raised_at: string;
  /** What the charge took: in paise, of the payment, and whether it spent the credit. */
  readonly kept: number;
  readonly credit_spent: boolean;
  readonly window_start: string | null;
  readonly checked_in_at: string;
  readonly received_at: string;
  readonly distance_m: number | null;
  readonly radius_m: number;
  readonly message_delivered_at: string | null;
  readonly closed_at: string | null;
}

interface OpenDisputeRow {
  id: string;
  case_id: string;
  appointment_id: string;
  person_id: string | null;
  person_name: string | null;
  reason: string | null;
  raised_at: string;
  kept_amount: number | null;
  credit_spent: number | null;
  window_start: string | null;
  checked_in_at: string;
  received_at: string;
  distance_m: number | null;
  radius_m: number;
  message_delivered_at: string | null;
  closed_at: string | null;
}

/** The disputes ops have still to rule on, oldest first. */
export async function openDisputes(db: D1Database, limit: number): Promise<OpenDispute[]> {
  const { results } = await db
    .prepare(
      `SELECT d.id, d.case_id, n.appointment_id, pe.id AS person_id, pe.name AS person_name, d.reason,
         d.created_at AS raised_at, ${CHARGE_TAKEN}, a.window_start, n.wait_started_at AS checked_in_at,
         c.created_at AS received_at, c.distance_m, c.radius_m,
         COALESCE(n.message_delivered_at, o.delivered_at) AS message_delivered_at, n.closed_at
       FROM no_show_disputes d
       JOIN no_show_cases n ON n.id = d.case_id
       JOIN checkins c ON c.id = n.checkin_id
       JOIN appointments a ON a.id = n.appointment_id
       LEFT JOIN people pe ON pe.id = d.person_id AND pe.erased_at IS NULL
       LEFT JOIN outbound_messages o ON o.id = n.message_id
       WHERE d.ruling IS NULL
       ORDER BY d.created_at
       LIMIT ?1`,
    )
    .bind(limit)
    .all<OpenDisputeRow>();
  return results.map((row) => ({
    id: row.id,
    case_id: row.case_id,
    appointment_id: row.appointment_id,
    person: row.person_id === null || row.person_name === null ? null : { id: row.person_id, name: row.person_name },
    reason: row.reason,
    raised_at: row.raised_at,
    kept: row.kept_amount ?? 0,
    credit_spent: row.credit_spent === 1,
    window_start: row.window_start,
    checked_in_at: row.checked_in_at,
    received_at: row.received_at,
    distance_m: row.distance_m,
    radius_m: row.radius_m,
    message_delivered_at: row.message_delivered_at,
    closed_at: row.closed_at,
  }));
}

export interface DisputeRuled {
  /** The client's WhatsApp about the ruling, to queue; null for a client since erased. */
  readonly messageId: string | null;
  /** What a refund gives back of the payment, after the batch; null on an upheld charge, or one that kept no money. */
  readonly refund: NoShowRefund | null;
}

interface RulableDispute {
  appointment_id: string;
  person_id: string | null;
  charge: Charge;
  kept_amount: number;
}

/**
 * Ops refund or uphold a disputed charge, with their reason, which stays on the dispute. Ruled once: a second
 * ruling writes nothing beside it (RulingClaim, src/domain/audit.ts). In the one batch: the ruling, its audit entry,
 * the client's message, and for a refund the credit the charge spent, back in its grant as a waiver's is. What the
 * charge kept of the payment is refunded after the batch.
 */
export async function ruleOnDispute(
  db: D1Database,
  input: {
    readonly disputeId: string;
    readonly ruling: DisputeRuling;
    readonly reason: string;
    readonly actor: string;
    readonly audit: AuditEntry;
    readonly now: Date;
  },
): Promise<DisputeRuled | null> {
  const open = await db
    .prepare(
      `SELECT n.appointment_id, pe.id AS person_id, n.charge, n.kept_amount
       FROM no_show_disputes d JOIN no_show_cases n ON n.id = d.case_id
       LEFT JOIN people pe ON pe.id = d.person_id AND pe.erased_at IS NULL
       WHERE d.id = ?1 AND d.ruling IS NULL AND n.charge IS NOT NULL AND n.kept_amount IS NOT NULL`,
    )
    .bind(input.disputeId)
    .first<RulableDispute>();
  if (open === null) return null;
  const refunded = input.ruling === "refunded";
  const ruled: RulingClaim = { table: "no_show_disputes", id: input.disputeId, rulingId: crypto.randomUUID() };
  const message =
    open.person_id === null
      ? null
      : rulingMessage(
          db,
          {
            personId: open.person_id,
            appointmentId: open.appointment_id,
            kind: "no_show_dispute_ruled",
            now: input.now,
          },
          ruled,
        );
  const creditWasSpent = chargedCredit(open.charge) === "lost";
  const [ruling] = await db.batch([
    db
      .prepare(
        `UPDATE no_show_disputes SET ruling = ?2, ruled_by = ?3, ruled_at = ?4, ruling_reason = ?5, ruling_id = ?6
         WHERE id = ?1 AND ruling IS NULL`,
      )
      .bind(input.disputeId, input.ruling, input.actor, input.now.toISOString(), input.reason, ruled.rulingId),
    auditStatementIfRuled(db, input.audit, input.now, ruled),
    ...(message === null ? [] : [message.statement]),
    ...(refunded && creditWasSpent ? [creditBack(db, open.appointment_id, input.now, ruled)] : []),
  ]);
  // Another member of staff ruled first: their ruling stands, and nothing of this one was written.
  if (ruling?.meta.changes !== 1) return null;
  return {
    messageId: message?.id ?? null,
    refund:
      refunded && open.kept_amount > 0
        ? {
            appointmentId: open.appointment_id,
            personId: open.person_id,
            amount: open.kept_amount,
            why: "refunded on dispute",
          }
        : null,
  };
}
