// The booking form's helpers.

import { describe, expect, it } from "vitest";
import { stepOf } from "../../site/src/islands/invite/step.ts";
import {
  addressToSend,
  emptyAddress,
  missingParts,
  partsToMark,
  REQUIRED_API_FIELDS,
} from "../../site/src/lib/address.ts";
import { signInLink } from "../../site/src/lib/app-link.ts";
import { attributionFrom } from "../../site/src/lib/attribution.ts";
import { dayStrip, stripMonths } from "../../site/src/lib/dates.ts";
import { keyPerRequest } from "../../site/src/lib/idempotency.ts";
import { anyOpen, chosenSlot, dayOpen, isOpen, type OpenDays } from "../../site/src/lib/open-windows.ts";

// A key that changed on every press protected nothing.
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

// The confirmation opens the app with the number typed filled in.
describe("the link into the client app", () => {
  const APP = "https://app-staging.maneman.in";

  it("puts the number typed after the #, as ten digits however it was typed", () => {
    expect(signInLink(APP, "98100 00000")).toBe(`${APP}/#mobile=9810000000`);
    expect(signInLink(APP, "+91 98100-00000")).toBe(`${APP}/#mobile=9810000000`);
  });

  it("opens the plain sign-in for anything that is not a mobile number", () => {
    expect(signInLink(APP, "12345")).toBe(APP);
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

  // A refusal naming an address part was said by the button, with nothing marked.
  it("marks the parts left out once the form is checked, and the parts the API refused by its names", () => {
    const typed = { ...emptyAddress("Gurgaon"), flat: "Flat 402" };
    expect(partsToMark(typed, false, [])).toEqual([]);
    expect(partsToMark(typed, true, [])).toEqual(["line1", "locality"]);
    expect(partsToMark(typed, false, ["address.flat", "mobile", "address.pincode"])).toEqual(["flat"]);
    expect(REQUIRED_API_FIELDS).toEqual(["address.flat", "address.line1", "address.locality", "address.city"]);
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

// The strip read "Sat 3 … Fri 16" with no month, to the eye and to a screen reader.
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

// Back left the page and lost the form; each step is now an entry in the history.
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

// Every day and window was drawn open, so a full one failed only after the whole form was filled in.
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
