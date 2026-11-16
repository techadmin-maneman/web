// What the head's bell and Visits' tab count: the alerts not yet read (docs/decisions/0255-client-alerts-and-push.md)
// and the issues still open (the issue log), as Home's own answer carries them; and the hair system worn. A Home the
// phone kept from before the API answered them, or one a rolled-back API sends, carries none of them, though the
// document says they are there, so each reads as none.

import type { Me } from "../api.ts";

/** Alerts the client has not read. */
export const unreadAlerts = (me: Partial<Pick<Me, "alerts_unread">>): number => me.alerts_unread ?? 0;

/** Issues the client raised that are not yet resolved. */
export const openIssues = (me: Partial<Pick<Me, "issues_open">>): number => me.issues_open ?? 0;

/** Care's hours and reply promise; null in a Home kept from before the API sent them. */
export const careHoursOf = (me: Partial<Pick<Me, "care_hours">>): Me["care_hours"] | null => me.care_hours ?? null;

/** The law's days to answer a concern or act on a deletion, and years invoices are kept; null where not sent. */
export const lawOf = (me: Partial<Pick<Me, "answers_within">>): Me["answers_within"] | null =>
  me.answers_within ?? null;

/** The hair system the client wears; null for none. */
export const wornOf = (me: Partial<Pick<Me, "hair_system">>): Me["hair_system"] => me.hair_system ?? null;
