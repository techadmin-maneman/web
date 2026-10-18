// The GST place of supply (src/config/gst.ts) and when a city's reminder hour has come (src/policy/city-settings.ts),
// as docs/decisions/0198-cities-as-data.md has them.

import { describe, expect, it } from "vitest";
import { NO_GST, placeOfSupply } from "../../../src/config/gst.ts";
import { CITY_SETTING_NAMES, hourHasCome, isCitySetting } from "../../../src/policy/city-settings.ts";

const REGISTERED = { gstin: "06AAACM1234A1Z5", stateCode: "HR", sac: "999721" };

describe("the place of supply", () => {
  it("is the state of the client's city, else the state registered in", () => {
    expect(placeOfSupply("MH", REGISTERED)).toBe("MH");
    expect(placeOfSupply(null, REGISTERED)).toBe("HR");
  });

  it("is none while GST is off, which Books then refuses", () => {
    expect(placeOfSupply("MH", NO_GST)).toBeNull();
  });
});

describe("a city's own rules", () => {
  it("are the check-in radius, the reminder hour, the working hours and the drive estimate, and no other", () => {
    expect(CITY_SETTING_NAMES).toEqual(["checkin_radius_m", "reminder_hour", "working_hours", "drive_estimate"]);
    expect(isCitySetting("care_hours")).toBe(false);
  });

  it("send a city's reminders from its own hour in India", () => {
    const tenAm = new Date("2026-09-21T04:30:00.000Z");
    expect(hourHasCome(10, tenAm)).toBe(true);
    expect(hourHasCome(11, tenAm)).toBe(false);
  });
});
