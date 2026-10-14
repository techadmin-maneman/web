// Referrals' calls to mm-api: the held grants and each decided, the referrers, and the partners. Each is the console's
// client's (../api.ts), one function a route, so a call is found, and changed, in one place.

import { client, type PartnerTerms } from "../api.ts";

export const referralsApi = {
  held: () => client.get("/api/referrals/held"),
  /** Either decision needs a reason, which the server keeps with it (src/policy/decision-reasons.ts). */
  decideReferral: (id: string, decision: "approve" | "reject", reason: string) =>
    client.post("/api/referrals/{id}/decision", { path: { id }, body: { decision, reason } }),
  /** A page of referrers, the busiest first: the first, or the one `cursor` names. */
  referrers: (cursor?: string) => client.get("/api/referrers", { query: { cursor } }),
  partners: () => client.get("/api/referral-channels"),
  addPartner: (terms: PartnerTerms) => client.post("/api/referral-channels", { body: terms }),
  changePartner: (id: string, terms: PartnerTerms) =>
    client.patch("/api/referral-channels/{id}", { path: { id }, body: terms }),
  pausePartner: (id: string, paused: boolean) =>
    client.post("/api/referral-channels/{id}/pause", { path: { id }, body: { paused } }),
};
