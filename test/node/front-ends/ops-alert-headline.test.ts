// An alert's first words on Tasks (apps/ops/src/tasks/alert-headline.ts): what to do, with the system IDs left to Details.

import { describe, expect, it } from "vitest";
import { headlineOf } from "../../../apps/ops/src/tasks/alert-headline.ts";

describe("an alert's headline", () => {
  it("is its first sentence, without UUIDs, vendor numbers or Razorpay IDs", () => {
    expect(
      headlineOf(
        "Leave invoice INV-000091 (4242595000000597263) as a draft in Books. Visit b1f78e74-4c55-4fac-b8b1-eff9ebbb6af6.",
      ),
    ).toBe("Leave invoice INV-000091 as a draft in Books.");
    expect(
      headlineOf(
        "Books refused refund 616588bd-1111-4111-8111-111111111111 (Razorpay rfnd_TnFaWt08eJm3cD), saying no.",
      ),
    ).toBe("Books refused refund, saying no.");
    expect(headlineOf("Razorpay 400 BAD_REQUEST_ERROR: amount exceeds maximum amount allowed..")).toBe(
      "Razorpay 400 BAD_REQUEST_ERROR: amount exceeds maximum amount allowed.",
    );
  });
});
