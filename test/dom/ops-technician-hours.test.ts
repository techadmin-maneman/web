// A technician's Hours tab (apps/ops/src/technicians/TechnicianHours.tsx; docs/decisions/0210-booking-by-start-time.md):
// their week in lines, the days and hours ops set sent as one week, the city's hours sent as none, and where their
// day starts. Every name is made up.

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Hours, weekLines } from "../../apps/ops/src/technicians/TechnicianHours.tsx";
import type { Technician } from "../../apps/ops/src/api.ts";
import { technicians } from "../../apps/ops/src/content/technicians.ts";
import { answered } from "./render-hook.ts";
import { contractChecked } from "./contract-fetch.ts";

const copy = technicians.hours;

const IMRAN: Technician = {
  id: "33333333-3333-4333-8333-333333333331",
  name: "Imran Qureshi",
  initials: "IQ",
  zone: null,
  city: "Gurgaon",
  mobile: "+919810000009",
  fits_trained: true,
  visits_to_come: 0,
  sign_in_stopped_at: null,
  out_of_codes: false,
  devices: [],
  leave: [],
  hours: [],
  home: null,
};

let page: HTMLDivElement;
let root: Root;
let sent: { method: string; url: string; body: unknown }[];
let changed: number;

const button = (text: string) => [...page.querySelectorAll("button")].find((each) => each.textContent.trim() === text);

function show(technician: Technician) {
  act(() => {
    root.render(
      createElement(Hours, {
        technician,
        onChange: () => {
          changed += 1;
          return Promise.resolve();
        },
      }),
    );
  });
}

beforeEach(() => {
  sent = [];
  changed = 0;
  vi.stubGlobal(
    "fetch",
    contractChecked("ops", (url: string, init?: RequestInit) => {
      // Who is signed in is read as the page opens; nobody, here.
      if (url.endsWith("/api/whoami")) {
        return Promise.resolve(Response.json({ error: { code: "internal_error", request_id: "r" } }, { status: 500 }));
      }
      sent.push({
        method: init?.method ?? "GET",
        url,
        body: typeof init?.body === "string" ? JSON.parse(init.body) : null,
      });
      return Promise.resolve(Response.json({ days: [] }));
    }),
  );
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

describe("a technician's week", () => {
  it("reads as runs of days with the same hours, Monday first, then the days off", () => {
    const days = [1, 2, 3, 4, 5].map((weekday) => ({ weekday, starts: "09:00", ends: "18:00" }));
    expect(weekLines([...days, { weekday: 6, starts: "10:00", ends: "14:30" }])).toEqual([
      "Monday to Friday · 9 am to 6 pm",
      "Saturday · 10 am to 2:30 pm",
      "Off Sunday",
    ]);
    expect(weekLines([])).toEqual([copy.city]);
  });

  it("is sent as the days ticked, each at the hours chosen", async () => {
    show(IMRAN);
    expect(page.textContent).toContain(copy.city);
    act(() => {
      button(copy.set)?.click();
    });
    const sunday = [...page.querySelectorAll("label")].find((each) => each.textContent.trim() === "Sunday");
    act(() => {
      sunday?.click();
    });
    await act(async () => {
      button(copy.save)?.click();
      await answered();
    });
    expect(sent).toEqual([
      {
        method: "POST",
        url: `/api/technicians/${IMRAN.id}/hours`,
        body: { days: [1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, starts: "09:00", ends: "20:00" })) },
      },
    ]);
    expect(changed).toBe(1);
  });

  it("goes back to the city's hours as a week of no days", async () => {
    show({ ...IMRAN, hours: [{ weekday: 1, starts: "09:00", ends: "18:00" }] });
    act(() => {
      button(copy.set)?.click();
    });
    await act(async () => {
      button(copy.useCity)?.click();
      await answered();
    });
    expect(sent.map((each) => each.body)).toEqual([{ days: [] }]);
  });
});

describe("where the day starts", () => {
  it("says where it is, or that it is not set", () => {
    show(IMRAN);
    expect(page.textContent).toContain(copy.noHome);
    show({ ...IMRAN, home: { label: "Sunrise Greens, Sector 65, Gurugram" } });
    expect(page.textContent).toContain("Sunrise Greens, Sector 65, Gurugram");
    expect(button(copy.changeHome)).toBeDefined();
  });
});
