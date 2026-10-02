// A price as the client app writes it (apps/app/src/lib/money.ts): on the pay step, the late fee, each visit a
// client may choose between, and the Payments tab. What is charged, GST included, leads; once GST applies its split
// sits beneath (MON-32). While GST is nothing, or no rate was recorded, there is one figure and nothing dangles after
// it (MON-19, MON-49).

import { describe, expect, it } from "vitest";
import { amountOff, priceFigures } from "../../apps/app/src/lib/money.ts";

describe("a price's figures", () => {
  it("leads with what is charged and gives the GST split beneath once GST applies", () => {
    expect(priceFigures({ amount_ex_gst: 3000000, amount: 3540000 })).toEqual({
      amount: "Rs. 35,400",
      split: "Rs. 30,000 + Rs. 5,400 GST",
    });
  });

  it("gives one figure while GST is nothing, as on staging", () => {
    expect(priceFigures({ amount_ex_gst: 200000, amount: 200000 })).toEqual({ amount: "Rs. 2,000", split: null });
  });

  it("gives one figure, never a split at a guessed rate, where no rate was recorded", () => {
    expect(priceFigures({ amount_ex_gst: null, amount: 3540000 })).toEqual({ amount: "Rs. 35,400", split: null });
  });
});

// The pay step struck through the list price and led with the price after the code, both GST included, but said the
// code took off its figure before GST: at 18%, Rs. 236 came off and the line said Rs. 200.
describe("what a discount code takes off", () => {
  it("is the price before it less the price after, GST included, so the three figures agree", () => {
    const before = { amount_ex_gst: 200000, amount: 236000 };
    const after = { amount_ex_gst: 180000, amount: 212400 };
    expect(amountOff(before, after)).toBe("Rs. 236");
  });

  it("is the code's own figure while GST is nothing", () => {
    expect(amountOff({ amount_ex_gst: 200000, amount: 200000 }, { amount_ex_gst: 180000, amount: 180000 })).toBe(
      "Rs. 200",
    );
  });
});
