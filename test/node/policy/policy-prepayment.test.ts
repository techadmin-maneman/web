// Paying for a visit (src/policy/prepayment.ts), and what that means for the
// tax invoice Books raises once the visit is done. Amounts are in paise.

import { describe, expect, it } from "vitest";
import { invoiceHold, type SoldVisit } from "../../../src/policy/prepayment.ts";

const REPLACEMENT = 1_500_000;
/** A replacement the client paid for, with no credit asked for or spent. */
const PAID: SoldVisit = { soldFor: REPLACEMENT, paidWithCredit: false, creditMissing: false };

describe("prepayment", () => {
  describe("the invoice of a visit paid for before it happens", () => {
    it("issues the invoice of a visit that totals what the client paid for it", () => {
      expect(invoiceHold(REPLACEMENT, PAID)).toBeNull();
    });

    // The staging org's Replacement item was Rs. 30,000 against the price book's Rs. 15,000.
    it("holds as a draft an invoice that totals anything else, which a credit note alone could undo", () => {
      expect(invoiceHold(2 * REPLACEMENT, PAID)).toBe("price_differs");
      expect(invoiceHold(REPLACEMENT - 100, PAID)).toBe("price_differs");
    });

    it("holds one whose sale nothing here knows, since its total cannot be checked", () => {
      expect(invoiceHold(REPLACEMENT, { ...PAID, soldFor: null })).toBe("price_unknown");
    });

    // The CA: a visit given free on a credit is a zero-priced invoice (open point 14).
    it("issues the zero-priced invoice of a visit a credit paid for, and holds one that totals anything else", () => {
      expect(invoiceHold(0, { ...PAID, soldFor: 0, paidWithCredit: true })).toBeNull();
      expect(invoiceHold(REPLACEMENT, { ...PAID, soldFor: 0, paidWithCredit: true })).toBe("price_differs");
    });

    it("never issues one for a visit booked on a credit the client no longer had, until ops decide the charge", () => {
      expect(invoiceHold(REPLACEMENT, { ...PAID, creditMissing: true })).toBe("credit_missing");
    });
  });
});
