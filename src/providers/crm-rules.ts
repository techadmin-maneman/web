// What any CRM record may say, decided from D1's consent state. Every CRM
// implementation calls these, so the rules hold whatever the vendor: a person
// with only a result-delivery consent (a try-on) is never given a status that
// ops chase. See docs/decisions/0012-zoho-sync.md.

import type { CrmLead, LeadStatus } from "./crm.ts";

export const DELIVERY_ONLY: LeadStatus = "Try-on — delivery only";

/** The status for a person's first CRM record. */
export function statusForNewRecord(lead: CrmLead): LeadStatus {
  if (!lead.contactable) return DELIVERY_ONLY;
  return lead.source === "waitlist" ? "Waitlist" : "New";
}

/**
 * The status to set on a record that already exists, or null to leave it alone.
 * Only a new booking resets the status; a waitlist sign-up or a try-on must not
 * undo progress ops have made.
 */
export function statusForUpdate(lead: CrmLead): LeadStatus | null {
  if (!lead.contactable) return null;
  return lead.source === "form" ? "New" : null;
}

/** New bookings are assigned to a technician; waitlist and try-on leads are not. */
export function shouldAssign(lead: CrmLead): boolean {
  return lead.contactable && lead.source === "form";
}

/** Workflows chase leads, so they run only for people who agreed to be contacted. */
export function shouldRunWorkflows(lead: CrmLead): boolean {
  return lead.contactable;
}

/** The last line of defence: every CRM implementation calls this before writing a status. */
export function assertStatusAllowed(lead: CrmLead, status: LeadStatus | null): void {
  if (!lead.contactable && status !== null && status !== DELIVERY_ONLY) {
    throw new Error(`refusing to give lead ${lead.leadId} the chase status "${status}": the person is not contactable`);
  }
}
