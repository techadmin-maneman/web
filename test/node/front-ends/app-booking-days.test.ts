// The booking sheet's days (apps/app/src/booking/days.ts): the day chosen when the day offered is full, the start
// chosen in the window offered, later days added to those shown, and what the date and time steps say.

import { describe, expect, it } from "vitest";
import type { Availability } from "../../../apps/app/src/api.ts";
import {
  dayInsideNotice,
  firstOpenFrom,
  hasLaterDays,
  firstOpenIn,
  offeredFullLine,
  stillOpen,
  timeContinue,
  withDays,
  type Day,
} from "../../../apps/app/src/booking/days.ts";

const PRICE = { amount_ex_gst: 200000, amount: 200000, gst_percent: 0 };

/** A start on the day at `time`, India's clock, open or taken. */
const start = (date: string, time: string, open: boolean, charged = false) => ({
  time,
  starts_at: `${date}T${time}:00+05:30`,
  arrives_by: `${date}T${time}:30+05:30`,
  open,
  change_charged: charged,
});

/** A day open at 9 am where `open`, and taken at noon. */
const day = (date: string, open: boolean): Day => ({
  date,
  price: PRICE,
  windows: [
    { window: "morning", start: "09:00", end: "12:00", open, change_charged: false },
    { window: "afternoon", start: "12:00", end: "16:00", open: false, change_charged: false },
  ],
  starts: [start(date, "09:00", open), start(date, "12:00", false)],
});

const availability = (days: Day[], last: string): Availability => ({
  type: "service",
  service: { tier: "standard", name: "Service visit", minutes: 90 },
  price: PRICE,
  change_notice_hours: 24,
  last,
  days,
});

describe("the booking sheet’s days", () => {
  const days = [day("2026-10-05", true), day("2026-10-06", false), day("2026-10-07", false), day("2026-10-08", true)];

  it("chooses the day offered where it is open, else the first open day after it", () => {
    expect(firstOpenFrom(days, "2026-10-05")).toBe("2026-10-05");
    expect(firstOpenFrom(days, "2026-10-06")).toBe("2026-10-08");
  });

  it("chooses nothing where no day from the one offered is open", () => {
    expect(firstOpenFrom(days.slice(0, 3), "2026-10-06")).toBeNull();
  });

  it("offers later days until the last shown is the last that may be booked", () => {
    expect(hasLaterDays(availability(days, "2026-11-05"))).toBe(true);
    expect(hasLaterDays(availability(days, "2026-10-08"))).toBe(false);
  });

  it("adds later days in date order, the fresh copy of a day shown twice replacing the old", () => {
    const fresh = [day("2026-10-08", false), day("2026-10-09", true)];
    const merged = withDays(days, fresh);
    expect(merged.map((each) => each.date)).toEqual([
      "2026-10-05",
      "2026-10-06",
      "2026-10-07",
      "2026-10-08",
      "2026-10-09",
    ]);
    expect(merged[3]?.starts[0]?.open).toBe(false);
  });

  it("opens on the first open start in the window offered, and keeps a start picked only while it stays open", () => {
    const open = day("2026-10-05", true);
    expect(firstOpenIn(open, "morning")).toBe("2026-10-05T09:00:00+05:30");
    expect(firstOpenIn(open, "afternoon")).toBeNull();
    expect(firstOpenIn(open, null)).toBeNull();
    expect(stillOpen(open, "2026-10-05T09:00:00+05:30")).toBe("2026-10-05T09:00:00+05:30");
    expect(stillOpen(day("2026-10-05", false), "2026-10-05T09:00:00+05:30")).toBeNull();
  });
});

describe("what the date step says of a full day offered", () => {
  const days = [day("2026-10-06", false), day("2026-10-07", true)];

  it("that it is full, and the next open day is chosen", () => {
    expect(offeredFullLine(days, "2026-10-06", "2026-10-07")).toBe(
      "Tuesday 6 October is full. We’ve picked the next open day.",
    );
  });

  it("to pick another day where none after it is open", () => {
    expect(offeredFullLine(days.slice(0, 1), "2026-10-06", null)).toBe("Tuesday 6 October is full. Pick another day.");
  });

  it("nothing once the client has chosen some other day, or where the day offered is open", () => {
    expect(offeredFullLine([...days, day("2026-10-08", true)], "2026-10-06", "2026-10-08")).toBeNull();
    expect(offeredFullLine(days, "2026-10-07", "2026-10-07")).toBeNull();
  });
});

describe("the days the date step marks inside the notice", () => {
  const withNine = (isOpen: boolean, charged: boolean): Day => ({
    ...day("2026-10-03", true),
    starts: [start("2026-10-03", "09:00", isOpen, charged)],
  });

  it("marks a day with an open start that is already charged to change", () => {
    expect(dayInsideNotice(withNine(true, true))).toBe(true);
    expect(dayInsideNotice(withNine(true, false))).toBe(false);
  });

  it("leaves a taken start out of the mark, since it cannot be booked", () => {
    expect(dayInsideNotice(withNine(false, true))).toBe(false);
  });
});

describe("the time step’s button", () => {
  it("goes on to payment for a day with a price", () => {
    expect(timeContinue(day("2026-10-05", true))).toBe("Continue to payment");
  });

  it("only goes on for a day that costs nothing, as a consultation does", () => {
    const free = { amount_ex_gst: 0, amount: 0, gst_percent: 0 };
    expect(timeContinue({ ...day("2026-10-05", true), price: free })).toBe("Continue");
  });
});
