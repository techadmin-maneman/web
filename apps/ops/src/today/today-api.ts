// Today's own calls to mm-api, each read only by a home that shows it: the board from today, in the header's city;
// Care's last week and the chats waiting on us; the day's money and its payments; stock, counts and recalls. The tasks
// are the board the navigation reads (../lib/waiting.ts).

import { client, setOnly } from "../api.ts";

export const todayApi = {
  board: (from: string, city: string | null) => client.get("/api/dispatch", { query: setOnly({ from, city }) }),
  care: () => client.get("/api/care-numbers", { query: { days: "7" } }),
  waiting: () => client.get("/api/conversations", { query: { view: "open" } }),
  money: (date: string) => client.get("/api/payments", { query: { date } }),
  payments: (date: string) => client.get("/api/payments/ledger", { query: { from: date, to: date } }),
  stock: () => client.get("/api/stock"),
  counts: () => client.get("/api/count-tasks"),
  recalls: () => client.get("/api/recalls"),
};
