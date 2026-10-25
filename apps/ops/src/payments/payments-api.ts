// Payments' calls to mm-api: the no-show cases, the day's money, a ruling and what a charge would keep, the cases ruled
// on today, and the disputed charges. Each is the console's client's (../api.ts), one function a route, so a call is
// found, and changed, in one place.

import { client, type DisputeRuling, setOnly } from "../api.ts";

export const paymentsApi = {
  /** The cases nobody has ruled on yet. The route also answers the decided ones; the board draws a queue. */
  noShows: () => client.get("/api/no-shows", { query: { decision: "undecided" } }),
  /** A day's money, as the Payments page heads it: India's date, or today with null. */
  dayMoney: (date: string | null) => client.get("/api/payments", { query: setOnly({ date }) }),
  /** Charge the visit or waive it, with the reason either way: a charge keeps what the booking sold a no-show at. */
  decideNoShow: (id: string, decision: "charged" | "waived", reason: string) =>
    client.post("/api/no-shows/{id}/decision", { path: { id }, body: { decision, reason } }),
  /** What charging the case would keep of the visit's payment and refund, read before the charge is sent. */
  chargePreview: (id: string) => client.get("/api/no-shows/{id}/charge", { path: { id } }),
  /** The photograph of the door the case was closed with; viewing it is logged as a client photograph's is. */
  doorPhoto: (id: string) =>
    client.request<Blob>("GET", `/api/no-shows/${encodeURIComponent(id)}/door-photo`, { file: true }),
  /** The cases ruled on today, the latest first, each with its ruling. */
  decidedNoShows: () => client.get("/api/no-shows/decided"),
  /** The disputed charges still to rule on (docs/decisions/0096-a-no-shows-charge-and-its-dispute.md). */
  disputes: () => client.get("/api/no-shows/disputes"),
  ruleOnDispute: (id: string, ruling: DisputeRuling, reason: string) =>
    client.post("/api/no-shows/disputes/{id}/ruling", { path: { id }, body: { ruling, reason } }),
};
