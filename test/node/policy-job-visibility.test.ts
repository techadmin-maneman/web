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
    // It unlocks at midnight in India at the start of Tuesday, the day before.
    expect(unlocksAt(wednesday)).toEqual(new Date("2026-09-21T18:30:00Z"));
    expect(unlocked(wednesday, NOW)).toBe(false);
    expect(visibleFields(wednesday, NOW)).toEqual([...OUTLINE_FIELDS]);

    const tuesday = noon("2026-09-22");
    expect(unlocked(tuesday, NOW)).toBe(true);
    expect(visibleFields(tuesday, NOW)).toContain("access_notes");
  });

  it("leaves today's and yesterday's jobs unlocked", () => {
    expect(unlocked(noon("2026-09-21"), NOW)).toBe(true);
    expect(unlocked(noon("2026-09-20"), NOW)).toBe(true);
  });

  it(RULES[2], () => {
    expect([...PAYMENT_BADGES]).toEqual(["prepaid", "credit"]);
    // Nothing a technician's job can carry is an amount.
    for (const field of visibleFields(noon("2026-09-21"), NOW)) {
      expect(field).not.toMatch(/amount|price|paise|fee/);
    }
  });
});
