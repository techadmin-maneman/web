// When Customer Care answer (src/policy/care-hours.ts; docs/decisions/0132-the-reply-clock.md): within the first-reply
// minutes in hours, and by the answered-by time of the next morning outside them. Times are India's, set to the minute
// (docs/decisions/0322-care-times.md): 9:30 am to 7 pm, answered by 10 am, unless ops say otherwise.

import { describe, expect, it } from "vitest";
import {
  CARE_HOURS,
  careHoursForClients,
  clockOf,
  careHoursConflicts,
  careIsOn,
  careMinutesBetween,
  lastClosed,
  leadAlertAt,
  replyBy,
} from "../../../src/policy/care-hours.ts";
import { indiaInstant } from "../../../src/lib/india-time.ts";

const india = (date: string, time: string) => indiaInstant(date, time);

describe("the reply clock", () => {
  it("gives a message written in hours the first-reply minutes", () => {
    expect(replyBy(india("2026-10-12", "10:42"))).toEqual(india("2026-10-12", "11:42"));
    expect(replyBy(india("2026-10-12", "17:00"))).toEqual(india("2026-10-12", "18:00"));
  });

  it("answers one whose minutes would run past closing by the next morning", () => {
    expect(replyBy(india("2026-10-12", "18:30"))).toEqual(india("2026-10-13", "10:00"));
  });

  it("answers one written after hours by the answered-by time, that morning or the next", () => {
    expect(replyBy(india("2026-10-12", "23:15"))).toEqual(india("2026-10-13", "10:00"));
    expect(replyBy(india("2026-10-13", "06:30"))).toEqual(india("2026-10-13", "10:00"));
    expect(replyBy(india("2026-10-12", "19:00"))).toEqual(india("2026-10-13", "10:00"));
  });

  it("opens at 9:30, to the minute", () => {
    expect(careIsOn(india("2026-10-12", "09:29"))).toBe(false);
    expect(careIsOn(india("2026-10-12", "09:30"))).toBe(true);
    expect(careIsOn(india("2026-10-12", "18:59"))).toBe(true);
    expect(careIsOn(india("2026-10-12", "19:00"))).toBe(false);
  });

  it("follows the times ops set", () => {
    const hours = { opens: 8 * 60, closes: 22 * 60, first_reply: 30, answered_by: 9 * 60, lead_alert: 5 };
    expect(replyBy(india("2026-10-12", "21:15"), hours)).toEqual(india("2026-10-12", "21:45"));
    expect(replyBy(india("2026-10-12", "07:00"), hours)).toEqual(india("2026-10-12", "09:00"));
    expect(careIsOn(india("2026-10-12", "08:00"), hours)).toBe(true);
    expect(careIsOn(india("2026-10-12", "22:00"), hours)).toBe(false);
  });

  it("refuses times that close before they open, or answer outside them", () => {
    expect(careHoursConflicts(CARE_HOURS)).toEqual([]);
    expect(careHoursConflicts({ ...CARE_HOURS, closes: 9 * 60 })).toContainEqual(["closes", "opens"]);
    expect(careHoursConflicts({ ...CARE_HOURS, answered_by: 8 * 60 })).toEqual([["answered_by", "opens"]]);
    expect(careHoursConflicts({ ...CARE_HOURS, answered_by: 19 * 60 })).toEqual([["closes", "answered_by"]]);
  });
});

describe("when Care last closed", () => {
  it("is tonight's closing once it has passed, and last night's before it", () => {
    expect(lastClosed(india("2026-10-12", "22:10"))).toEqual(india("2026-10-12", "19:00"));
    expect(lastClosed(india("2026-10-13", "07:30"))).toEqual(india("2026-10-12", "19:00"));
    expect(lastClosed(india("2026-10-13", "12:00"))).toEqual(india("2026-10-12", "19:00"));
  });
});

describe("a wait in Care hours", () => {
  it("counts only the minutes Care are on", () => {
    expect(careMinutesBetween(india("2026-10-12", "10:00"), india("2026-10-12", "10:45"))).toBe(45);
    expect(careMinutesBetween(india("2026-10-12", "18:50"), india("2026-10-13", "09:40"))).toBe(20);
    expect(careMinutesBetween(india("2026-10-12", "20:00"), india("2026-10-13", "09:00"))).toBe(0);
    expect(careMinutesBetween(india("2026-10-12", "18:00"), india("2026-10-14", "10:30"))).toBe(60 + 570 + 60);
  });
});

describe("Care's times for the client app", () => {
  it("are minutes past midnight, beside the whole hours an older app copy reads", () => {
    expect(careHoursForClients(CARE_HOURS)).toEqual({
      opens: 9,
      closes: 19,
      opens_minute: 570,
      closes_minute: 1140,
      first_reply: 60,
    });
    expect(clockOf(570)).toBe("09:30");
  });
});

describe("a new lead's alert", () => {
  it("comes once it has waited the alert minutes while Care are on", () => {
    expect(leadAlertAt(india("2026-11-26", "11:00"))).toEqual(india("2026-11-26", "11:05"));
    expect(leadAlertAt(india("2026-11-26", "18:55"))).toEqual(india("2026-11-26", "19:00"));
  });

  it("counts a wait over closing from the next opening", () => {
    expect(leadAlertAt(india("2026-11-26", "18:58"))).toEqual(india("2026-11-27", "09:33"));
    expect(leadAlertAt(india("2026-11-26", "23:10"))).toEqual(india("2026-11-27", "09:35"));
    expect(leadAlertAt(india("2026-11-27", "07:00"))).toEqual(india("2026-11-27", "09:35"));
  });

  it("follows the minutes ops set", () => {
    expect(leadAlertAt(india("2026-11-26", "11:00"), { ...CARE_HOURS, lead_alert: 15 })).toEqual(
      india("2026-11-26", "11:15"),
    );
  });
});
