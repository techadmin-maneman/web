// The message asking a client to confirm a move to another day (src/domain/dispatch/move-proposals.ts): written from
// the proposal as it stands when it is sent, so one withdrawn, answered, run out or made moot since is not sent.

import { shortDate } from "@maneman/web-kit/dates";
import { VISIT_TYPE_NAMES, type VisitType } from "../../config/visit-types.ts";
import type { BookingWindow } from "../../config/scheduling.ts";
import { indiaDate } from "../../lib/india-time.ts";
import { firstNameOf } from "../../lib/names.ts";
import { loadSlotSchedule } from "../booking/slot-times.ts";
import { readOpsInputs } from "../platform/ops-settings.ts";
import { arrivalHours, hoursOfWindow, underVisitsConsent, type Composed } from "./visit-message-text.ts";

interface Row {
  date: string;
  window_label: BookingWindow;
  starts_at: string | null;
  answered_at: string | null;
  expires_at: string;
  expected_start: string;
  type: VisitType | null;
  window_start: string;
  status: string;
  name: string;
  technician: string | null;
}

/** "Hi Rohit, we need to move your service visit on Mon 12 Oct. Could you do Tue 13 Oct, 12–12:30 pm, with Imran …" */
export async function composeMoveProposed(
  db: D1Database,
  proposalId: string,
  personId: string,
  now: Date,
): Promise<Composed> {
  const row = await db
    .prepare(
      `SELECT p.date, p.window_label, p.starts_at, p.answered_at, p.expires_at, p.expected_start, a.type, a.window_start, a.status,
         pe.name, t.name AS technician
       FROM move_proposals p JOIN appointments a ON a.id = p.appointment_id JOIN people pe ON pe.id = a.person_id
         LEFT JOIN technicians t ON t.id = p.technician_id
       WHERE p.id = ?1 AND a.person_id = ?2`,
    )
    .bind(proposalId, personId)
    .first<Row>();
  if (row === null) return { skip: "no such proposal" };
  if (row.answered_at !== null) return { skip: "the proposal is answered or withdrawn" };
  if (Date.parse(row.expires_at) <= now.getTime()) return { skip: "the proposal has run out" };
  if (row.window_start !== row.expected_start) return { skip: "the visit has moved since" };
  if (row.type === null || (row.status !== "scheduled" && row.status !== "dispatched")) {
    return { skip: "the visit is no longer booked" };
  }
  const hours =
    row.starts_at === null
      ? hoursOfWindow(row.date, row.window_label, await loadSlotSchedule(db))
      : arrivalHours(new Date(row.starts_at), (await readOpsInputs(db, now)).bookingRules.arrival);
  return underVisitsConsent(db, personId, {
    template: "move_proposed_v1",
    params: [
      firstNameOf(row.name),
      VISIT_TYPE_NAMES[row.type].toLowerCase(),
      shortDate(indiaDate(new Date(row.window_start))),
      shortDate(row.date),
      hours,
      row.technician === null ? "our technician" : firstNameOf(row.technician),
    ],
  });
}
