// The booking form's helpers.

import { describe, expect, it } from "vitest";
import { addressToSend, emptyAddress, missingParts } from "../../site/src/lib/address.ts";
import { attributionFrom } from "../../site/src/lib/attribution.ts";
import { consultationCalendar } from "../../site/src/lib/calendar.ts";
import { keyPerRequest } from "../../site/src/lib/idempotency.ts";
import { anyOpen, chosenSlot, dayOpen, isOpen, type OpenDays } from "../../site/src/lib/open-windows.ts";

// FEO-21: a key that changed on every press protected nothing.
describe("idempotency keys", () => {
  it("are the same for the same request pressed again, and new once anything in it changes", () => {
    const keyFor = keyPerRequest();
    const first = keyFor({ name: "Test Friend", window: "morning" });
    expect(keyFor({ name: "Test Friend", window: "morning" })).toBe(first);
    const moved = keyFor({ name: "Test Friend", window: "evening" });
    expect(moved).not.toBe(first);
    expect(keyFor({ name: "Test Friend", window: "morning" })).not.toBe(moved);
    expect(keyPerRequest()({ name: "Test Friend", window: "morning" })).not.toBe(first);
  });
});

describe("attribution", () => {
  it("keeps the campaign tags, the landing path and another site as the referrer", () => {
    const url = new URL("https://maneman.in/book?utm_source=google&utm_medium=cpc&gclid=abc&name=Arjun&x=1");
    expect(attributionFrom(url, "https://www.google.com/search?q=hair+system")).toEqual({
      landing_path: "/book",
      utm_source: "google",
      utm_medium: "cpc",
      gclid: "abc",
      referrer: "https://www.google.com/search",
    });
  });

  it("drops the site's own pages as referrers, and anything not a campaign tag", () => {
    const url = new URL("https://maneman.in/?mobile=9810000000");
    expect(attributionFrom(url, "https://maneman.in/try")).toEqual({ landing_path: "/" });
  });

  it("caps each value at the API's limits", () => {
    const url = new URL(`https://maneman.in/?utm_source=${"a".repeat(300)}`);
    expect(attributionFrom(url, "").utm_source).toHaveLength(200);
  });
});

// CLI-13, REQ-05: the calendar file follows the windows the booking offers (src/config/scheduling.ts).
describe("the calendar file", () => {
  const now = new Date("2026-09-22T06:00:00Z");

  it("covers the morning window, 09:00 to 12:00 in India, in UTC", () => {
    const text = consultationCalendar("2026-09-24", "morning", "Mane Man consultation", now);
    expect(text).toContain("DTSTART:20260924T033000Z\r\n");
    expect(text).toContain("DTEND:20260924T063000Z\r\n");
    expect(text).toContain("UID:consultation-2026-09-24-morning@maneman.in\r\n");
    expect(text).toContain("DTSTAMP:20260922T060000Z\r\n");
    expect(text).toContain("SUMMARY:Mane Man consultation\r\n");
    expect(text.startsWith("BEGIN:VCALENDAR\r\n")).toBe(true);
  });

  it("covers the afternoon, 12:00 to 16:00, and the evening, 16:00 to 20:00, in India", () => {
    const afternoon = consultationCalendar("2026-09-24", "afternoon", "Mane Man consultation", now);
    expect(afternoon).toContain("DTSTART:20260924T063000Z");
    expect(afternoon).toContain("DTEND:20260924T103000Z");
    const evening = consultationCalendar("2026-09-24", "evening", "Mane Man consultation", now);
    expect(evening).toContain("DTSTART:20260924T103000Z");
    expect(evening).toContain("DTEND:20260924T143000Z");
  });
});

