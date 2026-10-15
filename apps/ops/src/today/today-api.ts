// Today's own call to mm-api: the day's routes, counted for the visits on them. The tasks are the board the
// navigation reads (../lib/waiting.ts).

import { client } from "../api.ts";

export const todayApi = {
  day: (date: string) => client.get("/api/dispatch/day", { query: { date } }),
};
