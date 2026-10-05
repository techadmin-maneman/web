// When a client is reminded that free service visits are running out: a month before their last day, then a week
// before (src/policy/credit-reminders.ts).

import { describe, expect, it } from "vitest";
import { creditReminderDay, creditReminderOwed } from "../../src/policy/credit-reminders.ts";

const LAST_DAY = "2026-11-30";
const GIVEN_ON = "2025-11-30";

describe("the reminder due", () => {
  it("is none until a month before the last day", () => {
    expect(creditReminderDay(LAST_DAY, GIVEN_ON, "2026-10-30")).toBeNull();
    expect(creditReminderDay(LAST_DAY, GIVEN_ON, "2026-10-31")).toBe("2026-10-31");
  });

  it("is the week's from a week before, to the last day", () => {
    expect(creditReminderDay(LAST_DAY, GIVEN_ON, "2026-11-22")).toBe("2026-10-31");
    expect(creditReminderDay(LAST_DAY, GIVEN_ON, "2026-11-23")).toBe("2026-11-23");
    expect(creditReminderDay(LAST_DAY, GIVEN_ON, LAST_DAY)).toBe("2026-11-23");
  });

  it("is none for a reminder day on or before the day the visits were given", () => {
    expect(creditReminderDay(LAST_DAY, "2026-11-10", "2026-11-15")).toBeNull();
    expect(creditReminderDay(LAST_DAY, "2026-11-10", "2026-11-23")).toBe("2026-11-23");
    expect(creditReminderDay(LAST_DAY, "2026-11-23", "2026-11-25")).toBeNull();
  });
});

describe("a reminder is owed", () => {
  const visits = (remindedOn: string | null) => ({ lastDay: LAST_DAY, givenOn: GIVEN_ON, remindedOn });

  it("once a month before, and again a week before", () => {
    expect(creditReminderOwed(visits(null), "2026-10-31")).toBe(true);
    expect(creditReminderOwed(visits("2026-10-31"), "2026-11-05")).toBe(false);
    expect(creditReminderOwed(visits("2026-10-31"), "2026-11-23")).toBe(true);
    expect(creditReminderOwed(visits("2026-11-23"), "2026-11-28")).toBe(false);
  });

  it("only the week's, after an outage that missed the month's", () => {
    expect(creditReminderOwed(visits(null), "2026-11-25")).toBe(true);
    expect(creditReminderOwed(visits("2026-11-25"), "2026-11-26")).toBe(false);
  });

  it("not before the month's day", () => {
    expect(creditReminderOwed(visits(null), "2026-10-01")).toBe(false);
  });
});
