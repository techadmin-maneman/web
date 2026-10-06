// A visit cancelled, by the client or by ops for them (./visit-changes.ts): in one batch, the visit, its audit, the
// refund owed or the credit given back, and the message; then the refund.

import type { Logger } from "../../log.ts";
import { visitMessageOnChange } from "../messages/visit-messages.ts";
import { type RefundDeps, type OwedRefund, refundAtOnce, type Canceller } from "../money/cancel-refunds.ts";
import { type AuditEntry, auditStatementIfWritten } from "../ops/audit.ts";
import { visitBegun } from "./visit-begun.ts";
import type { ChangeTerms } from "./visit-changes.ts";
import { STEPS } from "./visit-status.ts";

/** A cancel ops make in the console: who made it, their reason, the terms they chose, and its audit entry. */
export interface OpsCancel {
  readonly staff: string;
  readonly reason: string;
  readonly terms: "free" | "client";
  readonly audit: AuditEntry;
}

type Cancelled =
  | {
      readonly kind: "cancelled";
      readonly refund: number;
      readonly kept: number;
      /** The refund could not be settled in the request, so the cron's cancel_refunds job asks for it. */
      readonly refundPending: boolean;
    }
  | { readonly kind: "not_changeable" };
interface CancelDeps extends RefundDeps {
  /** Queues the cancel's confirmation to the client. */
  readonly notify?: (messageId: string) => Promise<unknown>;
}

/** The refund the cancel owes the client; null when it gives nothing back. */
function refundOwed(terms: ChangeTerms, change: CancelOf): OwedRefund | null {
  const { visit, payment, cancel } = terms;
  if (payment === null || cancel.refund === 0) return null;
  return {
    changeId: change.changeId,
    cancelledBy: cancelledBy(change),
    appointmentId: visit.id,
    personId: visit.personId,
    razorpayPaymentId: payment.razorpayPaymentId,
    amount: cancel.refund,
  };
}

/**
 * Cancels the visit on the terms given, then refunds what the terms give back. The change is claimed in the cancel's
 * batch, so it happens once, and never once the visit has begun. Once the visit
 * is cancelled it stays cancelled, whatever fails after: a refund Razorpay refuses is left to ops, who are alerted,
 * and one the request could not settle is left to the cron's cancel_refunds job.
 */
export async function cancelVisit({
  db,
  deps,
  terms,
  now,
  options,
}: {
  db: D1Database;
  deps: CancelDeps;
  terms: ChangeTerms;
  now: Date;
  options: CancelOptions;
}): Promise<Cancelled> {
  const change: CancelOf = { changeId: crypto.randomUUID(), ops: options.ops ?? null };
  const messageId = await writeCancel(db, terms, change, now);
  if (messageId === null) return { kind: "not_changeable" };
  const owed = refundOwed(terms, change);
  const settled = owed === null || (await refundAtOnce({ db, deps, owed, now, log: options.log }));
  await tellClient(deps, messageId, options.log);
  return { kind: "cancelled", refund: terms.cancel.refund, kept: terms.cancel.kept, refundPending: !settled };
}

/** Queues the client's message. One the queue refuses is in the outbox, and the sweeper sends it minutes later. */
async function tellClient(deps: CancelDeps, messageId: string, log: Logger): Promise<void> {
  try {
    await deps.notify?.(messageId);
  } catch (error) {
    log.warn("cancel_message_not_queued", { message_id: messageId, error });
  }
}

interface CancelOptions {
  readonly log: Logger;
  /** Set when ops cancel the visit in the console; left out for the client's own cancel. */
  readonly ops?: OpsCancel;
}

/** A cancel as it is written: its claim's ID, and ops' part in it, if it is theirs. */
interface CancelOf {
  readonly changeId: string;
  readonly ops: OpsCancel | null;
}

