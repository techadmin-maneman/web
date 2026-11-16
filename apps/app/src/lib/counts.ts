// What the head's bell and Visits' tab count: the alerts not yet read (docs/decisions/0255-client-alerts-and-push.md)
// and the issues still open (the issue log), as Home's own answer carries them.

import type { Me } from "../api.ts";

/** Alerts the client has not read. */
export const unreadAlerts = (me: Me): number => me.alerts_unread;

/** Issues the client raised that are not yet resolved. */
export const openIssues = (me: Me): number => me.issues_open;
