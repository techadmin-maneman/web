// What the head's bell and Visits' tab count: the alerts not yet read (docs/decisions/0255-client-alerts-and-push.md)
// and the issues still open (the issue log). Read from Home's own answer once the API carries them.

import type { Me } from "../api.ts";

/** Alerts the client has not read. */
export const unreadAlerts = (me: Me): number => ("alerts_unread" in me ? Number(me.alerts_unread) : 0);

/** Issues the client raised that are not yet resolved. */
export const openIssues = (me: Me): number => ("issues_open" in me ? Number(me.issues_open) : 0);
