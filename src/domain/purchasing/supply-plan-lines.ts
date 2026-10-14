// The supply plan's lines, decided (docs/decisions/0180-supply-plan.md): each proposal read with its names and the
// figures behind it; approved, at the quantity ops leave it, which sends its transfer or drafts its order; or rejected
// with why. A line is claimed before its move is made, so two approvals make one; one whose move is refused, as stock
// moved since, goes back to proposed.

import { auditStatement, type AuditAction } from "../platform/audit.ts";
import { draftOrder } from "./purchase-orders.ts";
import { sendStock } from "../inventory/stock-transit.ts";
import type { Written } from "../platform/audit.ts";
import { type Refusal, refusal } from "../../lib/refusal.ts";

export interface PlanLine {
  readonly id: string;
  readonly kind: "transfer" | "order";
  readonly code: string;
  readonly name: string;
  readonly city: string | null;
  readonly from: string | null;
  readonly to: string | null;
  readonly supplier: string | null;
  readonly proposed: number;
  readonly quantity: number | null;
  readonly usable: number;
  readonly need: number;
  readonly safety: number;
  readonly state: "proposed" | "approved" | "rejected";
  readonly rejectReason: string | null;
  readonly poNumber: number | null;
}

type LineRow = {
  id: string;
  kind: PlanLine["kind"];
  consumable_code: string;
  name: string;
  city: string | null;
  from_name: string | null;
  to_name: string | null;
  supplier: string | null;
  proposed: number;
  quantity: number | null;
  usable: number;
  need: number;
  safety: number;
  state: PlanLine["state"];
  reject_reason: string | null;
  po_number: number | null;
};

/** How long a decided line stays on the page. */
const DECIDED_SHOWN_DAYS = 7;

/** Every open proposal, the plan's and the evening's kit top-ups, and what was decided in the last week. */
export async function planLines(db: D1Database, now: Date): Promise<PlanLine[]> {
  const { results } = await db
    .prepare(
      `SELECT l.id, l.kind, l.consumable_code, c.name, l.city, f.name AS from_name, t.name AS to_name, s.name AS supplier,
         l.proposed, l.quantity, l.usable, l.need, l.safety, l.state, l.reject_reason, o.number AS po_number
       FROM plan_lines l JOIN consumables c ON c.code = l.consumable_code
       LEFT JOIN stock_places f ON f.id = l.from_place LEFT JOIN stock_places t ON t.id = l.to_place
       LEFT JOIN suppliers s ON s.id = l.supplier_id LEFT JOIN purchase_orders o ON o.id = l.po_id
       WHERE l.state = 'proposed' OR l.decided_at >= ?1
       ORDER BY l.kind DESC, c.name COLLATE NOCASE, l.city`,
    )
    .bind(new Date(now.getTime() - DECIDED_SHOWN_DAYS * 24 * 60 * 60 * 1000).toISOString())
    .all<LineRow>();
  return results.map((row) => ({
    id: row.id,
    kind: row.kind,
    code: row.consumable_code,
    name: row.name,
    city: row.city,
    from: row.from_name,
    to: row.to_name,
    supplier: row.supplier,
    proposed: row.proposed,
    quantity: row.quantity,
    usable: row.usable,
    need: row.need,
    safety: row.safety,
    state: row.state,
    rejectReason: row.reject_reason,
    poNumber: row.po_number,
  }));
}

export type Decided =
  { readonly ok: true } | Refusal<"not_found"> | Refusal<"order_state"> | Refusal<"invalid_request">;

const audited = (
  db: D1Database,
  entry: { readonly action: AuditAction; readonly id: string; readonly detail: Record<string, string | number> },
  written: Written,
) =>
  auditStatement(
    db,
    {
      surface: "ops",
      actor: written.actor,
      action: entry.action,
      subject: { kind: "plan_line", id: entry.id },
      requestId: written.requestId,
      detail: entry.detail,
    },
    written.now,
  );

async function notProposed(db: D1Database, id: string): Promise<Decided> {
  const exists = await db.prepare("SELECT 1 FROM plan_lines WHERE id = ?1").bind(id).first();
  return exists === null ? refusal("not_found") : refusal("order_state");
}

type ClaimedRow = {
  kind: PlanLine["kind"];
  consumable_code: string;
  from_place: string | null;
  to_place: string | null;
  supplier_id: string | null;
};

/** The move an approved line makes: its transfer sent, or its order drafted; the order's ID, or the fields refused. */
async function moveOf(db: D1Database, line: ClaimedRow, quantity: number, written: Written) {
  if (line.kind === "transfer") {
    const moved = await sendStock(
      db,
      { code: line.consumable_code, quantity, from: line.from_place ?? "", to: line.to_place ?? "", waitForScan: true },
      written,
    );
    return moved.ok ? { ok: true as const, poId: null } : { ok: false as const, fields: moved.fields };
  }
  const drafted = await draftOrder(
    db,
    {
      supplierId: line.supplier_id ?? "",
      lines: [{ code: line.consumable_code, quantity }],
      expectedOn: null,
      note: "Drafted by the supply plan",
    },
    written,
  );
  return drafted.ok ? { ok: true as const, poId: drafted.id } : { ok: false as const, fields: drafted.fields };
}

/** A proposal approved at `quantity`: claimed, then its move made, or given back where the move is refused. */
export async function approvePlanLine(
  db: D1Database,
  id: string,
  quantity: number,
  written: Written,
): Promise<Decided> {
  const at = written.now.toISOString();
  const claimed = await db
    .prepare(
      `UPDATE plan_lines SET state = 'approved', quantity = ?2, decided_by = ?3, decided_at = ?4
       WHERE id = ?1 AND state = 'proposed'
       RETURNING kind, consumable_code, from_place, to_place, supplier_id`,
    )
    .bind(id, quantity, written.actor.id, at)
    .first<ClaimedRow>();
  if (claimed === null) return notProposed(db, id);
  const moved = await moveOf(db, claimed, quantity, written);
  if (!moved.ok) {
    await db
      .prepare(
        "UPDATE plan_lines SET state = 'proposed', quantity = NULL, decided_by = NULL, decided_at = NULL WHERE id = ?1",
      )
      .bind(id)
      .run();
    return refusal("invalid_request", moved.fields);
  }
  await db.batch([
    db.prepare("UPDATE plan_lines SET po_id = ?2 WHERE id = ?1").bind(id, moved.poId),
    audited(
      db,
      { action: "plan_line.approve", id, detail: { kind: claimed.kind, code: claimed.consumable_code, quantity } },
      written,
    ),
  ]);
  return { ok: true };
}

/** A proposal rejected, with why, which the plan keeps to learn from. */
export async function rejectPlanLine(db: D1Database, id: string, reason: string, written: Written): Promise<Decided> {
  const [rejected] = await db.batch([
    db
      .prepare(
        `UPDATE plan_lines SET state = 'rejected', reject_reason = ?2, decided_by = ?3, decided_at = ?4
         WHERE id = ?1 AND state = 'proposed'`,
      )
      .bind(id, reason, written.actor.id, written.now.toISOString()),
  ]);
  if (rejected?.meta.changes !== 1) return notProposed(db, id);
  await audited(db, { action: "plan_line.reject", id, detail: { reason: reason.slice(0, 40) } }, written).run();
  return { ok: true };
}
