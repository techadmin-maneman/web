// The receipt beneath the no-show wait says whether a WhatsApp went to the client, and draws the tick only for one
// delivered: a skipped reminder once read "messaged on WhatsApp, not delivered", with a tick.

import { ICONS } from "@maneman/brand/icons";
import { describe, expect, it } from "vitest";
import { receiptLine } from "../../../apps/tech/src/job/receipt.ts";

describe("the no-show receipt", () => {
  it("names the client as who it went to, and ticks one delivered", () => {
    expect(receiptLine({ delivered_at: "2026-09-20T04:03:00.000Z" }, "Rohit")).toEqual({
      text: "WhatsApp to Rohit: delivered 9:33 am.",
      icon: ICONS.tick,
    });
  });

  it("does not tick one sent and never delivered", () => {
    expect(receiptLine({ delivered_at: null }, "Rohit")).toEqual({
      text: "WhatsApp to Rohit: sent, not delivered.",
      icon: ICONS.minus,
    });
  });

  it("says none went where none did", () => {
    expect(receiptLine(null, "Rohit")).toEqual({ text: "No WhatsApp went to Rohit.", icon: ICONS.cross });
  });
});
