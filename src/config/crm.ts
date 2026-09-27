// What the lead sync may write to the Zoho CRM org beyond the fields it has
// always written (src/providers/zoho-crm.ts; docs/decisions/0074-hand-offs-and-messages.md).
//
// Zoho refuses a record carrying a pick-list value the org does not have, so a
// lead written with the referral fields before they exist would not reach the
// CRM at all. scripts/setup-crm.ts creates them; the owner or the coordinator
// runs it, then turns this on. Staging and production write to the one org
// (docs/decisions/0020-production-on-the-zoho-test-org.md), so one switch serves
// both.

import type { BookingWindow } from "./scheduling.ts";

/**
 * Whether the org has the referral fields: the value "Referral" in Lead_Source,
 * and the Referral_Code and Booked_Window fields. Widened from its literal, so
 * the code for either answer stays checked while the switch stands at one.
 */
export const CRM_ORG_HAS_REFERRAL_FIELDS = false as boolean;

/** Lead_Source's value for a lead who came through a friend's invite. */
export const REFERRAL_LEAD_SOURCE = "Referral";

/** Booked_Window's values: the three windows a Phase 2 booking asks for, with their hours. */
export const BOOKED_WINDOW_NAMES: Readonly<Record<BookingWindow, string>> = {
  morning: "Morning, 9 am to 12 pm",
  afternoon: "Afternoon, 12 to 4 pm",
  evening: "Evening, 4 to 8 pm",
};
