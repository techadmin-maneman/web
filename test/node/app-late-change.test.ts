// What a late change costs, as the client app's booking and move sheets say it (apps/app/src/booking/late-change.ts).

import { describe, expect, it } from "vitest";
import type { Hold, MoveTerms } from "../../apps/app/src/api.ts";
import { atStake, insideNotice, moveButton } from "../../apps/app/src/booking/late-change.ts";

const NOW = Date.parse("2026-10-02T04:50:00Z"); // 10:20 on Friday 2 October in India

const HOLD = {
  type: "service",
  price: { amount_ex_gst: 200000, amount: 200000, gst_percent: 0 },
  late_fee: null,
  free_until: "2026-10-02T03:30:00.000Z", // 9 am today, for tomorrow's 9 am window
  change_notice_hours: 24,
  late_change_charge: "visit",
  credit: null,
} as unknown as Hold;

const LATE_FEE = { amount_ex_gst: 400000, amount: 472000, gst_percent: 18 };

const MOVE = { cost: "free", paid: 236000, credit: null } as unknown as MoveTerms;

describe("the pay step's promise", () => {
  it("knows a visit sold inside its notice is charged to change from the moment it is booked (MON-08, BK-11, CP-02)", () => {
    expect(insideNotice(HOLD, NOW)).toBe(true);
    expect(insideNotice({ free_until: "2026-10-02T03:30:00.000Z" }, Date.parse("2026-10-02T03:30:00Z"))).toBe(true);
    expect(insideNotice({ free_until: "2026-10-03T03:30:00.000Z" }, NOW)).toBe(false);
  });

  it("says a service visit's payment is what a late change takes", () => {
    expect(atStake(HOLD)).toEqual({ kind: "payment", paid: 200000 });
  });

  it("says a first fit's late fee is what a late change takes", () => {
    const firstFit = { ...HOLD, type: "first_fit", late_fee: LATE_FEE, late_change_charge: "late_fee" } as Hold;
    expect(atStake(firstFit)).toEqual({ kind: "late_fee", fee: LATE_FEE });
    expect(atStake({ ...firstFit, late_fee: null })).toEqual({ kind: "nothing" });
  });

  it("says a credit is what a late change takes from a visit it pays for", () => {
    expect(atStake({ ...HOLD, credit: { remaining: 1 } })).toEqual({ kind: "credit" });
  });

  it("takes nothing where the booking is sold so, or where nothing was paid", () => {
    expect(atStake({ ...HOLD, late_change_charge: "nothing" })).toEqual({ kind: "nothing" });
    expect(atStake({ ...HOLD, price: { amount_ex_gst: 0, amount: 0, gst_percent: 0 } })).toEqual({ kind: "nothing" });
  });

  it("puts a moved visit's own payment or credit at stake, never the move's price", () => {
    const moveHold = { ...HOLD, price: { amount_ex_gst: 0, amount: 0, gst_percent: 0 } };
    expect(atStake(moveHold, MOVE)).toEqual({ kind: "payment", paid: 236000 });
    expect(atStake(moveHold, { ...MOVE, paid: 0, credit: "restored" })).toEqual({ kind: "credit" });
  });
});

describe("the move sheet's button (MON-33, BK-16, UX-06, CP-05)", () => {
  it("only picks a new date for a consultation inside the notice, which moves free", () => {
    expect(moveButton({ cost: "free" })).toBe("Pick a new date");
  });

  it("only picks a new date for a one visit inside the notice, whose payment carries over", () => {
    const oneVisit = { ...MOVE, notice: "late", paid: 2900000 } as MoveTerms;
    expect(moveButton(oneVisit)).toBe("Pick a new date");
  });

  it("accepts the charge where the move costs a late fee or the visit", () => {
    expect(moveButton({ cost: "late_fee" })).toBe("Move and accept charge");
    expect(moveButton({ cost: "charged" })).toBe("Move and accept charge");
  });
});
