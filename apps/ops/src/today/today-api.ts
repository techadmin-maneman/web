// Today's own calls to mm-api, each read only by a home that shows it, in the header's city where it names one: the
// board from today; Care's last week and the chats waiting on us; the day's money and its payments; stock, counts and
// recalls. The tasks are the board the navigation reads (../lib/waiting.ts).

import { client, setOnly } from "../api.ts";

export const todayApi = {
  board: (from: string, city: string | null) => client.get("/api/dispatch", { query: setOnly({ from, city }) }),
  care: (city: string | null) => client.get("/api/care-numbers", { query: { days: "7", ...setOnly({ city }) } }),
  waiting: (city: string | null) => client.get("/api/conversations", { query: { view: "open", ...setOnly({ city }) } }),
  money: (date: string, city: string | null) => client.get("/api/payments", { query: setOnly({ date, city }) }),
  payments: (date: string, city: string | null) =>
    client.get("/api/payments/ledger", { query: setOnly({ from: date, to: date, city }) }),
  stock: () => client.get("/api/stock"),
  counts: () => client.get("/api/count-tasks"),
  recalls: () => client.get("/api/recalls"),
};
