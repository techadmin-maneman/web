// What a technician sees of each job, each rule named by the prompt's own words
// (src/policy/job-visibility.ts). Days are India's: NOW is 12 noon on Monday 21
// September 2026, which is 06:30 UTC.

import { describe, expect, it } from "vitest";
import {
  jobDay,
  OUTLINE_FIELDS,
  PAYMENT_BADGES,
  RULES,
  unlocked,
  unlocksAt,
  visibleFields,
} from "../../src/policy/job-visibility.ts";

const NOW = new Date("2026-09-21T06:30:00Z");
/** Noon in India on a date. */
const noon = (date: string) => new Date(`${date}T06:30:00Z`);
/** 6 pm in India on a date, the hour a job unlocks at. */
const sixPm = (date: string) => new Date(`${date}T12:30:00Z`);

describe("job visibility", () => {
  it(RULES[0], () => {
    expect(jobDay(noon("2026-09-21"), NOW)).toBe("today");
    expect(jobDay(noon("2026-09-22"), NOW)).toBe("tomorrow");
    expect(jobDay(noon("2026-09-23"), NOW)).toBe("later");
  });

  it("counts the day in India, not in UTC", () => {
    // 22:00 on Monday in India is 16:30 UTC, and still today's last job.
    expect(jobDay(new Date("2026-09-21T16:30:00Z"), NOW)).toBe("today");
    // 01:00 on Tuesday in India is 19:30 UTC on Monday, and is tomorrow's.
    expect(jobDay(new Date("2026-09-21T19:30:00Z"), NOW)).toBe("tomorrow");
  });

  it(RULES[1], () => {
    const wednesday = noon("2026-09-23");
    // It unlocks at 6 pm in India on Tuesday, the day before.
    expect(unlocksAt(wednesday)).toEqual(new Date("2026-09-22T12:30:00Z"));
    expect(unlocked(wednesday, NOW)).toBe(false);
    expect(visibleFields(wednesday, NOW)).toEqual([...OUTLINE_FIELDS]);

    const tuesday = noon("2026-09-22");
    expect(unlocksAt(tuesday)).toEqual(new Date("2026-09-21T12:30:00Z"));
    expect(visibleFields(tuesday, sixPm("2026-09-21"))).toContain("access_notes");
  });

  it("holds tomorrow's address back until 6 pm today, which is the point of the rule", () => {
    // Tomorrow's job is on the list from midnight, collapsed; its address is not.
    const tomorrow = noon("2026-09-22");
    expect(jobDay(tomorrow, NOW)).toBe("tomorrow");
    expect(unlocked(tomorrow, NOW)).toBe(false);

    const sixPmToday = sixPm("2026-09-21");
    expect(unlocked(tomorrow, new Date(sixPmToday.getTime() - 1))).toBe(false);
    expect(unlocked(tomorrow, sixPmToday)).toBe(true);
  });

  it("takes the day before from India's calendar, not from UTC's", () => {
    // 01:00 on Tuesday in India is still Monday in UTC. The day before is
    // Monday, so it unlocks at 6 pm on Monday and not at 6 pm on Sunday.
    expect(unlocksAt(new Date("2026-09-21T19:30:00Z"))).toEqual(new Date("2026-09-21T12:30:00Z"));
    // 23:45 on Monday in India is Monday in UTC too, and unlocks on Sunday.
    expect(unlocksAt(new Date("2026-09-21T18:15:00Z"))).toEqual(new Date("2026-09-20T12:30:00Z"));
  });

  it("leaves today's and yesterday's jobs unlocked", () => {
    expect(unlocked(noon("2026-09-21"), NOW)).toBe(true);
    expect(unlocked(noon("2026-09-20"), NOW)).toBe(true);
  });

  it(RULES[2], () => {
    // Board A1's Free on a visit that costs nothing is a badge too (ADR 0025, item 32).
    expect([...PAYMENT_BADGES]).toEqual(["prepaid", "credit", "free"]);
    // Nothing a technician's job can carry is an amount.
    for (const field of visibleFields(noon("2026-09-21"), NOW)) {
      expect(field).not.toMatch(/amount|price|paise|fee/);
    }
  });
});