// The owner's ruling of 27 September 2026: the full address before a slot is confirmed, on the site too (ADR 0081).
describe("the address a consultation is at", () => {
  it("starts in the city of the pincode checked, and asks for the flat, the building or street and the area", () => {
    expect(missingParts(emptyAddress("Gurgaon"))).toEqual(["flat", "line1", "locality"]);
    expect(missingParts(emptyAddress(null))).toEqual(["flat", "line1", "locality", "city"]);
  });

  it("counts a part filled with spaces as left out", () => {
    const typed = { ...emptyAddress("Gurgaon"), flat: " ", line1: "  ", locality: "Sector 65", city: " " };
    expect(missingParts(typed)).toEqual(["flat", "line1", "city"]);
  });

  it("is sent trimmed, in the pincode checked, with a part left blank as none", () => {
    const typed = {
      ...emptyAddress("Gurgaon"),
      flat: " Flat 402 ",
      line1: "Palm Grove Society ",
      locality: "Sector 65",
      accessNotes: "  ",
    };
    expect(addressToSend(typed, "122018")).toEqual({
      flat: "Flat 402",
      floor: null,
      tower: null,
      line1: "Palm Grove Society",
      line2: null,
      landmark: null,
      locality: "Sector 65",
      city: "Gurgaon",
      pincode: "122018",
      access_notes: null,
    });
  });
});

// BK-26: every day and window was drawn open, so a full one failed only after the whole form was filled in.
describe("the days and windows open", () => {
  const OPEN = { morning: true, afternoon: true, evening: true };
  const SHUT = { morning: false, afternoon: false, evening: false };
  const days: OpenDays = [
    { date: "2026-10-03", windows: SHUT },
    { date: "2026-10-04", windows: { morning: false, afternoon: true, evening: true } },
    { date: "2026-10-05", windows: OPEN },
  ];
  const ALL = ["morning", "afternoon", "evening"] as const;
  const ONE_VISIT = ["morning", "afternoon"] as const;

  it("draws everything open until the answer comes, and nothing on a day it does not list", () => {
    expect(isOpen(null, "2026-10-03", "morning")).toBe(true);
    expect(anyOpen(null, ALL)).toBe(true);
    expect(isOpen(days, "2026-10-04", "morning")).toBe(false);
    expect(isOpen(days, "2026-10-04", "evening")).toBe(true);
    expect(isOpen(days, "2026-10-20", "evening")).toBe(false);
  });

  it("closes a day with none of the plan's windows open", () => {
    expect(dayOpen(days, "2026-10-03", ALL)).toBe(false);
    expect(dayOpen(days, "2026-10-04", ALL)).toBe(true);
    const eveningsOnly: OpenDays = [
      { date: "2026-10-04", windows: { morning: false, afternoon: false, evening: true } },
    ];
    expect(dayOpen(eveningsOnly, "2026-10-04", ONE_VISIT)).toBe(false);
    expect(anyOpen(eveningsOnly, ONE_VISIT)).toBe(false);
  });

  it("keeps the visitor's pick while it is open", () => {
    const picked = { date: "2026-10-04", window: "evening" } as const;
    expect(chosenSlot(days, ALL, picked)).toEqual(picked);
    expect(chosenSlot(null, ALL, picked)).toEqual(picked);
  });

  it("moves a full pick to the day's first open window, else to the first day with one", () => {
    expect(chosenSlot(days, ALL, { date: "2026-10-04", window: "morning" })).toEqual({
      date: "2026-10-04",
      window: "afternoon",
    });
    // The form's first pick, tomorrow morning, on a day booked full.
    expect(chosenSlot(days, ALL, { date: "2026-10-03", window: "morning" })).toEqual({
      date: "2026-10-04",
      window: "afternoon",
    });
  });

  it("moves an evening pick to a window one visit can start in, before the answer and after it", () => {
    expect(chosenSlot(null, ONE_VISIT, { date: "2026-10-05", window: "evening" })).toEqual({
      date: "2026-10-05",
      window: "morning",
    });
    expect(chosenSlot(days, ONE_VISIT, { date: "2026-10-04", window: "evening" })).toEqual({
      date: "2026-10-04",
      window: "afternoon",
    });
  });

  it("leaves the pick where nothing is open at all", () => {
    const full: OpenDays = [{ date: "2026-10-03", windows: SHUT }];
    expect(chosenSlot(full, ALL, { date: "2026-10-03", window: "morning" })).toEqual({
      date: "2026-10-03",
      window: "morning",
    });
  });
});
