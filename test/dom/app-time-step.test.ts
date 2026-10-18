// The booking sheet's time step (apps/app/src/booking/steps/TimeStep.tsx; docs/decisions/0210-booking-by-start-time.md):
// the day's starts under its morning, afternoon and evening, a taken one struck through and not to be chosen, a part
// of the day with none left saying so, and the time chosen saying when the technician arrives by.

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { lengthWords, TimeStep } from "../../apps/app/src/booking/steps/TimeStep.tsx";
import type { Day } from "../../apps/app/src/booking/days.ts";
import { booking } from "../../apps/app/src/content.ts";

const PRICE = { amount_ex_gst: 200000, amount: 200000, gst_percent: 0 };

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

let page: HTMLDivElement;
let root: Root;
let chosen: string[];

const step = (picked: string | null) =>
  createElement(TimeStep, {
    before: 0,
    day: DAY,
    minutes: 90,
    noticeHours: 24,
    chosen: picked,
    busy: false,
    problem: null,
    onChoose: (startsAt: string) => {
      chosen.push(startsAt);
    },
    onNext: () => undefined,
  });

beforeEach(() => {
  chosen = [];
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

describe("the day's times", () => {
  it("sit under the parts of the day, a taken one not to be chosen, an empty part saying so", () => {
    act(() => {
      root.render(step(null));
    });
    const labels = [...page.querySelectorAll("label")];
    expect(labels.map((label) => label.textContent)).toEqual(["9 am, taken", "11:30 am", "12 pm, taken", "4 pm"]);
    expect(labels.map((label) => label.querySelector("input")?.disabled)).toEqual([true, false, true, false]);
    expect(page.textContent).toContain(booking.window.fullyBooked);
    expect(page.textContent).toContain("Takes about 1½ hours");
  });

  it("send the start chosen, and say when the technician arrives by", () => {
    act(() => {
      root.render(step(null));
    });
    act(() => {
      page.querySelectorAll("input")[1]?.click();
    });
    expect(chosen).toEqual([DAY.starts[1]?.starts_at]);
    const markup = renderToStaticMarkup(step(DAY.starts[1]?.starts_at ?? null));
    expect(markup).toContain("Arrives between 11:30 am and 12 pm");
  });

  it("mark a time already inside the notice", () => {
    const markup = renderToStaticMarkup(step(DAY.starts[3]?.starts_at ?? null));
    expect(markup).toContain(booking.window.within(24));
  });
});

describe("a visit's length", () => {
  it("reads to the quarter hour", () => {
    expect([45, 60, 90, 135, 180].map(lengthWords)).toEqual([
      "45 minutes",
      "an hour",
      "1½ hours",
      "2¼ hours",
      "3 hours",
    ]);
  });
});
