// When Customer Care answer (src/policy/care-hours.ts; docs/decisions/0132-the-reply-clock.md): within the first-reply
// minutes in hours, and by the answered-by hour of the next morning outside them. Times are India's.

import { describe, expect, it } from "vitest";
import { CARE_HOURS, careHoursConflicts, careIsOn, lastClosed, replyBy } from "../../../src/policy/care-hours.ts";
import { indiaInstant } from "../../../src/lib/india-time.ts";

const india = (date: string, time: string) => indiaInstant(date, time);

describe("the reply clock", () => {
  it("gives a message written in hours the first-reply minutes", () => {
    expect(replyBy(india("2026-10-12", "10:42"))).toEqual(india("2026-10-12", "11:42"));
    expect(replyBy(india("2026-10-12", "20:00"))).toEqual(india("2026-10-12", "21:00"));
  });

  it("answers one whose minutes would run past closing by the next morning", () => {
    expect(replyBy(india("2026-10-12", "20:30"))).toEqual(india("2026-10-13", "10:00"));
  });

  it("answers one written after hours by the answered-by hour, that morning or the next", () => {
    expect(replyBy(india("2026-10-12", "23:15"))).toEqual(india("2026-10-13", "10:00"));
    expect(replyBy(india("2026-10-13", "06:30"))).toEqual(india("2026-10-13", "10:00"));
    expect(replyBy(india("2026-10-12", "21:00"))).toEqual(india("2026-10-13", "10:00"));
  });

  it("follows the hours ops set", () => {
    const hours = { opens: 8, closes: 22, first_reply: 30, answered_by: 9 };
    expect(replyBy(india("2026-10-12", "21:15"), hours)).toEqual(india("2026-10-12", "21:45"));
    expect(replyBy(india("2026-10-12", "07:00"), hours)).toEqual(india("2026-10-12", "09:00"));
    expect(careIsOn(india("2026-10-12", "08:00"), hours)).toBe(true);
    expect(careIsOn(india("2026-10-12", "22:00"), hours)).toBe(false);
  });

  it("refuses hours that close before they open, or answer outside them", () => {
    expect(careHoursConflicts(CARE_HOURS)).toEqual([]);
    expect(careHoursConflicts({ ...CARE_HOURS, closes: 9 })).toContainEqual(["closes", "opens"]);
    expect(careHoursConflicts({ ...CARE_HOURS, answered_by: 8 })).toEqual([["answered_by", "opens"]]);
    expect(careHoursConflicts({ ...CARE_HOURS, answered_by: 21 })).toEqual([["closes", "answered_by"]]);
  });
});

describe("when Care last closed", () => {
  it("is tonight's closing once it has passed, and last night's before it", () => {
    expect(lastClosed(india("2026-10-12", "22:10"))).toEqual(india("2026-10-12", "21:00"));
    expect(lastClosed(india("2026-10-13", "07:30"))).toEqual(india("2026-10-12", "21:00"));
    expect(lastClosed(india("2026-10-13", "12:00"))).toEqual(india("2026-10-12", "21:00"));
  });
});
