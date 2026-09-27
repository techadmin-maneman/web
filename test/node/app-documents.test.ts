// What the client app says of a document it cannot open yet, and of a refund still on its way, against the time
// that has passed (CLI-25). "Usually ready within the hour" of a visit done sixty days ago, and "5 to 7 working
// days" of a refund begun eighteen days ago, were both untrue.

import { describe, expect, it } from "vitest";
import type { Entry, VisitDetail } from "../../apps/app/src/api.ts";
import { documentsOf, missingInvoice, refundIsLate } from "../../apps/app/src/payments/entry.ts";
import { invoiceState } from "../../apps/app/src/lib/visit.ts";

const HOUR = 60 * 60 * 1000;

const visit = (overrides: Partial<VisitDetail>): VisitDetail =>
  ({
    status: "completed",
    ends_at: "2030-09-19T08:00:00.000Z",
    document_id: null,
    invoice_expected: true,
    invoice_held: null,
    ...overrides,
  }) as VisitDetail;

describe("a visit's invoice", () => {
  const ended = Date.parse("2030-09-19T08:00:00.000Z");

  it("opens once Books has issued it, and is never promised for a free visit", () => {
    expect(invoiceState(visit({ document_id: "d" }), ended)).toBe("open");
    expect(invoiceState(visit({ invoice_expected: false }), ended)).toBe("free");
  });

  it("is still generating for a day after the visit, and late after that", () => {
    expect(invoiceState(visit({}), ended + 2 * HOUR)).toBe("generating");
    expect(invoiceState(visit({}), ended + 23 * HOUR)).toBe("generating");
    expect(invoiceState(visit({}), ended + 25 * HOUR)).toBe("late");
  });

  it("is not spoken of at all for a visit FSM did not complete", () => {
    expect(invoiceState(visit({ status: "terminated" }), ended)).toBe("none");
  });

  // "Still generating" was said of an invoice held back on purpose (ADR 0070), however long it had been held.
  it("says an invoice held back is being checked, or waits on a ruling for a credit visit, however long it has been", () => {
    expect(invoiceState(visit({ invoice_held: "checking" }), ended + 2 * HOUR)).toBe("checking");
    expect(invoiceState(visit({ invoice_held: "credit" }), ended + 48 * HOUR)).toBe("credit");
    expect(invoiceState(visit({ invoice_held: "credit", document_id: "d" }), ended)).toBe("open");
  });
});

const payment = (overrides: Record<string, unknown>) =>
  ({
    kind: "payment",
    date: "2030-09-10",
    visit: { id: "v", date: "2030-09-19", type: "service" },
    purpose: "visit",
    charge: null,
    no_show: null,
    ...overrides,
  }) as unknown as Extract<Entry, { kind: "payment" }>;

describe("a payment's invoice not yet raised", () => {
  it("is raised once the visit is done, which it is not yet", () => {
    expect(missingInvoice(payment({}), "2030-09-12")).toBe("invoiceAfterVisit");
  });

  it("is still generating on the visit's day and the day after, and late after that", () => {
    expect(missingInvoice(payment({}), "2030-09-19")).toBe("invoice");
    expect(missingInvoice(payment({}), "2030-09-20")).toBe("invoice");
    expect(missingInvoice(payment({}), "2030-09-21")).toBe("invoiceLate");
  });
});

describe("a payment's documents", () => {
  it("are the visit's invoice and the receipt for a visit paid for", () => {
    expect(documentsOf(payment({}))).toEqual(["invoice", "receipt"]);
  });

  // A charge was kept for a visit that never happened, and a late fee is not the visit: the visit's invoice is
  // neither's, and one will never come for a cancelled visit.
  it("are the receipt alone for a charge or a late fee", () => {
    const charge = { change: "cancelled", at: "", visit_started_at: "", amount: 1 };
    expect(documentsOf(payment({ charge }))).toEqual(["receipt"]);
    expect(documentsOf(payment({ purpose: "late_fee" }))).toEqual(["receipt"]);
  });
});

describe("a refund still processing", () => {
  const refund = (date: string) => ({ kind: "refund", status: "created", date }) as unknown as Entry;

  it("is on time for Razorpay's 5 to 7 working days, which are ten days at most", () => {
    expect(refundIsLate(refund("2030-09-10"), "2030-09-20")).toBe(false);
  });

  it("is late after that, and the client is told", () => {
    expect(refundIsLate(refund("2030-09-02"), "2030-09-20")).toBe(true);
  });

  it("is never late once processed", () => {
    expect(refundIsLate({ ...refund("2030-09-02"), status: "processed" } as Entry, "2030-09-20")).toBe(false);
  });
});
