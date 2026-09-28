// A price as the client app writes it (apps/app/src/lib/money.ts): the late
// fee, the same on the pay step (boards C4 and C5) and on moving a visit (board
// C7), and each visit a client may choose between. "The ex-GST figure is the
// main number with the inclusive figure muted beside it"
// (docs/prompts/phase2-frontend.md, "Money").

import { describe, expect, it } from "vitest";
import { priceFigures } from "../../apps/app/src/lib/money.ts";

describe("a price's figures", () => {
  it("leads with the ex-GST figure and gives the inclusive one beside it once GST applies", () => {
    expect(priceFigures({ amount_ex_gst: 400000, amount: 472000, gst_percent: 18 })).toEqual({
      exGst: "Rs. 4,000",
      inclusive: "Rs. 4,720",
    });
  });

  it("gives one figure while GST is nothing, as on staging", () => {
    expect(priceFigures({ amount_ex_gst: 400000, amount: 400000, gst_percent: 0 })).toEqual({
      exGst: "Rs. 4,000",
      inclusive: null,
    });
  });
});
