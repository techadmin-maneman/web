// The files the Partner commission page hands out (apps/ops/src/settings/partner-commission-csv.ts): a partner's
// statement, which holds days and amounts and never a client, and the month for the payout tool. A partner's name is
// typed by staff, so a spreadsheet must show it as text, never run it.

import { describe, expect, it } from "vitest";
import { monthCsv, statementCsv } from "../../../../apps/ops/src/settings/partner-commission-csv.ts";

type PartnerStatement = Parameters<typeof statementCsv>[0];

const SALON: PartnerStatement = {
  channel_id: "7b0c8e3a-4d5f-4a6b-8c7d-2e3f4a5b6c7d",
  name: "Looks Salon, Sector 29",
  code: "LSK7P2QX",
  fitted: 2,
  earned: 250000,
  taken_back: 1,
  taken_back_amount: 150000,
  due: 100000,
  payout: { amount: 100000, paid_on: "2026-10-05", reference: "UTR0905", recorded_by: "finance@maneman.test" },
  owed: 0,
  lines: [
    { day: "2026-09-01", kind: "fitted", commission: 150000 },
    { day: "2026-09-15", kind: "fitted", commission: 100000 },
    { day: "2026-09-20", kind: "taken_back", commission: 150000 },
  ],
};

describe("a partner's statement", () => {
  it("lists each fit and each taking back by day, then what the month came to and what was paid", () => {
    expect(statementCsv(SALON, "September 2026").split("\n")).toEqual([
      'Partner,"Looks Salon, Sector 29"',
      "Month,September 2026",
      "",
      "Day,Line,Commission (Rs.)",
      "2026-09-01,Friend fitted,1500.00",
      "2026-09-15,Friend fitted,1000.00",
      "2026-09-20,Taken back: first fit refunded,-1500.00",
      "",
      ",Due for the month,1000.00",
      ',"Paid 2026-10-05, reference UTR0905",1000.00',
    ]);
  });
});

describe("the month's file", () => {
  it("gives a row each partner, and a name a spreadsheet would run as a formula as text", () => {
    const formula = { ...SALON, name: "=HYPERLINK(1)", payout: null, owed: 100000 };
    expect(monthCsv([SALON, formula]).split("\n")).toEqual([
      "Partner,Code,Fits,Earned (Rs.),Taken back (Rs.),Due (Rs.),Paid (Rs.),Paid on,Reference,Owed (Rs.)",
      '"Looks Salon, Sector 29",LSK7P2QX,2,2500.00,1500.00,1000.00,1000.00,2026-10-05,UTR0905,0.00',
      "'=HYPERLINK(1),LSK7P2QX,2,2500.00,1500.00,1000.00,,,,1000.00",
    ]);
  });
});
