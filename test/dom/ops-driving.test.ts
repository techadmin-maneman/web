// Reports › Driving in the console (apps/ops/src/driving/DrivingScreen.tsx; docs/decisions/0294-learned-drive-times.md):
// each city's and technician's drives planned against taken, and the learned drive times beside. Every name is made up.

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DrivingScreen } from "../../apps/ops/src/driving/DrivingScreen.tsx";
import { driving as copy } from "../../apps/ops/src/content/driving.ts";
import { hoursAndMinutes } from "../../apps/ops/src/content/common.ts";
import { tables } from "../../packages/ui/words.ts";
import { answered } from "./render-hook.ts";
import { contractChecked } from "./contract-fetch.ts";

const WEEK = { period: "2026-09-14", drives: 6, planned_minutes: 180, actual_minutes: 204 };

const REPORT = {
  from: "2026-08-24",
  to: "2026-09-20",
  by_technician: [{ ...WEEK, technician_id: "t-1", name: "Imran Qureshi", city: "Gurgaon" }],
  by_city: [{ ...WEEK, city: "Gurgaon" }],
  factors: [
    { city: "Gurgaon", day_kind: "weekday", hour: 10, factor_pct: 140, drives: 24, in_use: true },
    { city: "Gurgaon", day_kind: "weekend", hour: 17, factor_pct: 90, drives: 3, in_use: false },
  ],
  learning: { use: "learned", min_drives: 20 },
};

/** What the report call answers with: the report above, unless a test sets its own. */
let answer: unknown = REPORT;
let page: HTMLDivElement;
let root: Root;
let asked: string[];

beforeEach(() => {
  asked = [];
  vi.stubGlobal(
    "fetch",
    contractChecked("ops", (url: string) => {
      const address = new URL(url, "https://ops.maneman.test");
      asked.push(`${address.pathname}${address.search}`);
      if (address.pathname === "/api/reports/driving") return Promise.resolve(Response.json(answer));
      return Promise.resolve(Response.json({ error: { code: "unavailable", request_id: "r-1" } }, { status: 503 }));
    }),
  );
  page = document.createElement("div");
  document.body.append(page);
  root = createRoot(page);
});

afterEach(() => {
  answer = REPORT;
  act(() => {
    root.unmount();
  });
  page.remove();
  vi.unstubAllGlobals();
});

const opened = async () => {
  await act(async () => {
    root.render(createElement(DrivingScreen));
    await answered();
  });
};

describe("the Driving page", () => {
  it("sets each city's and technician's week of drives planned against taken, and the gap", async () => {
    await opened();
    expect(asked).toContain("/api/reports/driving?weeks=4&by=week");
    const rows = [...page.querySelectorAll("tbody tr")].map((row) => row.textContent);
    expect(rows[0]).toBe(`GurgaonMon 14 Sep6${hoursAndMinutes(180)}${hoursAndMinutes(204)}${copy.signed(24)}`);
    expect(rows[1]).toContain("Imran Qureshi");
  });

  it("lists every learned drive time, and which booking plans with", async () => {
    await opened();
    const rows = [...page.querySelectorAll("tbody tr")].map((row) => row.textContent);
    expect(rows).toContain(`GurgaonWeekdays10 am140%24${copy.yes}`);
    expect(rows).toContain(`GurgaonWeekends5 pm90%3${copy.notYet}`);
    expect(page.textContent).toContain(copy.used(20));
  });

  it("says which hours have the drives to be used where ops use the estimate only", async () => {
    answer = { ...REPORT, learning: { use: "estimate", min_drives: 20 } };
    await opened();
    const rows = [...page.querySelectorAll("tbody tr")].map((row) => row.textContent);
    expect(rows).toContain(`GurgaonWeekdays10 am140%24${copy.yes}`);
    expect(page.textContent).toContain(copy.estimateOnly(20));
  });

  it("shows a long list 50 rows at a time, and the rest when asked", async () => {
    const days = Array.from({ length: 56 }, (_, day) => ({
      ...WEEK,
      period: new Date(Date.UTC(2026, 6, 27 + day)).toISOString().slice(0, 10),
      city: "Gurgaon",
    }));
    answer = { ...REPORT, by_city: days };
    await opened();
    const cityRows = () => page.querySelectorAll("[aria-labelledby='driving-cities'] tbody tr");
    expect(cityRows()).toHaveLength(50);
    const more = [...page.querySelectorAll("button")].find((button) => button.textContent === tables.more);
    await act(async () => {
      more?.click();
      await answered();
    });
    expect(cityRows()).toHaveLength(56);
  });

  it("asks again by day, and over another period, when they are chosen", async () => {
    await opened();
    const byDay = [...page.querySelectorAll("button")].find((button) => button.textContent === copy.bys.day);
    await act(async () => {
      byDay?.click();
      await answered();
    });
    expect(asked).toContain("/api/reports/driving?weeks=4&by=day");
    const select = page.querySelector("select");
    await act(async () => {
      if (select !== null) {
        select.value = "8";
        select.dispatchEvent(new Event("change", { bubbles: true }));
      }
      await answered();
    });
    expect(asked).toContain("/api/reports/driving?weeks=8&by=day");
  });
});
