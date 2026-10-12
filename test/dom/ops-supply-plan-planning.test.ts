// Beneath the Supply plan in the console (apps/ops/src/supply-plan/Planning.tsx; docs/decisions/0182-the-events-calendar.md):
// the forecast one city at a time, and the events calendar, an event added and one taken off. Every name is made up.

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Planning } from "../../apps/ops/src/supply-plan/Planning.tsx";
import { supplyPlan as copy } from "../../apps/ops/src/content/supply-plan.ts";

const WEDDINGS = {
  id: "ev-1",
  name: "Wedding season",
  city: "Gurgaon",
  starts_on: "2026-11-01",
  ends_on: "2026-11-30",
  uplift_percent: 25,
};
const CALENDAR = { events: [WEDDINGS], cities: ["Gurgaon", "Delhi"] };
const RUN = { run_on: "2026-09-21", period_days: 7, horizon_periods: 2, due_rate: 0.8, fit_rate: 0.5 };
const line = (city: string, period: number, expected: number, high: number) => ({
  consumable_code: "solvent",
  name: "Solvent",
  city,
  period,
  booked: expected,
  due: 0,
  pipeline: 0,
  baseline: 0,
  expected,
  high,
});

let page: HTMLDivElement;
let root: Root;
let posted: { path: string; body: unknown }[];
let asked: string[];
let next: unknown;

const button = (text: string) => [...page.querySelectorAll("button")].find((each) => each.textContent.trim() === text);

async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function type(input: HTMLInputElement | HTMLSelectElement | null | undefined, value: string) {
  act(() => {
    if (input === null || input === undefined) return;
    const prototype = input instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, "value")?.set?.call(input, value);
    input.dispatchEvent(new Event(input instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }));
  });
}

const box = (label: string) => {
  const id = [...page.querySelectorAll("label")].find((each) => each.textContent.trim() === label)?.htmlFor ?? "";
  return page.querySelector<HTMLInputElement>(`[id="${id}"]`);
};

beforeEach(() => {
  posted = [];
  asked = [];
  next = CALENDAR;
  vi.stubGlobal("fetch", (url: string, init?: RequestInit) => {
    const address = new URL(url, "https://ops.maneman.test");
    if (init?.method === "POST") {
      posted.push({ path: address.pathname, body: typeof init.body === "string" ? JSON.parse(init.body) : null });
      return Promise.resolve(
        Response.json(next, { status: typeof next === "object" && next !== null && "error" in next ? 400 : 200 }),
      );
    }
    if (address.pathname === "/api/demand-events") return Promise.resolve(Response.json(CALENDAR));
    if (address.pathname === "/api/stock/forecast") {
      const city = address.searchParams.get("city") ?? "";
      asked.push(city);
      const lines = city === "Gurgaon" ? [line(city, 0, 12, 15), line(city, 1, 4.25, 4.25)] : [];
      return Promise.resolve(Response.json({ run: RUN, lines }));
    }
    return Promise.resolve(Response.json({ error: { code: "unavailable", request_id: "r-1" } }, { status: 503 }));
  });
  page = document.createElement("div");
  document.body.append(page);
  root = createRoot(page);
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  page.remove();
  vi.unstubAllGlobals();
});

async function show() {
  act(() => {
    root.render(createElement(Planning));
  });
  await settle();
  await settle();
}

describe("the forecast and the events calendar", () => {
  it("shows the first city's forecast with each high case, and another city's when picked", async () => {
    await show();
    expect(asked).toEqual(["Gurgaon"]);
    const forecast = page.querySelector('section[aria-labelledby="plan-forecast"]');
    expect(forecast?.textContent).toContain("Solvent");
    expect(forecast?.textContent).toContain(copy.forecast.high("15"));
    expect(forecast?.textContent).toContain("4.3");
    type(page.querySelector("select"), "Delhi");
    await settle();
    expect(asked).toEqual(["Gurgaon", "Delhi"]);
    expect(page.textContent).toContain(copy.forecast.empty("Delhi"));
  });

  it("adds an event, refuses one that ends first, and takes one off", async () => {
    await show();
    expect(page.textContent).toContain("Wedding season");
    expect(page.textContent).toContain(copy.events.change(25));
    type(box(copy.events.name), "Diwali");
    type(box(copy.events.startsOn), "2026-11-08");
    type(box(copy.events.endsOn), "2026-11-12");
    type(box(copy.events.percent), "-10");
    next = { error: { code: "invalid_request", fields: ["ends_on"], request_id: "r-2" } };
    await act(async () => {
      button(copy.events.save)?.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(page.textContent).toContain(copy.events.errors.ends_on);

    const diwali = { ...WEDDINGS, id: "ev-2", name: "Diwali", city: null, uplift_percent: -10 };
    next = { ...CALENDAR, events: [WEDDINGS, diwali] };
    await act(async () => {
      button(copy.events.save)?.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(posted[1]).toEqual({
      path: "/api/demand-events",
      body: { name: "Diwali", city: null, starts_on: "2026-11-08", ends_on: "2026-11-12", uplift_percent: -10 },
    });
    expect(page.textContent).toContain(copy.events.added);
    expect(page.textContent).toContain(copy.events.change(-10));

    next = { ...CALENDAR, events: [diwali] };
    await act(async () => {
      page.querySelector<HTMLButtonElement>(`button[aria-label="${copy.events.remove("Wedding season")}"]`)?.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(posted[2]?.path).toBe("/api/demand-events/ev-1/remove");
    expect(page.textContent).not.toContain("Wedding season");
    expect(page.textContent).toContain(copy.events.removed);
  });
});
