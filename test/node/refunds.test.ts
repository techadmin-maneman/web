// A refund, made once however often it is asked for (src/domain/refunds.ts; docs/open-points.md, item 161).

import { describe, expect, it } from "vitest";
import { askRefund, refundReceipt } from "../../src/domain/refunds.ts";
import type { PaymentsProvider } from "../../src/providers/payments/index.ts";
import { PaymentUnanswered } from "../../src/providers/provider-error.ts";

const ASKED = { amount: 50_000, notes: { appointment_id: "visit-1" }, receipt: "c-visit-1" };

/** Razorpay answering each ask in turn: a refund's ID, a refusal, or no answer. */
function razorpay(...answers: ("made" | "made before" | "refused" | "silent")[]) {
  const asked: string[] = [];
  const notAsked = () => Promise.reject(new Error("not asked"));
  const payments: PaymentsProvider = {
    createOrder: notAsked,
    orderPayments: notAsked,
    createPaymentLink: notAsked,
    findPaymentLink: notAsked,
    resendPaymentLink: notAsked,
    paymentLink: notAsked,
    cancelPaymentLink: notAsked,
    refund: (_paymentId, refund) => {
      asked.push(refund.receipt);
      const answer = answers[asked.length - 1];
      if (answer === "made") return Promise.resolve({ id: "rfnd_1" });
      if (answer === "made before") return Promise.resolve({ id: null });
      if (answer === "refused") return Promise.reject(new Error("Razorpay 400 BAD_REQUEST_ERROR"));
      return Promise.reject(new PaymentUnanswered("refund", new Error("timed out")));
    },
  };
  return { payments, asked };
}

describe("askRefund", () => {
  it("answers the refund Razorpay made", async () => {
    const { payments, asked } = razorpay("made");
    expect(await askRefund(payments, "pay_1", ASKED)).toEqual({ kind: "refunded", refundId: "rfnd_1" });
    expect(asked).toEqual(["c-visit-1"]);
  });

  it("takes a refusal as one, and asks nothing more", async () => {
    const { payments, asked } = razorpay("refused", "made");
    expect(await askRefund(payments, "pay_1", ASKED)).toMatchObject({ kind: "refused" });
    expect(asked).toHaveLength(1);
  });

  it("asks once more, under the same receipt, when Razorpay gave no answer", async () => {
    const made = razorpay("silent", "made");
    expect(await askRefund(made.payments, "pay_1", ASKED)).toEqual({ kind: "refunded", refundId: "rfnd_1" });
    expect(made.asked).toEqual(["c-visit-1", "c-visit-1"]);

    const madeBefore = razorpay("silent", "made before");
    expect(await askRefund(madeBefore.payments, "pay_1", ASKED)).toEqual({ kind: "refunded", refundId: null });
  });

  it("leaves it unanswered after two silences, or a refusal after one, since the first may have refunded", async () => {
    expect(await askRefund(razorpay("silent", "silent").payments, "pay_1", ASKED)).toMatchObject({
      kind: "unanswered",
    });
    const refusedAfter = razorpay("silent", "refused", "made");
    expect(await askRefund(refusedAfter.payments, "pay_1", ASKED)).toMatchObject({ kind: "unanswered" });
    expect(refusedAfter.asked).toHaveLength(2);
  });

  it("takes no refusal as one for a refund asked before, which may have been made then", async () => {
    const refused = razorpay("refused", "refused", "made");
    expect(await askRefund(refused.payments, "pay_1", ASKED, { askedBefore: true })).toMatchObject({
      kind: "unanswered",
    });
    expect(refused.asked).toHaveLength(2);

    const madeBefore = razorpay("made before");
    expect(await askRefund(madeBefore.payments, "pay_1", ASKED, { askedBefore: true })).toEqual({
      kind: "refunded",
      refundId: null,
    });
  });
});

describe("refundReceipt", () => {
  const ID = "22222222-2222-4222-8222-222222222222";

  it("gives each refund of a payment its own receipt, within the 40 characters Razorpay takes", () => {
    const receipts = [
      refundReceipt({ kind: "hold", holdId: ID }),
      refundReceipt({ kind: "cancel", appointmentId: ID }),
      refundReceipt({ kind: "no_show", why: "waived", appointmentId: ID }),
      refundReceipt({ kind: "no_show", why: "charged", appointmentId: ID }),
      refundReceipt({ kind: "no_show", why: "refunded on dispute", appointmentId: ID }),
    ];
    expect(new Set(receipts).size).toBe(receipts.length);
    for (const receipt of receipts) expect(receipt.length).toBeLessThanOrEqual(40);
    expect(receipts[0]).toBe(`h-${ID}`);
  });
});
