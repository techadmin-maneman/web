// Paying for a visit (src/policy/prepayment.ts), and what that means for the
// tax invoice FSM raises once the visit is done. Amounts are in paise.

import { describe, expect, it } from "vitest";
import { invoiceHold, RULES } from "../../src/policy/prepayment.ts";

const REPLACEMENT = 1_500_000;

describe("prepayment", () => {
  describe(RULES[0], () => {
    it("issues the invoice of a visit that totals what the client paid for it", () => {
      expect(invoiceHold(REPLACEMENT, { soldFor: REPLACEMENT, paidWithCredit: false })).toBeNull();
    });

    // The staging org's Replacement item was Rs. 30,000 against the price book's Rs. 15,000.
    it("holds as a draft an invoice that totals anything else, which a credit note alone could undo", () => {
      expect(invoiceHold(2 * REPLACEMENT, { soldFor: REPLACEMENT, paidWithCredit: false })).toBe("price_differs");
      expect(invoiceHold(REPLACEMENT - 100, { soldFor: REPLACEMENT, paidWithCredit: false })).toBe("price_differs");
    });

    it("holds one whose sale nothing here knows, since its total cannot be checked", () => {
      expect(invoiceHold(REPLACEMENT, { soldFor: null, paidWithCredit: false })).toBe("price_unknown");
    });

    // Interim until the CA rules how a credit visit is invoiced (open point 14).
    it("never issues an invoice for a visit a referral credit paid for, whatever it totals", () => {
      expect(invoiceHold(REPLACEMENT, { soldFor: REPLACEMENT, paidWithCredit: true })).toBe("paid_with_credit");
      expect(invoiceHold(0, { soldFor: 0, paidWithCredit: true })).toBe("paid_with_credit");
    });
  });
});
