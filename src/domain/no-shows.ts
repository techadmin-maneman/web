// The client is not home (src/policy/no-show.ts).
//
// "The wait timer starts at check-in and runs config NO_SHOW_WAIT_MIN (15)
// minutes. Close as no-show is disabled until the timer ends." The server
// enforces the wait, not the screen.
//
// "Ops then receive three facts: check-in time, distance, and the delivery
// receipt of the day-before or arrival WhatsApp to the client." Nothing here
// charges anybody: "the charge is applied by ops from the evidence, never
// automatically", so a case opens undecided and waits for a person.

import type { VisitType } from "../config/visit-types.ts";
import { canCloseAsNoShow, waitEndsAt, type NoShowDecision } from "../policy/no-show.ts";

/** The three facts, and nothing else. */
export interface NoShowCase {
  readonly id: string;
  readonly appointment_id: string;
  readonly visit_date: string | null;
  readonly technician: string | null;
  readonly checked_in_at: string;
  readonly distance_m: number;
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

export type Closing =
  | { readonly kind: "closed"; readonly caseId: string; readonly waitEndsAt: string }
  | { readonly kind: "too_early"; readonly waitEndsAt: string }
  | { readonly kind: "no_check_in" };

/**
 * Opens the case and closes the job as a no-show, once the wait has run. The
 * case is keyed on the check-in, so a replay of the same close lands once.
 */
export async function closeAsNoShow(
  db: D1Database,
  input: {
    appointmentId: string;
    type: VisitType;
    checkIn: { id: string; at: string; distanceM: number } | null;
    now: Date;
  },
): Promise<Closing> {
  const { checkIn } = input;
  if (checkIn === null) return { kind: "no_check_in" };

  const checkedInAt = new Date(checkIn.at);
  const ends = waitEndsAt(checkedInAt, input.type);
  if (!canCloseAsNoShow(checkedInAt, input.type, input.now)) {
    return { kind: "too_early", waitEndsAt: ends.toISOString() };
  }

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
      checkIn.id,
      input.appointmentId,
      checkIn.at,
      ends.toISOString(),
      at,
      message?.id ?? null,
      message?.delivered_at ?? null,
    )
    .run();
  const stored = await db
    .prepare("SELECT id FROM no_show_cases WHERE checkin_id = ?1")
    .bind(checkIn.id)
    .first<{ id: string }>();
  if (stored === null) throw new Error("the no-show case was not written");
  return { kind: "closed", caseId: stored.id, waitEndsAt: ends.toISOString() };
}

/** The cases ops have still to rule on, oldest first, then the decided ones. */
export async function listNoShowCases(
  db: D1Database,
  decision: NoShowDecision | "all",
  limit: number,
): Promise<NoShowCase[]> {
  const { results } = await db
    .prepare(
      `SELECT n.id, n.appointment_id, n.wait_started_at AS checked_in_at, c.distance_m, n.message_delivered_at,
         n.wait_ends_at, n.closed_at, n.decision, n.decided_at, a.window_start, t.name AS technician
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
      distance_m: number;
      message_delivered_at: string | null;
      wait_ends_at: string;
      closed_at: string | null;
      decision: NoShowDecision;
      decided_at: string | null;
      window_start: string | null;
      technician: string | null;
    }>();
  return results.map((row) => ({
    id: row.id,
    appointment_id: row.appointment_id,
    visit_date: row.window_start === null ? null : row.window_start.slice(0, 10),
    technician: row.technician,
    checked_in_at: row.checked_in_at,
    distance_m: row.distance_m,
    message_delivered_at: row.message_delivered_at,
    wait_ends_at: row.wait_ends_at,
    closed_at: row.closed_at,
    decision: row.decision,
    decided_at: row.decided_at,
  }));
}

/** Ops charge or waive the visit. Ruled once: a second ruling on the same case changes nothing. */
export async function decideNoShow(
  db: D1Database,
  input: { caseId: string; decision: Exclude<NoShowDecision, "undecided">; actor: string; now: Date },
): Promise<boolean> {
  const ruled = await db
    .prepare(
      `UPDATE no_show_cases SET decision = ?2, decided_by = ?3, decided_at = ?4
       WHERE id = ?1 AND decision = 'undecided' RETURNING id`,
    )
    .bind(input.caseId, input.decision, input.actor, input.now.toISOString())
    .first();
  return ruled !== null;
}
