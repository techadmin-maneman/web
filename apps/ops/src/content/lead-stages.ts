// A client's lead, on their page (docs/decisions/0320-lead-stages.md): each stage and when it was first reached, and
// whether the lead was lost, why and in what words. No design draws it; every word here is ours; the reasons are the
// job sheet's, as ops keep them.

import { changed, FAILED, NOT_PERMITTED, OFFLINE, UNCONFIRMED } from "./common.ts";

export const leadStages = {
  title: "Lead",
  rows: {
    became: "Became a lead",
    firstReply: "First reply",
    /** A lead is qualified when their first consultation is booked. */
    qualified: "Qualified, consultation booked",
    attended: "Consultation done",
    fitted: "Fitted",
    lost: "Lost",
    lostOn: "Lost on",
    objection: "Their objection",
  },
  notYet: "Not yet",
  notLost: "Not lost",
  errors: {
    invalid_request: "Check the fields marked.",
    not_found: changed("Not found."),
    not_permitted: NOT_PERMITTED,
    offline: OFFLINE,
    unconfirmed: UNCONFIRMED,
    unknown: FAILED,
  },
};
