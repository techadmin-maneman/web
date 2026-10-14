// Partner commission's calls to mm-api: what each partner is owed by month, and a payout recorded or deleted. Each is
// the console's client's (../api.ts), one function a route, so a call is found, and changed, in one place.

import { client, type PartnerPayout, setOnly } from "../api.ts";

export const partnerCommissionApi = {
  partnerStatements: (month: string | null) => client.get("/api/partner-statements", { query: setOnly({ month }) }),
  recordPartnerPayout: (id: string, payout: PartnerPayout) =>
    client.post("/api/partner-statements/{id}/payouts", { path: { id }, body: payout }),
  deletePartnerPayout: (id: string, month: string) =>
    client.post("/api/partner-statements/{id}/payouts/{month}/delete", { path: { id, month } }),
};
