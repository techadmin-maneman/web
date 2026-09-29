// The audit log (migrations/0005_audit.sql, docs/decisions/0031-access-and-audit.md).
// An entry goes in one batch with the action it records, so both happen or
// neither: nothing audited happens unaudited, and nothing is recorded that did
// not happen. What only reads, an export or a photograph viewed, writes its
// entry first, and a failed write stops the read.
//
// Every call to the ops console is recorded as it arrives by auditCall, and the
// member of staff behind it named, in src/http/audit.ts.

import type { Surface } from "../config/environments.ts";

/** Every action the log records. Phase 2 milestones add theirs here. */
export const AUDIT_ACTIONS = [
  "ops.call",
  // The client's profile (docs/decisions/0042-client-profile.md).
  "consent.switch",
  "number_change.request",
  "number_change.withdraw",
  "number_change.decide",
  "deletion.request",
  "deletion.decide",
  // A held referral grant (docs/decisions/0048-referrals.md), and an invite ops attach to a client who booked away
  // from its page (docs/decisions/0089-an-invite-is-not-lost.md).
  "referral.decide",
  "referral.attach",
  // Ops opening one of a client's photographs (docs/decisions/0031-access-and-audit.md).
  "photo.view",
  // A client's rights over their data (docs/decisions/0049-dpdp.md).
  "pincode.launch",
  "data.export",
  "grievance.raise",
  "grievance.resolve",
  // Field operations (docs/decisions/0052-technician-sessions.md): ops ruling on a
  // no-show from its evidence, and ops revoking the phone a technician works from.
  "no_show.decide",
  "technician_device.revoke",
  // A client disputing a no-show's charge, and ops ruling on it (docs/decisions/0096-a-no-shows-charge-and-its-dispute.md).
  "no_show.dispute",
  "no_show.dispute_rule",
  // Leave ops record on a technician, which then refuses those days to booking
  // and to the dispatch board alike (ADR 0062).
  "technician.leave",
  "technician.leave_cancelled",
  // The business inputs ops set for themselves (docs/decisions/0061-ops-editable-inputs.md):
  // one of the rules, a price from a date, and whether we go to a pincode. A price still to
  // come taken back, and an area's name (docs/decisions/0071-what-ops-see-before-a-setting-changes.md).
  "setting.change",
  "price.set",
  "price.withdraw",
  "pincode.set",
  "pincode.rename",
  // The days no visit is offered, which the runbook's SQL set before (docs/decisions/0088-every-policy-in-the-console.md).
  "blackout.add",
  "blackout.remove",
  // The services clients book (docs/decisions/0085-services-ops-can-edit.md): one added to a kind, renamed, given
  // another length, a kind's put in another order, one retired from a day, and one offered again.
  "service.add",
  "service.rename",
  "service.length",
  "service.reorder",
  "service.retire",
  "service.restore",
  // Ops putting a client's service-visit credits right by hand (docs/decisions/0068-a-paid-hold-is-kept.md).
  "credit.adjust",
  // Ops calling a client about a move he had not heard of (docs/decisions/0069-dispatch-under-concurrency.md).
  "dispatch.client_told",
  // The consumables ops keep and what each service is expected to use, the job sheet the technician
  // app reads, and the stock in each kit and the central store (docs/decisions/0087-consumables-and-stock.md).
  "consumable.add",
  "consumable.change",
  "consumable.retire",
  "consumable.restore",
  "consumable.usage",
  "job_sheet.set",
  "stock.receive",
  "stock.transfer",
  "stock.count",
  "stock.write_off",
  // Whose a task on the Tasks board is, a visit left partly done that ops closed without a follow-up, and an address
  // a client gave ops on the phone (docs/decisions/0092-task-owners.md).
  "task.assign",
  "task.hand_back",
  "task.close",
  "address.given_to_ops",
] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export type AuditActor = {
  readonly kind: "staff" | "service" | "client" | "technician" | "system";
  readonly id: string;
};

export interface AuditEntry {
  readonly surface: Surface;
  readonly actor: AuditActor;
  readonly action: AuditAction;
  readonly subject?: { readonly kind: string; readonly id: string };
  readonly requestId: string | null;
  /** IDs, counts and codes only. Never a name, a mobile number or an image reference. */
  readonly detail?: Readonly<Record<string, string | number | boolean>>;
}

const COLUMNS = "at, surface, actor_kind, actor, action, subject_kind, subject_id, request_id, detail";

function valuesOf(entry: AuditEntry, now: Date) {
  return [
    now.toISOString(),
    entry.surface,
    entry.actor.kind,
    entry.actor.id,
    entry.action,
    entry.subject?.kind ?? null,
    entry.subject?.id ?? null,
    entry.requestId,
    entry.detail === undefined ? null : JSON.stringify(entry.detail),
  ];
}

/** The entry as a statement, to run in one batch with the action it records: both happen, or neither. */
export function auditStatement(db: D1Database, entry: AuditEntry, now: Date): D1PreparedStatement {
  return db
    .prepare(`INSERT INTO audit_log (${COLUMNS}) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)`)
    .bind(...valuesOf(entry, now));
}

/**
 * The entry for an insert earlier in the same batch that may write nothing, as
 * one that skips a duplicate, or a stock count whose place moved since it was
 * read, does: it is written only if that insert's row, `id` in `table`, is there.
 */
export function auditStatementIfWritten(
  db: D1Database,
  entry: AuditEntry,
  now: Date,
  written: {
    readonly table:
      "grievances" | "consents" | "referral_attributions" | "stock_movements" | "task_closures" | "no_show_disputes";
    readonly id: string;
  },
): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO audit_log (${COLUMNS})
       SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9 WHERE EXISTS (SELECT 1 FROM ${written.table} WHERE id = ?10)`,
    )
    .bind(...valuesOf(entry, now), written.id);
}

export async function recordAudit(db: D1Database, entry: AuditEntry, now: Date): Promise<void> {
  await auditStatement(db, entry, now).run();
}