/** Who the cancel is by, as a refund's note and ops' alert name them. */
const cancelledBy = (change: CancelOf): Canceller => (change.ops === null ? "the client" : "ops");
/** The client's message: the answer to their own cancel, or the news of one ops made. */
const messageKindOf = (change: CancelOf) => (change.ops === null ? "cancel_confirmation" : "visit_cancelled");
/** Ops' cancel in the audit log, written only if the claim was; the client's own has none. */
function auditedCancel(db: D1Database, change: CancelOf, now: Date): D1PreparedStatement[] {
  if (change.ops === null) return [];
  return [auditStatementIfWritten(db, change.ops.audit, now, { table: "visit_changes", id: change.changeId })];
}

/**
 * The cancel claimed as the visit's one change that ends it, only while it is still to come and has not begun. Its
 * refund is settled at once when it gives nothing back.
 */
function claimCancel(db: D1Database, terms: ChangeTerms, change: CancelOf, now: Date): D1PreparedStatement {
  const { visit, notice, payment, cancel } = terms;
  const settledAt = refundOwed(terms, change) === null ? now.toISOString() : null;
  return db
    .prepare(
      `INSERT INTO visit_changes (id, appointment_id, person_id, kind, notice, was_start, refund_amount, kept_amount,
         payment_id, created_at, refund_settled_at, cancelled_by, cancel_reason, ops_terms)
       SELECT ?1, ?2, ?3, 'cancelled', ?4, ?5, ?6, ?7, ?8, ?9, ?11, ?12, ?13, ?14 FROM appointments a
       WHERE a.id = ?2 AND a.deleted_at IS NULL AND a.status IN (SELECT value FROM json_each(?10))
         AND NOT ${visitBegun("a")}
       ON CONFLICT DO NOTHING`,
    )
    .bind(
      change.changeId,
      visit.id,
      visit.personId,
      notice,
      visit.start.toISOString(),
      cancel.refund,
      cancel.kept,
      payment?.id ?? null,
      now.toISOString(),
      JSON.stringify(STEPS.cancel.from),
      settledAt,
      change.ops?.staff ?? null,
      change.ops?.reason ?? null,
      change.ops?.terms ?? null,
    );
}

/** A visit credit given back by the cancel. A clawback between the terms and the cancel still stops it coming back. */
function restoredCredit(db: D1Database, terms: ChangeTerms, change: CancelOf, now: Date): D1PreparedStatement[] {
  if (terms.credit?.outcome !== "restored") return [];
  return [
    db
      .prepare(
        `INSERT INTO credit_ledger (id, person_id, kind, visits, grant_id, source_kind, source_id, created_at)
         SELECT ?1, ?2, 'restore', 1, ?3, 'appointment', ?4, ?5
         WHERE NOT EXISTS (SELECT 1 FROM credit_ledger WHERE grant_id = ?3 AND kind = 'clawback')
           AND EXISTS (SELECT 1 FROM visit_changes WHERE id = ?6)`,
      )
      .bind(
        crypto.randomUUID(),
        terms.visit.personId,
        terms.credit.grantId,
        terms.visit.id,
        now.toISOString(),
        change.changeId,
      ),
  ];
}

/**
 * The cancel, in one batch: the change claimed, the visit cancelled, the client's message, any
 * credit given back and ops' audit entry, each written only if the claim was. The message's ID, or null when the visit
 * could not be cancelled.
 */
async function writeCancel(db: D1Database, terms: ChangeTerms, change: CancelOf, now: Date): Promise<string | null> {
  const { visit } = terms;
  const message = visitMessageOnChange(db, {
    personId: visit.personId,
    appointmentId: visit.id,
    kind: messageKindOf(change),
    now,
    changeId: change.changeId,
  });
  const [claimed] = await db.batch([
    claimCancel(db, terms, change, now),
    db
      .prepare(
        `UPDATE appointments SET status = 'cancelled', synced_at = ?2
         WHERE id = ?1 AND EXISTS (SELECT 1 FROM visit_changes WHERE id = ?3)`,
      )
      .bind(visit.id, now.toISOString(), change.changeId),
    message.statement,
    ...restoredCredit(db, terms, change, now),
    ...auditedCancel(db, change, now),
  ]);
  return claimed?.meta.changes === 1 ? message.id : null;
}
