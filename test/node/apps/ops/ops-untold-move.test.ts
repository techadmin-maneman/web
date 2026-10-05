// The Tasks board's line for a move the client has not heard of names why, so ops know whether he never agreed to
// WhatsApp or the message failed.

import { describe, expect, it } from "vitest";
import { dispatch } from "../../../../apps/ops/src/content.ts";
import { untoldMoveOf } from "../../../../apps/ops/src/tasks/untold-move.ts";

describe("an untold move on the Tasks board", () => {
  it("says the client has not agreed to WhatsApp", () => {
    expect(untoldMoveOf("2026-09-23T03:30:00.000Z no_consent")).toBe(
      "Moved to Wed 23 Sep, 9 am; has not agreed to WhatsApp",
    );
  });

  it("says the WhatsApp did not go, for a client who had agreed", () => {
    expect(untoldMoveOf("2026-09-23T03:30:00.000Z not_sent")).toBe(
      "Moved to Wed 23 Sep, 9 am; the WhatsApp did not go",
    );
  });

  it("claims no reason the API did not give", () => {
    expect(untoldMoveOf("2026-09-23T03:30:00.000Z")).toBe("Moved to Wed 23 Sep, 9 am; not told yet");
    expect(untoldMoveOf(null)).not.toContain("WhatsApp");
  });
});

describe("the move's notice", () => {
  it("says the window is on its way, not that it was sent", () => {
    expect(dispatch.landing.moved.messaged("Rohit M.")).toBe(
      "Moved. We're sending Rohit M. the new window on WhatsApp; if it fails, a call task appears.",
    );
  });
});
