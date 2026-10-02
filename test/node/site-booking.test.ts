// The booking form's helpers.

import { describe, expect, it } from "vitest";
import { stepOf } from "../../site/src/islands/invite/step.ts";
import { addressLine, addressToSend, emptyAddress, missingParts } from "../../site/src/lib/address.ts";
import { attributionFrom } from "../../site/src/lib/attribution.ts";
import { consultationCalendar } from "../../site/src/lib/calendar.ts";
import { dayStrip, stripMonths } from "../../site/src/lib/dates.ts";
import { keyPerRequest } from "../../site/src/lib/idempotency.ts";
import { anyOpen, chosenSlot, dayOpen, isOpen, type OpenDays } from "../../site/src/lib/open-windows.ts";
import { placeOf } from "../../site/src/lib/place.ts";

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
  const DETAILS = { location: null, description: "Your technician comes to you." };

  it("covers the morning window, 09:00 to 12:00 in India, in UTC", () => {
    const text = consultationCalendar("2026-09-24", "morning", "Mane Man consultation", now, DETAILS);
    expect(text).toContain("DTSTART:20260924T033000Z\r\n");
    expect(text).toContain("DTEND:20260924T063000Z\r\n");
    expect(text).toContain("UID:consultation-2026-09-24-morning@maneman.in\r\n");
    expect(text).toContain("DTSTAMP:20260922T060000Z\r\n");
    expect(text).toContain("SUMMARY:Mane Man consultation\r\n");
    expect(text.startsWith("BEGIN:VCALENDAR\r\n")).toBe(true);
  });

  it("covers the afternoon, 12:00 to 16:00, and the evening, 16:00 to 20:00, in India", () => {
    const afternoon = consultationCalendar("2026-09-24", "afternoon", "Mane Man consultation", now, DETAILS);
    expect(afternoon).toContain("DTSTART:20260924T063000Z");
    expect(afternoon).toContain("DTEND:20260924T103000Z");
    const evening = consultationCalendar("2026-09-24", "evening", "Mane Man consultation", now, DETAILS);
    expect(evening).toContain("DTSTART:20260924T103000Z");
    expect(evening).toContain("DTEND:20260924T143000Z");
  });

  // CP-21: the event had no place and no word of what it is.
  it("says where the visit is and what it is, escaped as a calendar file needs", () => {
    const text = consultationCalendar("2026-09-24", "morning", "Mane Man consultation", now, {
      location: "Flat 402, Palm Grove Society; Gate 2, Sector 65, Gurgaon 122018",
      description: "Your technician comes to you. Manage it in the Mane Man app: https://app.maneman.in",
    });
    const unfolded = text.replaceAll("\r\n ", "");
    expect(unfolded).toContain("LOCATION:Flat 402\\, Palm Grove Society\\; Gate 2\\, Sector 65\\, Gurgaon 122018\r\n");
    expect(unfolded).toContain(
      "DESCRIPTION:Your technician comes to you. Manage it in the Mane Man app: https://app.maneman.in\r\n",
    );
    for (const line of text.split("\r\n")) expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
  });

  it("gives no place for a visit that goes to the address on the account", () => {
    const text = consultationCalendar("2026-09-24", "morning", "Mane Man consultation", now, DETAILS);
    expect(text).not.toContain("LOCATION:");
    expect(text).toContain("DESCRIPTION:Your technician comes to you.\r\n");
  });
});

// CP-21: the confirmation read "Noida, Noida 201301", and the pincode's area where the visitor had typed their own.
describe("the place a confirmation names", () => {
  const answer = { pincode: "201301", served: true, area: "Noida", city: "Noida" };

  it("never says the city twice", () => {
    expect(placeOf(answer)).toBe("Noida 201301");
    expect(placeOf({ ...answer, area: "noida" })).toBe("noida 201301");
  });

  it("names the sector or area typed, and the city typed, before the pincode's", () => {
    expect(placeOf(answer, { locality: " Sector 62 ", city: "Noida" })).toBe("Sector 62, Noida 201301");
    expect(placeOf({ ...answer, area: "Sector 65", city: "Gurgaon" }, { locality: "", city: "Gurugram" })).toBe(
      "Sector 65, Gurugram 201301",
    );
  });

  it("falls back to whatever the pincode's answer knows", () => {
    expect(placeOf({ ...answer, area: "Sector 65", city: null })).toBe("Sector 65 201301");
    expect(placeOf({ ...answer, area: null, city: "Noida" })).toBe("Noida 201301");
    expect(placeOf({ ...answer, area: null, city: null })).toBe("201301");
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

  it("is one line for the calendar: what a map can find, without the floor, landmark or notes", () => {
    const typed = {
      ...emptyAddress("Gurgaon"),
      flat: "Flat 402",
      floor: "4",
      tower: " Tower C ",
      line1: "Palm Grove Society",
      landmark: "Opposite the park",
      locality: "Sector 65",
      accessNotes: "Gate 2",
    };
    expect(addressLine(typed, "122018")).toBe("Flat 402, Tower C, Palm Grove Society, Sector 65, Gurgaon 122018");
  });
});

// BK-60, UX-33: the strip read "Sat 3 … Fri 16" with no month, to the eye and to a screen reader.
describe("the date strip", () => {
  it("reads each day out in full, with its month", () => {
    const [first] = dayStrip("2026-10-03", 14);
    expect(first).toMatchObject({ weekday: "Sat", number: "3", month: "October", label: "Saturday 3 October" });
  });

  it("names the month above it, or both months where it crosses a month's end", () => {
    expect(stripMonths(dayStrip("2026-10-03", 14))).toBe("October");
    const crossing = dayStrip("2026-10-24", 14);
    expect(crossing.map((day) => day.label).slice(7, 9)).toEqual(["Saturday 31 October", "Sunday 1 November"]);
    expect(stripMonths(crossing)).toBe("October – November");
  });
});

// BK-60, UX-38: Back left the page and lost the form; each step is now an entry in the history.
describe("the page's steps in the browser's history", () => {
  const answer = { pincode: "122018", served: true, area: "Sector 65", city: "Gurgaon" };

  it("reads back the step and the pincode's answer the page wrote", () => {
    expect(stepOf({ step: "form", answer })).toEqual({ step: "form", answer });
    expect(stepOf({ step: "done", answer })).toEqual({ step: "done", answer });
  });

  it("reads anything else as the pincode field", () => {
    for (const state of [null, undefined, "form", { step: "form" }, { step: "elsewhere", answer }, { answer }]) {
      expect(stepOf(state)).toEqual({ step: "pincode", answer: null });
    }
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
