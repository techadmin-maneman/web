// A booked lead, sent to FSM for ops to schedule (docs/decisions/0032-fsm-mirror.md,
// "Leads into FSM"). The person becomes an FSM contact, once, and the
// consultation they asked for becomes a Request with the day and window they
// picked. Ops convert it to a work order and assign it in FSM; the mirror
// then brings the appointment back, matched to the person by mobile number.

import { windowLabel, type VisitWindow } from "../config/booking.ts";
import { FSM_SERVICE_NAMES } from "../config/visit-types.ts";
import type { FsmProvider } from "../providers/fsm.ts";
import { fsmContactOf } from "./fsm-contacts.ts";

/** The two windows a Phase 1 booking offers, in Phase 2's words (docs/decisions/0040-phase-1-alignment.md). */
const WINDOWS = { "before noon": "Morning, 9 am to 12 pm", "after four": "Evening, 4 to 8 pm" } as const;

interface LeadRow {
  source: string;
  city: string | null;
  first_choice_window: VisitWindow | null;
  proposed_visit_date: string | null;
  fsm_request_id: string | null;
  person_id: string;
  name: string;
  erased_at: string | null;
}

export type LeadToFsmOutcome = "sent" | "already_sent" | "not_a_booking";

/**
 * Sends one lead to FSM. Only a booking in a served city goes; a waitlist entry or a try-on does not.
 * Staging's Requests say they are tests, since staging shares the real org (ADR 0025, item 26).
 */
export async function sendLeadToFsm(
  db: D1Database,
  fsm: FsmProvider,
  leadId: string,
  { labelAsTest }: { labelAsTest: boolean },
): Promise<LeadToFsmOutcome> {
  const lead = await db
    .prepare(
      `SELECT l.source, l.city, l.first_choice_window, l.proposed_visit_date, l.fsm_request_id,
              p.id AS person_id, p.name, p.erased_at
       FROM leads l JOIN people p ON p.id = l.person_id WHERE l.id = ?1`,
    )
    .bind(leadId)
    .first<LeadRow>();
  if (lead === null) return "not_a_booking";
  if (lead.erased_at !== null || lead.source !== "form" || lead.city === null) return "not_a_booking";
  if (lead.fsm_request_id !== null) return "already_sent";

  const contactId = await fsmContactOf(db, fsm, lead.person_id, lead.city);
  const consultation = (await fsm.items()).find((item) => item.name === FSM_SERVICE_NAMES.consultation);
  if (consultation === undefined) throw new Error("FSM has no Consultation service item: run scripts/setup-fsm.ts");

  const requestId = await fsm.createRequest({
    contactId,
    summary: `${labelAsTest ? "Staging test: " : ""}Consultation for ${lead.name}`,
    serviceId: consultation.id,
    preferredDate: lead.proposed_visit_date,
    preferenceNote: lead.first_choice_window === null ? "" : WINDOWS[windowLabel(lead.first_choice_window)],
  });
  await db.prepare("UPDATE leads SET fsm_request_id = ?1 WHERE id = ?2").bind(requestId, leadId).run();
  return "sent";
}
