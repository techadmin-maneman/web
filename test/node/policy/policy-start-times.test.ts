import { describe, expect, it } from "vitest";
import { DRIVE_ESTIMATE, driveEstimateConflicts, driveMinutes } from "../../../src/policy/drive-estimate.ts";
import {
  BOOKING_RULES,
  bookingRuleConflicts,
  hoursOfCity,
  isDayTime,
  SAME_DAY_BOOKING,
  WORKING_HOURS,
  workingHoursConflicts,
} from "../../../src/policy/start-times.ts";
import { checkValue, settingNamed } from "../../../src/policy/ops-settings.ts";

// Two pins in Gurgaon, about 8 km apart as the crow flies: Sector 56 and Cyber City.
const SECTOR_56 = { lat: 28.4237, lng: 77.1031 };
const CYBER_CITY = { lat: 28.495, lng: 77.0895 };

describe("a drive's estimate", () => {
  it("lengthens the straight line by the road factor and adds the time to park", () => {
    // 11.3 km of road at 24 km/h is 28.1 minutes, and 10 to park.
    expect(driveMinutes(SECTOR_56, CYBER_CITY, 14)).toBe(39);
  });

  it("is slower in the morning and evening rush", () => {
    expect(driveMinutes(SECTOR_56, CYBER_CITY, 9)).toBe(48);
    expect(driveMinutes(SECTOR_56, CYBER_CITY, 18)).toBe(48);
    expect(driveMinutes(SECTOR_56, CYBER_CITY, 11)).toBe(39);
    expect(driveMinutes(SECTOR_56, CYBER_CITY, 21)).toBe(39);
  });

  it("is never shorter than the shortest drive, next door included", () => {
    expect(driveMinutes(SECTOR_56, SECTOR_56, 14)).toBe(DRIVE_ESTIMATE.parking);
    expect(driveMinutes(SECTOR_56, SECTOR_56, 14, { ...DRIVE_ESTIMATE, parking: 0, least: 10 })).toBe(10);
  });

  it("takes rush hours that hold together, and refuses those that don't", () => {
    expect(driveEstimateConflicts(DRIVE_ESTIMATE)).toEqual([]);
    expect(driveEstimateConflicts({ ...DRIVE_ESTIMATE, morning_to: 8 })).toEqual([["morning_to", "morning_from"]]);
    expect(driveEstimateConflicts({ ...DRIVE_ESTIMATE, evening_from: 10 })).toEqual([["evening_from", "morning_to"]]);
    expect(driveEstimateConflicts({ ...DRIVE_ESTIMATE, evening_to: 17 })).toEqual([["evening_to", "evening_from"]]);
  });
});

describe("the start-time rules", () => {
  it("hold together as committed", () => {
    expect(bookingRuleConflicts(BOOKING_RULES)).toEqual([]);
    expect(workingHoursConflicts(WORKING_HOURS)).toEqual([]);
  });

  it("refuse a break span that ends before it starts, or is shorter than the break", () => {
    expect(bookingRuleConflicts({ ...BOOKING_RULES, break_to: 12 })).toEqual([["break_to", "break_from"]]);
    expect(bookingRuleConflicts({ ...BOOKING_RULES, break: 90, break_from: 12, break_to: 13 })).toEqual([
      ["break", "break_to"],
    ]);
  });

  it("refuse more fits a day than visits", () => {
    expect(bookingRuleConflicts({ ...BOOKING_RULES, visits: 2, fits: 3 })).toEqual([["fits", "visits"]]);
  });

  it("refuse a day that ends before it starts", () => {
    expect(workingHoursConflicts({ opens: 12, closes: 12 })).toEqual([["closes", "opens"]]);
  });

  it("never let a fit be booked for today unless ops say so", () => {
    expect(SAME_DAY_BOOKING.first_fit).toBe("no");
    expect(SAME_DAY_BOOKING.consultation).toBe("yes");
  });

  it("write a city's hours as times of day", () => {
    expect(hoursOfCity({ opens: 9, closes: 20 })).toEqual({ starts: "09:00", ends: "20:00" });
  });

  it("take a technician's hours on the quarter hour", () => {
    expect(["09:00", "09:15", "17:30", "23:45"].every(isDayTime)).toBe(true);
    expect(["9:00", "09:10", "24:00", "noon"].some(isDayTime)).toBe(false);
  });

  it("are checked in the console as the register checks every rule", () => {
    const rules = settingNamed("booking_rules");
    if (rules === undefined) throw new Error("no booking_rules in the register");
    expect(checkValue(rules, { ...BOOKING_RULES, step: 10 }).ok).toBe(false);
    expect(checkValue(rules, BOOKING_RULES).ok).toBe(true);
  });
});
