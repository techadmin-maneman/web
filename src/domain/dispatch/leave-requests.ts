// A technician's ask for leave from their phone (migration 0195), which Operations approve or decline on Tasks. An
// approval records the leave as ops record it themselves (./leave.ts), so the board and booking keep off those days
// at once; a decline records nothing but the decision. The technician sees each ask and where it stands.

import type { Rows } from "../../lib/rows.ts";
import { addDays } from "../../lib/india-time.ts";
import type { AuditEntry } from "../platform/audit.ts";
import { LEAVE_MAX_DAYS, recordLeave } from "./leave.ts";

type Row = Rows["leave_requests"];

export interface LeaveRequest {
  readonly id: string;
  readonly from: string;
  readonly to: string;
  readonly note: string | null;
  readonly state: "asked" | "approved" | "declined";
  readonly requested_at: string;
}

const requestOf = (row: Row): LeaveRequest => ({
  id: row.id,
  from: row.from_date,
  to: row.to_date,
  note: row.note,
  state: row.decision === "approved" || row.decision === "declined" ? row.decision : "asked",
  requested_at: row.requested_at,
});

/** The technician's asks still to come or under way, the latest first. */
export async function requestsOf(db: D1Database, technicianId: string, today: string): Promise<LeaveRequest[]> {
  const { results } = await db
    .prepare(
      `SELECT * FROM leave_requests WHERE technician_id = ?1 AND to_date >= ?2
       ORDER BY requested_at DESC, rowid DESC LIMIT 50`,
    )
    .bind(technicianId, today)
    .all<Row>();
  return results.map(requestOf);
}

/** An ask for leave from today on, as far ahead as leave may be recorded; "bad_dates" for any other. */
export async function requestLeave(
  db: D1Database,
  ask: { technicianId: string; from: string; to: string; note: string | null; today: string; now: Date },
): Promise<"asked" | "bad_dates"> {
  if (ask.from < ask.today || ask.to < ask.from || ask.to > addDays(ask.today, LEAVE_MAX_DAYS)) return "bad_dates";
  await db
    .prepare(
      `INSERT INTO leave_requests (id, technician_id, from_date, to_date, note, requested_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6)`,
    )
    .bind(crypto.randomUUID(), ask.technicianId, ask.from, ask.to, ask.note, ask.now.toISOString())
    .run();
  return "asked";
}

/**
 * Ops' decision on an ask still open: an approval records the leave and names it, a decline only the decision. The ask
 * is claimed first, so two decisions at once record one. "gone" for an ask decided already or never made.
 */
export async function decideLeaveRequest(
  db: D1Database,
  input: {
    readonly id: string;
    readonly decision: "approved" | "declined";
    readonly staff: string;
    readonly today: string;
    readonly now: Date;
    readonly audit: AuditEntry;
  },
): Promise<"decided" | "gone"> {
  const at = input.now.toISOString();
  const claimed = await db
    .prepare(
      `UPDATE leave_requests SET decision = ?2, decided_by = ?3, decided_at = ?4 WHERE id = ?1 AND decision IS NULL
       RETURNING *`,
    )
    .bind(input.id, input.decision, input.staff, at)
    .first<Row>();
  if (claimed === null) return "gone";
  if (input.decision === "declined") return "decided";
  const recorded = await recordLeave({
    db,
    leave: {
      technicianId: claimed.technician_id,
      from: claimed.from_date,
      to: claimed.to_date,
      fromTime: null,
      toTime: null,
      note: claimed.note,
      actor: input.staff,
    },
    today: input.today,
    now: input.now,
    audit: input.audit,
  });
  if (recorded.kind === "recorded") {
    await db.prepare("UPDATE leave_requests SET leave_id = ?2 WHERE id = ?1").bind(input.id, recorded.id).run();
  }
  return "decided";
}
