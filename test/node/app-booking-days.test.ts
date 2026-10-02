// The booking sheet's days (apps/app/src/booking/days.ts): the day chosen when the day offered is full, later days
// added to those shown, and what the date and window steps say.

import { describe, expect, it } from "vitest";
import type { Availability } from "../../apps/app/src/api.ts";
import {
  dayAfter,
  dayInsideNotice,
  firstOpenFrom,
  hasLaterDays,
  offeredFullLine,
  windowContinue,
  windowNote,
  withDays,
  type Day,
} from "../../apps/app/src/booking/days.ts";

const PRICE = { amount_ex_gst: 200000, amount: 200000, gst_percent: 0 };

const day = (date: string, open: boolean): Day => ({
  date,
  price: PRICE,
  windows: [
    { window: "morning", start: "09:00", end: "12:00", with: open ? "another" : null, change_charged: false },
    { window: "afternoon", start: "12:00", end: "16:00", with: null, change_charged: false },
  ],
});

const availability = (days: Day[], last: string): Availability => ({
  type: "service",
  service: { tier: "standard", name: "Service visit", minutes: 90 },
  price: PRICE,
  regular: null,
  change_notice_hours: 24,
  last,
  days,
});

describe("the booking sheet's days", () => {
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

  it("asks for later days from the day after the last shown, across a month's end", () => {
    expect(dayAfter("2026-10-31")).toBe("2026-11-01");
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
    expect(merged[3]?.windows[0]?.with).toBeNull();
  });
});

describe("what the date step says of a full day offered", () => {
  const days = [day("2026-10-06", false), day("2026-10-07", true)];

  it("that it is full, and the next open day is chosen", () => {
    expect(offeredFullLine(days, "2026-10-06", "2026-10-07")).toBe(
      "Tuesday 6 Oct is full. We have picked the next open day.",
    );
  });

  it("to pick another day where none after it is open", () => {
    expect(offeredFullLine(days.slice(0, 1), "2026-10-06", null)).toBe("Tuesday 6 Oct is full. Pick another day.");
  });

  it("nothing once the client has chosen some other day, or where the day offered is open", () => {
    expect(offeredFullLine([...days, day("2026-10-08", true)], "2026-10-06", "2026-10-08")).toBeNull();
    expect(offeredFullLine(days, "2026-10-07", "2026-10-07")).toBeNull();
  });
});

describe("the days the date step marks inside the notice", () => {
  const withMorning = (who: "another" | null, charged: boolean): Day => {
    const open = day("2026-10-03", true);
    const morning = { window: "morning" as const, start: "09:00", end: "12:00", with: who, change_charged: charged };
    return { ...open, windows: [morning] };
  };

  it("marks a day with an open window that is already charged to change (MON-08, BK-11)", () => {
    expect(dayInsideNotice(withMorning("another", true))).toBe(true);
    expect(dayInsideNotice(withMorning("another", false))).toBe(false);
  });

  it("leaves a full window out of the mark, since it cannot be booked", () => {
    expect(dayInsideNotice(withMorning(null, true))).toBe(false);
  });
});

describe("the window step's button (MON-33, UX-06, CP-05)", () => {
  it("goes on to payment for a day with a price", () => {
    expect(windowContinue(day("2026-10-05", true))).toBe("Continue to payment");
  });

  it("only goes on for a day that costs nothing, as a consultation does", () => {
    const free = { amount_ex_gst: 0, amount: 0, gst_percent: 0 };
    expect(windowContinue({ ...day("2026-10-05", true), price: free })).toBe("Continue");
  });
});

describe("what a window says of who would come", () => {
  it("names the regular technician, and says another where he is busy", () => {
    expect(windowNote("regular", "Imran")).toBe("With Imran");
    expect(windowNote("another", "Imran")).toBe("Another technician");
  });

  it("says nothing of who to a client who has no regular technician", () => {
    expect(windowNote("another", null)).toBeNull();
  });

  it("says a window is full", () => {
    expect(windowNote(null, null)).toBe("Full");
  });
});
