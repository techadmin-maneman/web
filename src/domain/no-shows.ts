// The client is not home (src/policy/no-show.ts).
//
// "The wait timer starts at check-in and runs config NO_SHOW_WAIT_MIN (15)
// minutes. Close as no-show is disabled until the timer ends." The server
// enforces the wait, not the screen, and on its own clock as well as the
// phone's (docs/decisions/0065-a-technicians-writes-reach-fsm.md).
//
// "Ops then receive three facts: check-in time, distance, and the delivery
// receipt of the day-before or arrival WhatsApp to the client." Nothing here
// charges anybody: "the charge is applied by ops from the evidence, never
// automatically", so a case opens undecided and waits for a person.

import type { VisitType } from "../config/visit-types.ts";
import { indiaDate } from "../lib/india-time.ts";
import { canCloseAsNoShow, noShowWaitEnds, type NoShowDecision, type Waits } from "../policy/no-show.ts";
import { auditStatement, type AuditEntry } from "./audit.ts";
import type { LatestArrival } from "./check-ins.ts";

/** The three facts, with what ops need to read the first one by. */
export interface NoShowCase {
  readonly id: string;
  readonly appointment_id: string;
  readonly visit_date: string | null;
  readonly technician: string | null;
  /** The phone's time for the arrival, held within bounds (src/policy/phone-clock.ts): what the wait ran from. */
  readonly checked_in_at: string;
  /** What the phone itself said, before the bounds; null when it said nothing. */
  readonly phone_checked_in_at: string | null;
  /** When the check-in reached us. Far after the phone's time means a phone with no signal, or a clock set back. */
  readonly received_at: string;
  /** The visit's booked window. */
  readonly window_start: string | null;
  readonly window_end: string | null;
  /** How long after the booked start he checked in, in minutes; negative when he was early. */
  readonly minutes_late: number | null;
  /** Null when there was nothing to measure against. */
  readonly distance_m: number | null;
  readonly message_delivered_at: string | null;
  readonly wait_ends_at: string;
  readonly closed_at: string | null;
  readonly decision: NoShowDecision;
  readonly decided_at: string | null;
}

/** The WhatsApp ops read the receipt of: the day-before reminder, else the arrival notice. */
async function evidenceMessage(
  db: D1Database,
  appointmentId: string,
): Promise<{ id: string; delivered_at: string | null } | null> {
  const row = await db
    .prepare(
      `SELECT id, delivered_at FROM outbound_messages
       WHERE subject_kind = 'appointment' AND subject_id = ?1 AND kind IN ('visit_reminder', 'arrival_notice')
       ORDER BY created_at DESC LIMIT 1`,
    )
    .bind(appointmentId)
    .first<{ id: string; delivered_at: string | null }>();
  return row;
}

export type Readiness =
  | { readonly kind: "ready"; readonly checkIn: LatestArrival; readonly waitEndsAt: Date }
  | { readonly kind: "too_early"; readonly waitEndsAt: Date }
  | { readonly kind: "no_check_in" };

/** Whether the job may close as a no-show now: a check-in, and its wait run out on both clocks. */
export function noShowReadiness(
  checkIn: LatestArrival | null,
  type: VisitType,
  now: Date,
  /** The waits in force, which ops set (ADR 0061). */
  wait: Waits,
): Readiness {
  if (checkIn === null) return { kind: "no_check_in" };
  const waitEndsAt = noShowWaitEnds(checkIn, type, wait);
  if (!canCloseAsNoShow(checkIn, type, now, wait)) return { kind: "too_early", waitEndsAt };
  return { kind: "ready", checkIn, waitEndsAt };
}

/**
 * Opens the case ops rule on, once the close has landed. The case is keyed on
 * the check-in, so a replay of the same close lands once. Returns its ID.
 */
