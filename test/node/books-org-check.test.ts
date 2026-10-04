// What the read-only Books check makes of the org's answers (scripts/lib/books-org-check.ts). Every ID is made up.

import { describe, expect, it } from "vitest";
import {
  discountPreference,
  gstIdentity,
  organisation,
  refundAccount,
} from "../../scripts/lib/books-org-check.ts";

describe("the invoice discount preference", () => {
  it("passes at line item level, before tax, which the invoice pass writes", () => {
    const answer = { invoice_settings: { discount_type: "item_level", is_discount_before_tax: true } };
    expect(discountPreference(answer)).toMatchObject({ outcome: "pass" });
  });

  it("fails at transaction level, and says where to change it", () => {
    const line = discountPreference({ invoice_settings: { discount_type: "entity_level", is_discount_before_tax: true } });
    expect(line.outcome).toBe("fail");
    expect(line.detail).toContain("at line item level");
  });

  it("fails after tax, or with no discount at all", () => {
    const afterTax = { invoice_settings: { discount_type: "item_level", is_discount_before_tax: false } };
    expect(discountPreference(afterTax).outcome).toBe("fail");
    expect(discountPreference({ invoice_settings: { discount_type: "no_discount" } }).outcome).toBe("fail");
  });

  it("fails on an answer it cannot read", () => {
    expect(discountPreference({ code: 57, message: "You are not authorized" }).outcome).toBe("fail");
  });
});

describe("the organisation", () => {
  it("passes in rupees, by its name", () => {
    const line = organisation({ organization: { name: "Mane Man", currency_code: "INR" } });
    expect(line).toEqual({ outcome: "pass", check: "Books organisation", detail: "Mane Man, INR" });
  });

  it("fails in another currency, or when Books holds none", () => {
    expect(organisation({ organization: { name: "Mane Man", currency_code: "USD" } }).outcome).toBe("fail");
    expect(organisation({ code: 6041, message: "Organization does not exist" }).outcome).toBe("fail");
  });
});

describe("the GST identity", () => {
  const ORG = { organization: { name: "Mane Man", currency_code: "INR" } };

  it("is skipped while GST is off", () => {
    expect(gstIdentity({ gstin: null, stateCode: null }, ORG)).toEqual([
      { outcome: "skip", check: "GST", detail: "off: BOOKS_GSTIN is empty, so no invoice carries GST" },
    ]);
  });

  it("passes a GSTIN of the state it is registered in", () => {
    const lines = gstIdentity({ gstin: "06AAACM1234A1Z5", stateCode: "HR" }, ORG);
    expect(lines.map((line) => line.outcome)).toEqual(["pass"]);
  });

  it("fails a GSTIN of another state than the one set beside it", () => {
    const [line] = gstIdentity({ gstin: "07AAACM1234A1Z5", stateCode: "HR" }, ORG);
    expect(line?.outcome).toBe("fail");
    expect(line?.detail).toContain("Delhi");
  });

  it("fails a GSTIN of a state we do not serve, or one not written as a GSTIN", () => {
    expect(gstIdentity({ gstin: "27AAACM1234A1Z5", stateCode: "HR" }, ORG)[0]?.outcome).toBe("fail");
    expect(gstIdentity({ gstin: "not-a-gstin", stateCode: "HR" }, ORG)[0]?.outcome).toBe("fail");
  });

  it("fails where Books keeps the organisation in another state than its GSTIN", () => {
    const inMaharashtra = { organization: { name: "Mane Man", currency_code: "INR", state_code: "MH" } };
    const lines = gstIdentity({ gstin: "06AAACM1234A1Z5", stateCode: "HR" }, inMaharashtra);
    expect(lines.map((line) => line.outcome)).toEqual(["pass", "fail"]);
    expect(lines[1]?.detail).toContain("MH");
  });
});

describe("the refund account", () => {
  it("fails while none is set: refunds are not recorded in Books", () => {
    expect(refundAccount(null, null).outcome).toBe("fail");
  });

  it("passes an active account, by its name", () => {
    const answer = { status: 200, json: { bankaccount: { account_name: "Razorpay settlements", is_active: true } } };
    expect(refundAccount("4242", answer)).toEqual({
      outcome: "pass",
      check: "refund account",
      detail: "4242, Razorpay settlements",
    });
  });

  it("fails an inactive account, or one Books does not hold", () => {
    const inactive = { status: 200, json: { bankaccount: { account_name: "Old", is_active: false } } };
    expect(refundAccount("4242", inactive).outcome).toBe("fail");
    expect(refundAccount("4242", { status: 404, json: { code: 1002, message: "Account does not exist" } }).outcome).toBe(
      "fail",
    );
  });

  it("is skipped when the scripts' token may not read accounts, and says which scope reads them", () => {
    const line = refundAccount("4242", { status: 401, json: { code: 57, message: "You are not authorized" } });
    expect(line.outcome).toBe("skip");
    expect(line.detail).toContain("ZohoBooks.banking.READ");
  });
});
