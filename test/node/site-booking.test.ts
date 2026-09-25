// The booking form's helpers.

import { describe, expect, it } from "vitest";
import { attributionFrom } from "../../site/src/lib/attribution.ts";
import { consultationCalendar } from "../../site/src/lib/calendar.ts";

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

describe("the calendar file", () => {
  const now = new Date("2026-09-22T06:00:00Z");

  it("covers the morning window, 09:00 to 12:00 in India, in UTC", () => {
    const text = consultationCalendar("2026-09-24", "before noon", "lead-1", now);
    expect(text).toContain("DTSTART:20260924T033000Z\r\n");
    expect(text).toContain("DTEND:20260924T063000Z\r\n");
    expect(text).toContain("UID:lead-1@maneman.in\r\n");
    expect(text).toContain("DTSTAMP:20260922T060000Z\r\n");
    expect(text.startsWith("BEGIN:VCALENDAR\r\n")).toBe(true);
  });

  it("covers the evening window, 16:00 to 20:00 in India", () => {
    const text = consultationCalendar("2026-09-24", "after four", "lead-1", now);
    expect(text).toContain("DTSTART:20260924T103000Z");
    expect(text).toContain("DTEND:20260924T143000Z");
    expect(text).toContain("SUMMARY:Mane Man consultation (time to be confirmed)");
  });
});
