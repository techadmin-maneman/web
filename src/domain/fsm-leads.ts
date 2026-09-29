// A booked lead, sent to FSM for ops to schedule (docs/decisions/0032-fsm-mirror.md,
// "Leads into FSM"). The person becomes an FSM contact, once, and the
// consultation they asked for becomes a Request with the day and window they
// picked. Ops convert it to a work order and assign it in FSM; the mirror
// then brings the appointment back, matched to the person by mobile number.
//
// Only Phase 1's POST /api/lead wrote such a lead, and it was removed on
// 28 September 2026. This stays for a lead it left waiting, and goes with the
// rest of Phase 1's path into FSM (docs/open-points.md, item 159).
//
// The Request carries the lead's ID, so a retry after a Request whose answer
// never reached us finds that one rather than making a second
// (docs/decisions/0068-a-paid-hold-is-kept.md).
//
// Its line is the item of the consultation the site books: the kind's
// standard service while it is offered, else the first the kind offers
// (docs/decisions/0085-services-ops-can-edit.md).

import { windowLabel, type VisitWindow } from "../config/booking.ts";
import { STANDARD_TIER } from "../config/visit-types.ts";
import { indiaDate } from "../lib/india-time.ts";
import { createLogger, type Logger } from "../log.ts";
import type { FsmProvider } from "../providers/fsm.ts";
import { itemForService } from "./fsm-catalogue.ts";
import { fsmContactOf } from "./fsm-contacts.ts";
import { bookableService } from "./services.ts";

/** The two windows a Phase 1 booking offers, in Phase 2's words (docs/decisions/0040-phase-1-alignment.md). */
const WINDOWS = { "before noon": "Morning, 9 am to 12 pm", "after four": "Evening, 4 to 8 pm" } as const;

interface LeadRow {
  source: string;
  city: string | null;
  first_choice_window: VisitWindow | null;
  proposed_visit_date: string | null;
  fsm_request_id: string | null;
  fsm_request_tried_at: string | null;
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
  { labelAsTest, log = createLogger(), now = new Date() }: { labelAsTest: boolean; log?: Logger; now?: Date },
): Promise<LeadToFsmOutcome> {
  const lead = await db
    .prepare(
      `SELECT l.source, l.city, l.first_choice_window, l.proposed_visit_date, l.fsm_request_id, l.fsm_request_tried_at,
              p.id AS person_id, p.name, p.erased_at
       FROM leads l JOIN people p ON p.id = l.person_id WHERE l.id = ?1`,
    )
    .bind(leadId)
    .first<LeadRow>();
  if (lead === null) return "not_a_booking";
  if (lead.erased_at !== null || lead.source !== "form" || lead.city === null) return "not_a_booking";
  if (lead.fsm_request_id !== null) return "already_sent";

  const contactId = await fsmContactOf(db, fsm, lead.person_id, { city: lead.city, pincode: null }, log);
  const requestId =
    (lead.fsm_request_tried_at === null ? null : await requestMadeBefore(fsm, leadId, log)) ??
    (await askForConsultation(db, fsm, { leadId, lead, contactId, labelAsTest, now, log }));
  await db.prepare("UPDATE leads SET fsm_request_id = ?1 WHERE id = ?2").bind(requestId, leadId).run();
  return "sent";
}

/** The Request an earlier try made, if FSM took it and its answer never came; null if not, or if FSM could not say. */
async function requestMadeBefore(fsm: FsmProvider, leadId: string, log: Logger): Promise<string | null> {
  try {
    return await fsm.findRequest(leadId);
  } catch (error) {
    log.warn("fsm_request_lookup_failed", { lead_id: leadId, error });
    return null;
  }
}

async function askForConsultation(
  db: D1Database,
  fsm: FsmProvider,
  input: { leadId: string; lead: LeadRow; contactId: string; labelAsTest: boolean; now: Date; log: Logger },
): Promise<string> {
  const { leadId, lead, contactId, labelAsTest, now, log } = input;
  const offered = await bookableService(db, "consultation", undefined, lead.proposed_visit_date ?? indiaDate(now));
  const tier = offered?.tier ?? STANDARD_TIER;
  const consultation = await itemForService(db, fsm, { kind: "consultation", tier }, { log });
  await db.prepare("UPDATE leads SET fsm_request_tried_at = ?2 WHERE id = ?1").bind(leadId, now.toISOString()).run();
  return fsm.createRequest({
    contactId,
    summary: `${labelAsTest ? "Staging test: " : ""}Consultation for ${lead.name}`,
    serviceId: consultation.id,
    preferredDate: lead.proposed_visit_date,
    preferenceNote: lead.first_choice_window === null ? "" : WINDOWS[windowLabel(lead.first_choice_window)],
    reference: leadId,
  });
}
