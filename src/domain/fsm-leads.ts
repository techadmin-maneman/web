// A booked lead, sent to FSM for ops to schedule (docs/decisions/0032-fsm-mirror.md,
// "Leads into FSM"). The person becomes an FSM contact, once, and the
// consultation they asked for becomes a Request with the day and window they
// picked. Ops convert it to a work order and assign it in FSM; the mirror
// then brings the appointment back, matched to the person by mobile number.

import { windowLabel, type VisitWindow } from "../config/booking.ts";
import { FSM_SERVICE_NAMES } from "../config/visit-types.ts";
import type { FsmProvider } from "../providers/fsm.ts";

/** The state each served city is in, with its GST code, for the contact's place of supply. */
const STATES: Readonly<Record<string, { state: string; code: string }>> = {
  Gurgaon: { state: "Haryana", code: "HR" },
  Faridabad: { state: "Haryana", code: "HR" },
  Delhi: { state: "Delhi", code: "DL" },
  Noida: { state: "Uttar Pradesh", code: "UP" },
  Ghaziabad: { state: "Uttar Pradesh", code: "UP" },
};

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
  mobile_e164: string;
  email: string | null;
  fsm_contact_id: string | null;
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
              p.id AS person_id, p.name, p.mobile_e164, p.email, p.fsm_contact_id, p.erased_at
       FROM leads l JOIN people p ON p.id = l.person_id WHERE l.id = ?1`,
    )
    .bind(leadId)
    .first<LeadRow>();
  if (lead === null) return "not_a_booking";
  if (lead.erased_at !== null || lead.source !== "form" || lead.city === null) return "not_a_booking";
  if (lead.fsm_request_id !== null) return "already_sent";

  const contactId = lead.fsm_contact_id ?? (await addContact(db, fsm, lead, lead.city));
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

async function addContact(db: D1Database, fsm: FsmProvider, lead: LeadRow, city: string): Promise<string> {
  const [first, ...rest] = lead.name.trim().split(/\s+/);
  const place = STATES[city];
  const contactId = await fsm.createContact({
    firstName: rest.length === 0 ? null : (first ?? null),
    lastName: rest.length === 0 ? lead.name.trim() : rest.join(" "),
    mobile: lead.mobile_e164,
    email: lead.email,
    city,
    state: place?.state ?? null,
    stateCode: place?.code ?? null,
  });
  // Kept at once, so a retry after a failed Request does not add the contact twice.
  await db
    .prepare("UPDATE people SET fsm_contact_id = ?1 WHERE id = ?2 AND fsm_contact_id IS NULL")
    .bind(contactId, lead.person_id)
    .run();
  return contactId;
}
