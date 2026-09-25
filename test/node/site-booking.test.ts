// The booking form's helpers.

import { describe, expect, it } from "vitest";
import { attributionFrom } from "../../site/src/lib/attribution.ts";
import { consultationCalendar } from "../../site/src/lib/calendar.ts";
import { keyPerRequest } from "../../site/src/lib/idempotency.ts";

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
