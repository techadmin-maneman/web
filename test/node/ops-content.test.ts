// The ops console's own values, held to their sources: the launch panel shows
// the message the queue will actually send, and sends people to the public
// site's booking page.

import { describe, expect, it } from "vitest";
import { BOOKING_URL, waitlist } from "../../apps/ops/src/content.ts";
import { renderMessage } from "../../src/config/message-templates.ts";
import { HOSTNAME } from "../../src/config/environments.ts";

describe("the ops console's content", () => {
  it("previews the launch alert word for word, with the first name left as a placeholder", () => {
    const url = BOOKING_URL.staging ?? "";
    expect(waitlist.launch.message("Bandra W", url)).toBe(
      renderMessage("launch_alert_v1", ["{first name}", "Bandra W", url]),
    );
  });

  it("sends people to the public site's booking page, in each environment", () => {
    expect(BOOKING_URL.staging).toBe(`https://${HOSTNAME.staging}/book`);
    expect(BOOKING_URL.production).toBe(`https://${HOSTNAME.production}/book`);
  });
});
