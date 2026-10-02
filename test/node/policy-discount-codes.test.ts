// Discount codes (src/policy/discount-codes.ts), each rule named by the owner's rulings of 1 October 2026.

import { describe, expect, it } from "vitest";
import {
  amountOff,
  CODE_ALPHABET,
  codeRefusal,
  COVERABLE,
  creditComesFirst,
  discounted,
  isCodeText,
  normalisedCode,
  RULES,
  termsRefusal,
  type CodeState,
} from "../../src/policy/discount-codes.ts";

/** A code that applies: on, no end, no limit, any client as often as they like, and every kind it can cover. */
const OPEN: CodeState = {
  switchedOff: false,
  expiresOn: null,
  covers: COVERABLE,
  maxUses: null,
  uses: 0,
  oncePerClient: false,
  usedByClient: false,
};

/** A first fit, new, paid in money. */
const FIRST_FIT = { type: "first_fit", onCredit: false, moves: false } as const;

const TODAY = "2026-10-01";

describe("discount codes", () => {
  it(RULES[0], () => {
    // 10% of Rs. 30,000 before GST, and GST on what is left.
    const price = { amount_ex_gst: 3_000_000, amount: 3_540_000, gst_percent: 18 };
    const tenPercent = { kind: "percent", value: 10, cap: null } as const;
    expect(amountOff(tenPercent, price.amount_ex_gst)).toBe(300_000);
    expect(discounted(price, 300_000)).toEqual({ amount_ex_gst: 2_700_000, amount: 3_186_000, gst_percent: 18 });
    // A cap in rupees holds a percentage down.
    expect(amountOff({ ...tenPercent, cap: 200_000 }, price.amount_ex_gst)).toBe(200_000);
    // Rupees off, whatever the price.
    expect(amountOff({ kind: "amount", value: 150_000, cap: null }, price.amount_ex_gst)).toBe(150_000);
    // Never below zero: a code worth more than the price takes the price off, and no more.
    expect(amountOff({ kind: "amount", value: 5_000_000, cap: null }, price.amount_ex_gst)).toBe(3_000_000);
    expect(discounted(price, 3_000_000)).toEqual({ amount_ex_gst: 0, amount: 0, gst_percent: 18 });
    // A percentage comes to the nearest whole rupee: 15% of Rs. 2,547 is Rs. 382.05, so Rs. 382.
    expect(amountOff({ kind: "percent", value: 15, cap: null }, 254_700)).toBe(38_200);
    expect(amountOff({ kind: "percent", value: 15, cap: null }, 254_300)).toBe(38_100);
  });

  it("takes whole rupees off, so GST at 18% is two equal halves, as Books works it out", () => {
    // Rs. 2,547 less 15% was charged Rs. 2,554.64, while Books' CGST 9% and SGST 9% came to Rs. 2,554.65.
    const halfOfGst = (exGst: number) => Math.round((exGst * 9) / 100);
    const mismatches: string[] = [];
    for (let rupees = 1; rupees <= 3_100; rupees += 1) {
      for (let percent = 1; percent <= 100; percent += 1) {
        const price = { amount_ex_gst: rupees * 100, gst_percent: 18 };
        const off = amountOff({ kind: "percent", value: percent, cap: null }, price.amount_ex_gst);
        const sold = discounted(price, off);
        const books = sold.amount_ex_gst + 2 * halfOfGst(sold.amount_ex_gst);
        if (off % 100 !== 0 || sold.amount !== books) mismatches.push(`Rs. ${String(rupees)} less ${String(percent)}%`);
      }
    }
    expect(mismatches).toEqual([]);
  });

  it("is made only in whole rupees, and with a cap only on a percentage", () => {
    expect(termsRefusal({ kind: "percent", value: 15, cap: 50_000 })).toBeNull();
    expect(termsRefusal({ kind: "amount", value: 150_000, cap: null })).toBeNull();
    expect(termsRefusal({ kind: "percent", value: 101, cap: null })).toBe("value");
    expect(termsRefusal({ kind: "amount", value: 150_050, cap: null })).toBe("value");
    expect(termsRefusal({ kind: "percent", value: 15, cap: 50_050 })).toBe("cap");
    expect(termsRefusal({ kind: "amount", value: 150_000, cap: 50_000 })).toBe("cap");
  });

  it(RULES[1], () => {
    expect(COVERABLE).toEqual(["first_fit", "service", "replacement"]);
    const servicesOnly = { ...OPEN, covers: ["service"] as const };
    expect(codeRefusal(servicesOnly, { ...FIRST_FIT, type: "service" }, TODAY)).toBeNull();
    // A one visit is a first fit, so a code for first fits covers it, and one for services does not.
    expect(codeRefusal(servicesOnly, FIRST_FIT, TODAY)).toBe("not_covered");
    expect(codeRefusal(OPEN, FIRST_FIT, TODAY)).toBeNull();
    // A consultation costs nothing, and no code covers it.
    expect(codeRefusal(OPEN, { ...FIRST_FIT, type: "consultation" }, TODAY)).toBe("not_covered");
  });

  it(RULES[2], () => {
    // Whoever enters it, a code is the same code: matched whatever its case, and with no spaces around it.
    expect(normalisedCode("  wedding25 ")).toBe("WEDDING25");
    // Its letters and digits are those no one misreads: no I, L, O, 0 or 1.
    expect(CODE_ALPHABET).not.toMatch(/[ILO01]/);
    expect(isCodeText("WEDDING25")).toBe(false);
    expect(isCodeText("WEDDNG25")).toBe(true);
    expect(isCodeText("ABC")).toBe(false);
    expect(isCodeText("A".repeat(17))).toBe(false);
  });

  it(RULES[3], () => {
    // An expiry date: the code may be entered all of its last day in India, and not the day after.
    expect(codeRefusal({ ...OPEN, expiresOn: TODAY }, FIRST_FIT, TODAY)).toBeNull();
    expect(codeRefusal({ ...OPEN, expiresOn: "2026-09-30" }, FIRST_FIT, TODAY)).toBe("expired");
    // Total uses: one, many or unlimited.
    expect(codeRefusal({ ...OPEN, maxUses: 1, uses: 0 }, FIRST_FIT, TODAY)).toBeNull();
    expect(codeRefusal({ ...OPEN, maxUses: 1, uses: 1 }, FIRST_FIT, TODAY)).toBe("used_up");
    expect(codeRefusal({ ...OPEN, maxUses: null, uses: 5000 }, FIRST_FIT, TODAY)).toBeNull();
    // Once per client.
    expect(codeRefusal({ ...OPEN, oncePerClient: true, usedByClient: true }, FIRST_FIT, TODAY)).toBe("used_by_client");
    expect(codeRefusal({ ...OPEN, oncePerClient: false, usedByClient: true }, FIRST_FIT, TODAY)).toBeNull();
    // Never on a visit a referral credit pays for.
    expect(codeRefusal(OPEN, { ...FIRST_FIT, type: "service", onCredit: true }, TODAY)).toBe("credit");
    // Ops can switch a code off at any time.
    expect(codeRefusal({ ...OPEN, switchedOff: true }, FIRST_FIT, TODAY)).toBe("switched_off");
  });

  it(RULES[4], () => {
    // A credit pays a service visit, so a client holding one spends it before any code.
    expect(creditComesFirst("service", 1)).toBe(true);
    expect(creditComesFirst("service", 0)).toBe(false);
    // No credit pays a first fit or a replacement, so a code goes on one whatever credits are held.
    expect(creditComesFirst("first_fit", 3)).toBe(false);
    expect(creditComesFirst("replacement", 3)).toBe(false);
  });

  it("is for a visit sold, not for moving one: a move's fee, or the visit a late move books, takes no code", () => {
    expect(codeRefusal(OPEN, { ...FIRST_FIT, moves: true }, TODAY)).toBe("move");
  });
});
