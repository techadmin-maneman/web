// What the lead sync may write to the Zoho CRM org beyond the fields it has
// always written (src/providers/crm/zoho.ts; docs/decisions/0074-hand-offs-and-messages.md).
//
// Zoho refuses a record carrying a pick-list value the org does not have, so a
// lead written with the referral fields before they exist would not reach the
// CRM at all. scripts/ops/setup-crm.ts created them on 2 October 2026, and this
// was turned on. Staging and production write to the one org
// (docs/decisions/0020-production-on-the-zoho-test-org.md), so one switch serves
// both.

import type { BookingWindow } from "./scheduling.ts";

/**
 * Whether the org has the referral fields: the value "Referral" in Lead_Source,
 * and the Referral_Code and Booked_Window fields. Widened from its literal, so
 * the code for either answer stays checked while the switch stands at one.
 */
export const CRM_ORG_HAS_REFERRAL_FIELDS = true as boolean;

/** Lead_Source's value for a lead who came through a friend's invite. */
export const REFERRAL_LEAD_SOURCE = "Referral";

/**
 * Booked_Window's values: the three windows a Phase 2 booking asks for, by name. Not their hours, which ops set in the
 * console from a date (docs/decisions/0102-window-times.md): a pick-list's values are fixed in the org by
 * scripts/ops/setup-crm.ts, and Zoho refuses a value it does not hold.
 */
export const BOOKED_WINDOW_NAMES: Readonly<Record<BookingWindow, string>> = {
  morning: "Morning",
  afternoon: "Afternoon",
  evening: "Evening",
};