export async function openNoShowCase(
  db: D1Database,
  input: { appointmentId: string; checkIn: LatestArrival; waitEndsAt: Date; now: Date },
): Promise<string> {
  const message = await evidenceMessage(db, input.appointmentId);
  const at = input.now.toISOString();
  await db
    .prepare(
      `INSERT INTO no_show_cases (id, checkin_id, appointment_id, wait_started_at, wait_ends_at, closed_at,
         message_id, message_delivered_at, decision, created_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 'undecided', ?6)
       ON CONFLICT (checkin_id) DO UPDATE SET
         closed_at = COALESCE(no_show_cases.closed_at, excluded.closed_at),
         message_id = COALESCE(no_show_cases.message_id, excluded.message_id),
         message_delivered_at = COALESCE(no_show_cases.message_delivered_at, excluded.message_delivered_at)`,
    )
    .bind(
      crypto.randomUUID(),
      input.checkIn.id,
      input.appointmentId,
      input.checkIn.at.toISOString(),
      input.waitEndsAt.toISOString(),
      at,
      message?.id ?? null,
      message?.delivered_at ?? null,
    )
    .run();
  const stored = await db
    .prepare("SELECT id FROM no_show_cases WHERE checkin_id = ?1")
    .bind(input.checkIn.id)
    .first<{ id: string }>();
  if (stored === null) throw new Error("the no-show case was not written");
  return stored.id;
}

/** The cases ops have still to rule on, oldest first, then the decided ones. */
export async function listNoShowCases(
  db: D1Database,
  decision: NoShowDecision | "all",
  limit: number,
): Promise<NoShowCase[]> {
  const { results } = await db
    .prepare(
      `SELECT n.id, n.appointment_id, n.wait_started_at AS checked_in_at, c.claimed_at, c.created_at AS received_at,
         c.distance_m, n.message_delivered_at, n.wait_ends_at, n.closed_at, n.decision, n.decided_at,
         a.window_start, a.window_end, t.name AS technician
       FROM no_show_cases n
       JOIN checkins c ON c.id = n.checkin_id
       JOIN appointments a ON a.id = n.appointment_id
       LEFT JOIN technicians t ON t.id = c.technician_id
       WHERE (?1 = 'all' OR n.decision = ?1)
       ORDER BY n.decision = 'undecided' DESC, n.created_at
       LIMIT ?2`,
    )
    .bind(decision, limit)
    .all<{
      id: string;
      appointment_id: string;
      checked_in_at: string;
      claimed_at: string | null;
      received_at: string;
      distance_m: number | null;
      message_delivered_at: string | null;
      wait_ends_at: string;
      closed_at: string | null;
      decision: NoShowDecision;
      decided_at: string | null;
      window_start: string | null;
      window_end: string | null;
      technician: string | null;
    }>();
  return results.map((row) => ({
    id: row.id,
    appointment_id: row.appointment_id,
    visit_date: row.window_start === null ? null : indiaDate(new Date(row.window_start)),
    technician: row.technician,
    checked_in_at: row.checked_in_at,
    phone_checked_in_at: row.claimed_at,
    received_at: row.received_at,
    window_start: row.window_start,
    window_end: row.window_end,
    minutes_late:
      row.window_start === null
        ? null
        : Math.round((Date.parse(row.checked_in_at) - Date.parse(row.window_start)) / 60_000),
    distance_m: row.distance_m,
    message_delivered_at: row.message_delivered_at,
    wait_ends_at: row.wait_ends_at,
    closed_at: row.closed_at,
    decision: row.decision,
    decided_at: row.decided_at,
  }));
}

/**
 * Ops charge or waive the visit. Ruled once: a second ruling on the same case changes nothing. The ruling's
 * audit entry goes in the same batch (src/domain/audit.ts).
 */
export async function decideNoShow(
  db: D1Database,
  input: {
    caseId: string;
    decision: Exclude<NoShowDecision, "undecided">;
    actor: string;
    audit: AuditEntry;
    now: Date;
  },
): Promise<boolean> {
  const open = await db
    .prepare("SELECT 1 FROM no_show_cases WHERE id = ?1 AND decision = 'undecided'")
    .bind(input.caseId)
    .first();
  if (open === null) return false;
  await db.batch([
    db
      .prepare(
        `UPDATE no_show_cases SET decision = ?2, decided_by = ?3, decided_at = ?4
         WHERE id = ?1 AND decision = 'undecided'`,
      )
      .bind(input.caseId, input.decision, input.actor, input.now.toISOString()),
    auditStatement(db, input.audit, input.now),
  ]);
  return true;
}
