// At the door, the WhatsApp to the client is done only once it was delivered: a skipped reminder once read "messaged on
// WhatsApp, not delivered", with a tick.

import { describe, expect, it } from "vitest";
import { whatsAppState } from "../../../apps/tech/src/job/receipt.ts";

describe("the no-show's WhatsApp", () => {
  it("is done once delivered, with the time", () => {
    expect(whatsAppState({ state: "delivered", delivered_at: "2026-09-20T04:03:00.000Z" })).toEqual({
      done: true,
      state: "Delivered 9:33 am",
    });
  });

  it("is not done when sent and never delivered", () => {
    expect(whatsAppState({ state: "sent", delivered_at: null })).toEqual({ done: false, state: "Sent, not delivered" });
  });

  it("says none went where none did, and one on its way as it goes", () => {
    expect(whatsAppState(null)).toEqual({ done: false, state: "Not sent" });
    // The arrival notice is queued the moment the technician checks in: on its way, not missing.
    expect(whatsAppState({ state: "on_its_way", delivered_at: null })).toEqual({ done: false, state: "Sending now" });
  });
});
