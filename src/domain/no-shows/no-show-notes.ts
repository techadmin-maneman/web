// A ruled no-show as the client's visit page and Payments say it (./no-shows.ts): the ruling, what the charge kept
// and gave back, and whether the client may still dispute it.

import { minutesBetween } from "../../lib/durations.ts";
import type { Charge } from "../../policy/moving-a-visit.ts";
import {
  type NoShowDecision,
  type DisputeState,
  type DisputeRuling,
  isDisputable,
  withinDisputeWindow,
} from "../../policy/no-show.ts";
import { creditSpentOn } from "../visits/visit-facts.ts";

/**
 * What the client is told of a visit they were not home for: that we waited, how long, and what ops
 * ruled. The reason ops gave is theirs, and stays with the ruling.
 */
export interface NoShowNote {
  readonly decision: NoShowDecision;
  /** From the wait's start to the close: how long the technician waited at the door once the visit was due. */
  readonly waited_minutes: number;
  /**
   * What a charge took: in paise, what it kept of the payment, and whether it spent the credit. Null unless ops
   * charged, and on a charge ruled before charges were recorded.
   */
  readonly charge: { readonly kept: number; readonly credit_spent: boolean } | null;
  /** The client's dispute of the charge: open while ops look, then refunded or upheld; null when none was raised. */
  readonly dispute: DisputeState | null;
  /** Whether the client may dispute the charge now: one that took something, not disputed yet. */
  readonly disputable: boolean;
  /** When the days to dispute the charge ran out, once they have, for a charge that took something and was never disputed. */
  readonly dispute_closed_at: string | null;
}

/**
 * What a charge took, read with case `n`: what it kept of the payment, and whether it spent the credit the visit
 * was paid with, which a charge of nothing gives back (src/policy/no-show.ts).
 */
export const CHARGE_TAKEN = `n.kept_amount AS kept_amount,
  (n.charge <> 'nothing' AND ${creditSpentOn("n.appointment_id")}) AS credit_spent`;
interface NoteRow {
  appointment_id: string;
  decision: NoShowDecision;
  wait_started_at: string;
  ended_at: string;
  charge: Charge | null;
  kept_amount: number | null;
  credit_spent: number | null;
  dispute_ruling: DisputeRuling | null;
  dispute_id: string | null;
  dispute_until: string | null;
}

/** What a charge took, read with CHARGE_TAKEN. */
export type ChargeColumns = Pick<NoteRow, "decision" | "charge" | "kept_amount" | "credit_spent">;

export function chargeTaken(row: ChargeColumns): NoShowNote["charge"] {
  if (row.decision !== "charged" || row.charge === null || row.kept_amount === null) return null;
  return { kept: row.kept_amount, credit_spent: row.credit_spent === 1 };
}

function disputeOf(row: NoteRow): DisputeState | null {
  if (row.dispute_id === null) return null;
  return row.dispute_ruling ?? "open";
}

/** Whether the client could ever dispute the charge: one that took something, and that they have not disputed. */
function couldDispute(charge: NoShowNote["charge"], dispute: DisputeState | null): boolean {
  if (charge === null || dispute !== null) return false;
  return isDisputable({ kept: charge.kept, creditSpent: charge.credit_spent });
}

function noteOf(row: NoteRow, now: Date): NoShowNote {
  const charge = chargeTaken(row);
  const dispute = disputeOf(row);
  const open = withinDisputeWindow(row.dispute_until, now);
  const disputeClosed = couldDispute(charge, dispute) && !open;
  return {
    decision: row.decision,
    waited_minutes: minutesBetween(row.wait_started_at, row.ended_at),
    charge,
    dispute,
    disputable: couldDispute(charge, dispute) && open,
    dispute_closed_at: disputeClosed ? row.dispute_until : null,
  };
}

/** The no-show note of each of these visits that has one: its latest case, as it stands at `now`. */
export async function noShowNotes(
  db: D1Database,
  appointmentIds: readonly string[],
  now: Date,
): Promise<Map<string, NoShowNote>> {
  if (appointmentIds.length === 0) return new Map();
  const placeholders = appointmentIds.map((_, index) => `?${String(index + 1)}`).join(", ");
  const { results } = await db
    .prepare(
      `SELECT n.appointment_id, n.decision, n.wait_started_at, COALESCE(n.closed_at, n.wait_ends_at) AS ended_at,
         n.charge, ${CHARGE_TAKEN}, d.id AS dispute_id, d.ruling AS dispute_ruling, n.dispute_until
       FROM no_show_cases n LEFT JOIN no_show_disputes d ON d.case_id = n.id
       WHERE n.appointment_id IN (${placeholders}) ORDER BY n.created_at`,
    )
    .bind(...appointmentIds)
    .all<NoteRow>();
  // Oldest first, so a later case of the same visit is the one kept.
  return new Map(results.map((row) => [row.appointment_id, noteOf(row, now)]));
}
