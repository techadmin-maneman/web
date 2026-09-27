// Board C1: the referral grants held for review, and the referrers' figures.

import type { OpsReply } from "../answer.ts";

/**
 * Read against 10:30 in India on 22 September 2027 (TASKS_READ_ON), each has
 * been held as long as board C1 writes: "3 days held", "1 day held", "5 hours
 * held"; each falls due two days after it was held (src/policy/tasks.ts).
 */
export const HELD = {
  held: [
    {
      id: "aa000000-0000-4000-8000-000000000001",
      referrer: { person_id: "11000000-0000-4000-8000-000000000001", name: "Rohit Malhotra" },
      referred: { person_id: "11000000-0000-4000-8000-000000000002", name: "Vikram Sethi" },
      fitted_on: "2027-09-19",
      signals: ["shared_address"],
      held_since: "2027-09-19T05:00:00.000Z",
      due: "2027-09-21T05:00:00.000Z",
    },
    {
      id: "aa000000-0000-4000-8000-000000000002",
      referrer: { person_id: "11000000-0000-4000-8000-000000000003", name: "Ashish Gill" },
      referred: { person_id: "11000000-0000-4000-8000-000000000004", name: "Manoj Gill" },
      fitted_on: "2027-09-21",
      signals: ["shared_upi"],
      held_since: "2027-09-21T05:00:00.000Z",
      due: "2027-09-23T05:00:00.000Z",
    },
    {
      id: "aa000000-0000-4000-8000-000000000003",
      referrer: { person_id: "11000000-0000-4000-8000-000000000005", name: "Karan Bose" },
      referred: { person_id: "11000000-0000-4000-8000-000000000006", name: "Nikhil Arora" },
      fitted_on: "2027-09-22",
      signals: ["monthly_cap"],
      held_since: "2027-09-22T00:00:00.000Z",
      due: "2027-09-24T00:00:00.000Z",
    },
  ],
} satisfies OpsReply<"/api/referrals/held">;

export const REFERRERS = {
  referrers: [
    { code: "KB1102", name: "Karan Bose", opens: 19, consultations: 9, fits: 6, granted: 15, redeemed: 2 },
    { code: "RM4417", name: "Rohit Malhotra", opens: 7, consultations: 3, fits: 2, granted: 6, redeemed: 4 },
    { code: "AG2208", name: "Ashish Gill", opens: 4, consultations: 2, fits: 1, granted: 3, redeemed: 3 },
    { code: "VS0916", name: "Vikram Sethi", opens: 1, consultations: 0, fits: 0, granted: 0, redeemed: 0 },
  ],
  more: false,
} satisfies OpsReply<"/api/referrers">;
