// The booking sheet's day and time (apps/app/src/booking/steps/WhenStep.tsx; docs/decisions/0210-booking-by-start-time.md):
// the earliest open time to take at a tap, each day with how many times are left, the day's starts under its morning,
// afternoon and evening with how many are open, a taken one struck through and not to be chosen, and the time chosen
// saying when the technician arrives.

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WhenStep } from "../../apps/app/src/booking/steps/WhenStep.tsx";
import { lengthWords } from "@maneman/web-kit/visit-length";
import { shortDate } from "@maneman/web-kit/dates";
import type { Availability } from "../../apps/app/src/api.ts";
import type { Day } from "../../apps/app/src/booking/days.ts";
import { arrivalHours, booking } from "../../apps/app/src/content.ts";

const PRICE = { amount_ex_gst: 200000, amount: 200000, gst_percent: 0 };
const copy = booking.when;

/** A start on Tuesday 22 September at `time`, India's clock. */
const start = (time: string, open: boolean, charged = false) => {
  const startsAt = new Date(`2026-09-22T${time}:00+05:30`);
  return {
    time,
    starts_at: startsAt.toISOString(),
    arrives_by: new Date(startsAt.getTime() + 30 * 60_000).toISOString(),
    open,
    change_charged: charged,
  };
};

const DAY: Day = {
  date: "2026-09-22",
  price: PRICE,
  windows: [
    { window: "morning", start: "09:00", end: "12:00", open: true, change_charged: false },
    { window: "afternoon", start: "12:00", end: "16:00", open: false, change_charged: false },
    { window: "evening", start: "16:00", end: "20:00", open: true, change_charged: false },
  ],
  starts: [start("09:00", false), start("11:30", true), start("12:00", false), start("16:00", true, true)],
};

/** The next day, every start taken. */
const FULL: Day = { ...DAY, date: "2026-09-23", starts: DAY.starts.map((each) => ({ ...each, open: false })) };

const AVAILABILITY: Availability = {
  type: "service",
  service: { tier: "standard", name: "Service visit", minutes: 90 },
  price: PRICE,
  change_notice_hours: 24,
  opens: DAY.date,
  last: FULL.date,
  days: [DAY, FULL],
};

let page: HTMLDivElement;
let root: Root;
let chosen: string[];
let earliest: string[];

const step = (picked: string | null) =>
  createElement(WhenStep, {
    title: copy.title,
    step: { at: 1, of: 2 },
    onBack: undefined,
    onClose: () => undefined,
    availability: AVAILABILITY,
    moveNotice: null,
    offered: null,
    date: DAY.date,
    chosenStart: picked,
    later: null,
    busy: false,
    problem: null,
    onChooseDate: () => undefined,
    onChooseStart: (startsAt: string) => {
      chosen.push(startsAt);
    },
    onEarliest: (date: string, startsAt: string) => {
      earliest.push(`${date} ${startsAt}`);
    },
    onNext: () => undefined,
  });

beforeEach(() => {
  Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
  chosen = [];
  earliest = [];
  page = document.createElement("div");
  document.body.append(page);
  root = createRoot(page);
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  page.remove();
});

/** The day's times, as their labels read. */
const times = () => [...page.querySelectorAll('input[name="booking-time"]')].map((input) => input.closest("label"));

describe("the day and time", () => {
  it("offers the earliest open time at a tap", () => {
    act(() => {
      root.render(step(null));
    });
    const row = [...page.querySelectorAll("button")].find((button) =>
      button.textContent.includes(copy.earliest(shortDate(DAY.date), "11:30 am")),
    );
    expect(row?.textContent).toContain(copy.tapToChoose);
    act(() => {
      row?.click();
    });
    expect(earliest).toEqual([`${DAY.date} ${DAY.starts[1]?.starts_at ?? ""}`]);
  });

  it("says how many times each day has left, a full one not to be chosen", () => {
    act(() => {
      root.render(step(null));
    });
    const days = [...page.querySelectorAll<HTMLInputElement>('input[name="booking-date"]')];
    expect(days.map((day) => day.closest("label")?.textContent)).toEqual(["Tue22" + copy.left(2), "Wed23" + copy.full]);
    expect(days.map((day) => day.disabled)).toEqual([false, true]);
  });

  it("sits the times under the parts of the day, with how many are open, a taken one not to be chosen", () => {
    act(() => {
      root.render(step(null));
    });
    expect(times().map((label) => label?.textContent)).toEqual(["9 am, taken", "11:30 am", "12 pm, taken", "4 pm"]);
    expect(times().map((label) => label?.querySelector("input")?.disabled)).toEqual([true, false, true, false]);
    expect(page.textContent).toContain(`Morning${copy.open(1)}`);
    expect(page.textContent).toContain(`Afternoon${copy.fullyBooked}`);
    expect(page.textContent).toContain(copy.arrival(30));
  });

  it("sends the start chosen, and says the day and when the technician arrives above Continue", () => {
    act(() => {
      root.render(step(null));
    });
    act(() => {
      times()[1]?.querySelector("input")?.click();
    });
    expect(chosen).toEqual([DAY.starts[1]?.starts_at]);
    const picked = DAY.starts[1];
    if (picked === undefined) throw new Error("no start");
    const markup = renderToStaticMarkup(step(picked.starts_at));
    expect(markup).toContain(copy.summary(shortDate(DAY.date), arrivalHours(picked)));
  });

  it("marks a time already inside the notice", () => {
    const markup = renderToStaticMarkup(step(DAY.starts[3]?.starts_at ?? null));
    expect(markup).toContain(copy.within(24));
  });
});

// The sheet said "1½ hours" where the card said "1 hour 30 minutes" and the site "90 minutes".
describe("a visit's length", () => {
  it("reads as the site says it", () => {
    expect([45, 60, 90, 135, 180].map(lengthWords)).toEqual([
      "45 minutes",
      "60 minutes",
      "90 minutes",
      "2 hours 15 minutes",
      "3 hours",
    ]);
  });
});
