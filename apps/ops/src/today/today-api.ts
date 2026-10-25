// Today's own calls to mm-api: the day's routes, counted for the visits on them; the board from today, for how the day
// on the road stands; the last week of Care's replies; and the last 30 days of the funnel. The tasks are the board the
// navigation reads (../lib/waiting.ts).

import { client } from "../api.ts";

export const todayApi = {
  day: (date: string) => client.get("/api/dispatch/day", { query: { date } }),
  board: (from: string) => client.get("/api/dispatch", { query: { from } }),
  care: () => client.get("/api/care-numbers", { query: { days: "7" } }),
  funnel: () => client.get("/api/growth/funnel", { query: { days: "30" } }),
};
