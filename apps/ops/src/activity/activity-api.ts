// Activity's call to mm-api: the audit log, narrowed and a page at a time. Each is the console's client's (../api.ts),
// one function a route, so a call is found, and changed, in one place.

import { client, type ActivityAsked } from "../api.ts";

export const activityApi = {
  /** A page of the audit log, newest first, as `asked` narrows it. */
  activity: (asked: ActivityAsked) => client.get("/api/activity", { query: asked }),
};
