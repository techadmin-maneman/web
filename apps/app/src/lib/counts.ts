// What the head's bell and Visits' tab count: the alerts not yet read (docs/decisions/0255-client-alerts-and-push.md)
// and the issues still open (the issue log), as Home's own answer carries them. A Home the phone kept from before the
// API counted them carries neither, though the document says it is there, so each reads as none.

import type { Me } from "../api.ts";

/** Alerts the client has not read. */
export const unreadAlerts = (me: Partial<Pick<Me, "alerts_unread">>): number => me.alerts_unread ?? 0;

/** Issues the client raised that are not yet resolved. */
export const openIssues = (me: Partial<Pick<Me, "issues_open">>): number => me.issues_open ?? 0;
