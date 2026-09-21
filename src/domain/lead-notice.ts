// The Google Chat line posted for each new lead, once it has reached the CRM.
// City, window and date only: never a name or a number.

import { WINDOW_NAMES, type VisitWindow } from "../config/booking.ts";
import type { LeadSource } from "../providers/crm.ts";

export interface NoticeLead {
  readonly lead_id: string;
  readonly source: LeadSource;
  readonly city: string | null;
  readonly first_choice_window: VisitWindow | null;
  readonly proposed_visit_date: string | null;
  /** 1 once the person has agreed to be contacted. */
  readonly contactable: number;
}

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function leadNotice(lead: NoticeLead): string {
  const reference = `Lead ${lead.lead_id.slice(0, 8)}.`;
  if (lead.source === "form") {
    const window = lead.first_choice_window === null ? "" : `, ${WINDOW_NAMES[lead.first_choice_window].toLowerCase()}`;
    const date = lead.proposed_visit_date === null ? "" : `, proposed ${dayOf(lead.proposed_visit_date)}`;
    return `New booking: ${lead.city ?? "no city"}${window}${date}. ${reference}`;
  }
  if (lead.source === "waitlist") return `New waitlist sign-up: ${lead.city ?? "no city"}. ${reference}`;
  return lead.contactable === 1
    ? `New try-on lead, from someone who has booked before. ${reference}`
    : `New try-on lead: WhatsApp copy only, not to be chased. ${reference}`;
}

/** "2026-09-23" -> "Wed 23 Sep" */
function dayOf(date: string): string {
  const day = new Date(`${date}T00:00:00Z`);
  return `${DAYS[day.getUTCDay()] ?? ""} ${String(day.getUTCDate())} ${MONTHS[day.getUTCMonth()] ?? ""}`;
}
