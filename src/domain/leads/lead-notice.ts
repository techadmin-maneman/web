// The Google Chat line posted for each new lead, once it has reached the CRM, or for a try-on, which never does.
// City, window and date only: never a name or a number.

import { shortDate } from "@maneman/web-kit/dates";
import { WINDOW_NAMES, type VisitWindow } from "../../config/booking.ts";
import type { LeadSource } from "../../providers/crm/index.ts";

interface NoticeLead {
  readonly lead_id: string;
  readonly source: LeadSource;
  readonly city: string | null;
  readonly first_choice_window: VisitWindow | null;
  readonly proposed_visit_date: string | null;
}

export function leadNotice(lead: NoticeLead): string {
  const reference = `Lead ${lead.lead_id.slice(0, 8)}.`;
  // A booking's lead has its day; the name and number /book asks for first have neither day nor window yet.
  if (lead.source === "form" && lead.proposed_visit_date === null && lead.first_choice_window === null) {
    return `New name and number, at the first step of booking. ${reference}`;
  }
  if (lead.source === "form") {
    const window = lead.first_choice_window === null ? "" : `, ${WINDOW_NAMES[lead.first_choice_window].toLowerCase()}`;
    const date = lead.proposed_visit_date === null ? "" : `, proposed ${shortDate(lead.proposed_visit_date)}`;
    return `New booking: ${lead.city ?? "no city"}${window}${date}. ${reference}`;
  }
  if (lead.source === "waitlist") return `New waitlist sign-up: ${lead.city ?? "no city"}. ${reference}`;
  if (lead.source === "whatsapp")
    return `New WhatsApp lead, saved by Care from a chat: answered there, not to be chased. ${reference}`;
  // The gate promises no marketing, to a client as much as to anyone.
  return `New try-on lead: WhatsApp copy only, not to be chased. ${reference}`;
}
