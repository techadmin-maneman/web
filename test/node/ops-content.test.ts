// The ops console's own values, held to their sources: the launch panel shows
// the message the queue will actually send, and sends people to the public
// site's booking page.

import { describe, expect, it } from "vitest";
import { BOOKING_URL, dispatch, waitlist } from "../../apps/ops/src/content.ts";
import { renderMessage } from "../../src/config/message-templates.ts";
import { HOSTNAME } from "../../src/config/environments.ts";
import { BOOKING_WINDOWS, WINDOW_TIMES } from "../../src/config/scheduling.ts";
import { MOVE_REASONS } from "../../src/policy/dispatch.ts";
import { VISIT_TYPES } from "../../src/config/visit-types.ts";

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

describe("the dispatch board's words", () => {
  /** "09:00" → "9", the hour as the board's drawer writes it. */
  const hour = (time: string) => String(Number(time.slice(0, 2)) % 12 === 0 ? 12 : Number(time.slice(0, 2)) % 12);

  it.each(BOOKING_WINDOWS)("%s's hours are WINDOW_TIMES', which the owner has still to rule", (window) => {
    const hours = dispatch.windowHours[window] ?? "";
    const times = WINDOW_TIMES[window];
    expect(hours, "the start").toMatch(new RegExp(`\\b${hour(times.start)}\\b`));
    expect(hours, "the end").toMatch(new RegExp(`\\b${hour(times.end)}\\b`));
  });

  it("offers every reason the policy allows, and no other", () => {
    expect(dispatch.move.reasons.map((each) => each.reason)).toEqual([...MOVE_REASONS]);
  });

  it("names every kind of visit the board can draw", () => {
    for (const type of VISIT_TYPES) {
      expect(dispatch.types[type], type).toBeTruthy();
      expect(dispatch.typeNames[type], type).toBeTruthy();
    }
  });

  it("writes every window the API answers with", () => {
    for (const window of BOOKING_WINDOWS) expect(dispatch.windows[window], window).toBeTruthy();
  });
});
