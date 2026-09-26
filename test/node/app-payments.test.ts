// What the client's Payments say of a visit they were not home for (LIFE-07), and of their service-visit credits,
// which never appeared there (LIFE-14). Every name and figure is made up.

import { describe, expect, it } from "vitest";
import type { CreditLine, Entry } from "../../apps/app/src/api.ts";
import {
  creditAmount,
  creditMeta,
  creditStatus,
  documentsOf,
  entryMeta,
  entryStatus,
  paymentsAndCredits,
} from "../../apps/app/src/payments/entry.ts";

const payment = (overrides: Record<string, unknown>) =>
  ({
    kind: "payment",
    id: "p",
    date: "2030-09-10",
    status: "captured",
    method: "upi",
    visit: { id: "v", date: "2030-09-19", type: "service" },
    purpose: "visit",
    charge: null,
    no_show: null,
    ...overrides,
  }) as unknown as Extract<Entry, { kind: "payment" }>;

const credit = (overrides: Partial<CreditLine>): CreditLine => ({
  id: "c",
  date: "2030-09-19",
  event: "used",
  visits: -1,
  visit: { id: "v", date: "2030-09-19", type: "service" },
  source: null,
  no_show: null,
  ...overrides,
});

describe("a visit's payment the client was not home for", () => {
  const notHome = (decision: "undecided" | "charged" | "waived") =>
    payment({ no_show: { decision, waited_minutes: 16 } });

  it("says nobody was home and how long we waited, in place of the method", () => {
    expect(entryMeta(notHome("charged"), 2030)).toBe("10 Sep · not home, we waited 16 min");
  });

  it("is a charge once ops charge it, and stays paid otherwise", () => {
    expect(entryStatus(notHome("charged"))).toBe("Charged");
    expect(entryStatus(notHome("undecided"))).toBe("Paid · under review");
    expect(entryStatus(notHome("waived"))).toBe("Paid · not charged");
  });

  it("has the receipt alone: no invoice comes for a visit that did not happen", () => {
    expect(documentsOf(notHome("charged"))).toEqual(["receipt"]);
  });
});

describe("the credits among the payments", () => {
  it("say a visit a credit covered as the board does, with Rs. 0 and the credit used", () => {
    const line = credit({});
    expect(creditMeta(line, 2030)).toBe("19 Sep · visit credit");
    expect(creditStatus(line)).toBe("Covered by credit");
    expect(creditAmount(line)).toEqual({ amount: "Rs. 0", count: "1 credit used" });
  });

  it("say a credit is lost on a late cancel or a charged no-show, and back after a cancel in time", () => {
    expect(creditStatus(credit({ event: "lost" }))).toBe("Credit lost");
    expect(creditMeta(credit({ event: "lost", no_show: { decision: "charged", waited_minutes: 16 } }), 2030)).toBe(
      "19 Sep · not home, we waited 16 min",
    );
    expect(creditStatus(credit({ event: "returned", visits: 1 }))).toBe("Credit returned");
    expect(creditAmount(credit({ event: "returned", visits: 1 }))).toEqual({ amount: "Rs. 0", count: "1 credit back" });
  });

  it("say where credits added came from, and how many", () => {
    const added = credit({ event: "added", visits: 3, visit: null, source: "referral" });
    expect(creditMeta(added, 2030)).toBe("19 Sep · a friend you invited was fitted");
    expect(creditStatus(added)).toBe("Credits added");
    expect(creditAmount(added)).toEqual({ amount: null, count: "3 credits" });
  });

  it("are listed among the payments by date, newest first", () => {
    const entries = [payment({ id: "later", date: "2030-09-20" }), payment({ id: "earlier", date: "2030-09-01" })];
    const lines = [credit({ id: "between", date: "2030-09-19" })];
    expect(
      paymentsAndCredits(entries, lines).map((row) => (row.kind === "credit" ? row.line.id : row.entry.id)),
    ).toEqual(["later", "between", "earlier"]);
  });
});
