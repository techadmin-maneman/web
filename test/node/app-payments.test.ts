// What the client's Payments say of a payment and a refund (MON-19, CP-18), of a visit they were not home for
// (LIFE-07), and of their service-visit credits, which never appeared there (LIFE-14). Every name and figure is made
// up.

import { describe, expect, it } from "vitest";
import type { CreditLine, Entry } from "../../apps/app/src/api.ts";
import {
  creditAmount,
  creditMeta,
  creditStatus,
  creditWhat,
  documentsOf,
  entryAmount,
  entryBeneath,
  entryMeta,
  entryNamed,
  entryStatus,
  entryTitle,
  entryWhat,
  paymentsAndCredits,
} from "../../apps/app/src/payments/entry.ts";

const payment = (overrides: Record<string, unknown>) =>
  ({
    kind: "payment",
    id: "p",
    date: "2030-09-10",
    amount: 3000000,
    amount_ex_gst: 3000000,
    gst_percent: 0,
    status: "captured",
    method: "upi",
    reference: null,
    visit: { id: "v", date: "2030-09-19", type: "service" },
    booking: null,
    purpose: "visit",
    charge: null,
    no_show: null,
    ...overrides,
  }) as unknown as Extract<Entry, { kind: "payment" }>;

const refund = (overrides: Record<string, unknown>) =>
  ({
    kind: "refund",
    id: "r",
    payment_id: "p",
    date: "2030-09-14",
    amount: 3000000,
    amount_ex_gst: 3000000,
    gst_percent: 0,
    status: "processed",
    destination: "upi",
    speed: "normal",
    visit: { id: "v", date: "2030-09-19", type: "first_fit" },
    booking: null,
    ...overrides,
  }) as unknown as Extract<Entry, { kind: "refund" }>;

// After a refund the list showed two rows, both "Payment" and both "Refunded Rs. 30,000", which read as a charge
// made twice.
describe("a refund in the list", () => {
  it("is titled a refund, says what it gave back, and shows money coming back and where it goes", () => {
    const entry = refund({});
    expect(entryTitle(entry)).toBe("Refund");
    expect(entryMeta(entry, 2030)).toBe("14 Sep · First fit");
    expect(entryAmount(entry)).toBe("+ Rs. 30,000");
    expect(entryBeneath(entry)).toBe("back to your UPI");
  });

  it("is named in a WhatsApp asking for its voucher by what it gave back", () => {
    expect(entryNamed(refund({}))).toBe("first fit refund on 14 Sep 2030");
  });
});

describe("a payment in the list", () => {
  it("leads with what was paid and has nothing dangling after it while GST is nothing", () => {
    const entry = payment({});
    expect(entryTitle(entry)).toBe("Service visit");
    expect(entryAmount(entry)).toBe("Rs. 30,000");
    expect(entryBeneath(entry)).toBeNull();
  });

  it("gives the GST split beneath once GST applies, and nothing where no rate was recorded", () => {
    expect(entryBeneath(payment({ amount: 3540000, amount_ex_gst: 3000000, gst_percent: 18 }))).toBe(
      "Rs. 30,000 + Rs. 5,400 GST",
    );
    expect(entryBeneath(payment({ amount_ex_gst: null, gst_percent: null }))).toBeNull();
  });

  it("is named from the booking under way while there is no visit yet, and is a payment only when nothing is known", () => {
    const booking = { type: "first_fit", date: "2030-09-19", under_way: true };
    expect(entryWhat(payment({ visit: null, booking }))).toBe("First fit");
    expect(entryWhat(refund({ visit: null, booking: { ...booking, under_way: false } }))).toBe("First fit");
    expect(entryWhat(payment({ visit: null }))).toBe("Payment");
  });
});

const credit = (overrides: Partial<CreditLine>): CreditLine => ({
  id: "c",
  date: "2030-09-19",
  event: "used",
  visits: -1,
  visit: { id: "v", date: "2030-09-19", type: "service" },
  source: null,
  referral_side: null,
  no_show: null,
  ...overrides,
});

/** A visit the client was not home for, ruled on before its charge was recorded. */
const noShow = (decision: "undecided" | "charged" | "waived") => ({
  decision,
  waited_minutes: 16,
  charge: null,
  dispute: null,
  disputable: false,
  dispute_closed_at: null,
});

describe("a visit's payment the client was not home for", () => {
  const notHome = (decision: "undecided" | "charged" | "waived") => payment({ no_show: noShow(decision) });

  it("says nobody was home and how long we waited, in place of the method", () => {
    expect(entryMeta(notHome("charged"), 2030)).toBe("10 Sep · not home, we waited 16 min");
  });

  it("is a charge once ops charge it, and stays paid otherwise", () => {
    expect(entryStatus(notHome("charged"))).toBe("Charged");
    expect(entryStatus(notHome("undecided"))).toBe("Paid · under review");
    expect(entryStatus(notHome("waived"))).toBe("Paid · not charged");
  });

  it("has the receipt alone: no invoice comes for a visit that did not happen", () => {
    const detail = { ...notHome("charged"), documents: { invoice: null, receipt: null } };
    expect(documentsOf(detail)).toEqual(["receipt"]);
  });
});

describe("the credits among the payments", () => {
  it("say a visit a free service visit covered, with Rs. 0 and the visit used, naming the reward once", () => {
    const line = credit({});
    expect(creditMeta(line, 2030)).toBe("19 Sep · free service visit");
    expect(creditStatus(line)).toBe("Covered");
    expect(creditAmount(line)).toEqual({ amount: "Rs. 0", count: "1 visit used" });
  });

  it("say a free service visit is lost on a late cancel or a charged no-show, and back after a cancel in time", () => {
    expect(creditStatus(credit({ event: "lost" }))).toBe("Not returned");
    expect(creditMeta(credit({ event: "lost", no_show: noShow("charged") }), 2030)).toBe(
      "19 Sep · not home, we waited 16 min",
    );
    expect(creditStatus(credit({ event: "returned", visits: 1 }))).toBe("Returned");
    expect(creditAmount(credit({ event: "returned", visits: 1 }))).toEqual({ amount: "Rs. 0", count: "1 visit back" });
  });

  it("say where free service visits added came from, and how many", () => {
    const added = credit({ event: "added", visits: 3, visit: null, source: "ops" });
    expect(creditWhat(added)).toBe("Free service visits");
    expect(creditMeta(added, 2030)).toBe("19 Sep · from us");
    expect(creditStatus(added)).toBe("Added");
    expect(creditAmount(added)).toEqual({ amount: null, count: "3 visits" });
  });

  // MON-36: an invited friend read that "a friend you invited was fitted", which was the referrer's line.
  it("say an invite's visits by which side of it the client was", () => {
    const fromInvite = (side: CreditLine["referral_side"]) =>
      creditMeta(credit({ event: "added", visits: 3, visit: null, source: "referral", referral_side: side }), 2030);
    expect(fromInvite("referrer")).toBe("19 Sep · your friend was fitted");
    expect(fromInvite("friend")).toBe("19 Sep · from your invite");
    expect(fromInvite(null)).toBe("19 Sep · from an invite");
  });

  it("are listed among the payments by date, newest first", () => {
    const entries = [payment({ id: "later", date: "2030-09-20" }), payment({ id: "earlier", date: "2030-09-01" })];
    const lines = [credit({ id: "between", date: "2030-09-19" })];
    expect(
      paymentsAndCredits(entries, lines).map((row) => (row.kind === "credit" ? row.line.id : row.entry.id)),
    ).toEqual(["later", "between", "earlier"]);
  });
});
