// What a technician sees of each job, and when (src/policy/job-visibility.ts). Days are India's: NOW is 12 noon on Monday 21
// September 2026, which is 06:30 UTC.

import { describe, expect, it } from "vitest";
import {
  DAY_BEFORE_REMINDER_HOUR,
  jobDay,
  listableDate,
  namesTheOtherTechnician,
  PAYMENT_BADGES,
  paymentBadge,
  UNLOCK_HOUR,
  unlocked,
  relocksAt,
  unlocksAt,
} from "../../src/policy/job-visibility.ts";

const NOW = new Date("2026-09-21T06:30:00Z");
/** Noon in India on a date. */
const noon = (date: string) => new Date(`${date}T06:30:00Z`);
/** 6 pm in India on a date, the hour a job unlocks at. */
const sixPm = (date: string) => new Date(`${date}T12:30:00Z`);

describe("job visibility", () => {
  it("sorts a job into today, tomorrow or later, by India's date", () => {
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

  it("opens a job's address and client at 6 pm the day before, and not before", () => {
    const wednesday = noon("2026-09-23");
    // It unlocks at 6 pm in India on Tuesday, the day before.
    expect(unlocksAt(wednesday)).toEqual(new Date("2026-09-22T12:30:00Z"));
    expect(unlocked(wednesday, NOW)).toBe(false);

    const tuesday = noon("2026-09-22");
    expect(unlocksAt(tuesday)).toEqual(new Date("2026-09-21T12:30:00Z"));
    expect(unlocked(tuesday, sixPm("2026-09-21"))).toBe(true);
  });

  it("unlocks a job when the day-before WhatsApp tells the client someone is coming", () => {
    expect(UNLOCK_HOUR).toBe(DAY_BEFORE_REMINDER_HOUR);
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

  it("marks what a job was paid with by a badge, and never an amount", () => {
    // Free, on a visit that costs nothing, is a badge too.
    expect([...PAYMENT_BADGES]).toEqual(["prepaid", "credit", "free", "at_visit"]);
    // No answer to a technician carries an amount: test/worker/field-day.test.ts reads the API's own.
  });

  it("badges a visit a credit paid for as Credit, one that costs nothing as Free, and any other as Prepaid", () => {
    expect(paymentBadge({ onCredit: true, free: false, oneVisit: false })).toBe("credit");
    // A credit is named even on a day the visit would have been free.
    expect(paymentBadge({ onCredit: true, free: true, oneVisit: false })).toBe("credit");
    expect(paymentBadge({ onCredit: false, free: true, oneVisit: false })).toBe("free");
    expect(paymentBadge({ onCredit: false, free: false, oneVisit: false })).toBe("prepaid");
    // A consultation and fit in one visit is paid for at it, which no board draws (docs/decisions/0105-a-consultation-and-fit-in-one-visit.md).
    expect(paymentBadge({ onCredit: false, free: false, oneVisit: true })).toBe("at_visit");
  });
});

describe("the other technician", () => {
  it("names the other technician to the phone when ops gave the job to them", () => {
    expect(namesTheOtherTechnician(["technician"])).toBe(true);
    expect(namesTheOtherTechnician(["technician", "time"])).toBe(true);
  });

  it("names nobody for a job that was cancelled, or only moved to another time", () => {
    expect(namesTheOtherTechnician(["status", "technician"])).toBe(false);
    expect(namesTheOtherTechnician(["time"])).toBe(false);
  });
});

describe("a card after its visit", () => {
  it("locks a card again at the end of the day after its visit, and lists no date before yesterday", () => {
    const yesterday = noon("2026-09-20");
    // Locked at midnight in India at the end of the day after the visit: 2026-09-21T18:30Z.
    expect(relocksAt(yesterday)).toEqual(new Date("2026-09-21T18:30:00Z"));
    expect(unlocked(yesterday, new Date("2026-09-21T18:29:59Z"))).toBe(true);
    expect(unlocked(yesterday, new Date("2026-09-21T18:30:00Z"))).toBe(false);
    expect(unlocked(noon("2026-08-21"), NOW)).toBe(false);

    expect(listableDate("2026-09-20", NOW)).toBe(true);
    expect(listableDate("2026-09-19", NOW)).toBe(false);
    expect(listableDate("2026-09-25", NOW)).toBe(true);
  });

  it("is on the past day, not today, once its date has gone", () => {
    expect(jobDay(noon("2026-09-20"), NOW)).toBe("past");
  });
});
