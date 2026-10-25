// Launches, readiness, pauses and what stopping leaves, under Areas › Served (apps/ops/src/areas/Launches.tsx,
// apps/ops/src/areas/Chosen.tsx; ADR 0221). Every pincode is real only as a number.

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PincodeLaunch, ServedPincode } from "../../apps/ops/src/api.ts";
import { areas } from "../../apps/ops/src/content/areas.ts";
import { LaunchList } from "../../apps/ops/src/areas/Launches.tsx";
import { ChosenBar } from "../../apps/ops/src/areas/Chosen.tsx";
import { review } from "../../apps/ops/src/content.ts";
import { shortDate } from "../../packages/web-kit/dates.ts";
import { answered } from "./render-hook.ts";
import { contractChecked } from "./contract-fetch.ts";

const row = (pincode: string, served: boolean, pausedUntil: string | null = null): ServedPincode => ({
  pincode,
  area: "Bandra West",
  city: "Mumbai",
  served,
  launch_on: null,
  waiting: 0,
  to_alert: 0,
  paused_until: pausedUntil,
});

const LAUNCH: PincodeLaunch = {
  id: "11111111-1111-4111-8111-111111111111",
  city: "Mumbai",
  go_live_on: "2026-11-05",
  state: "scheduled",
  pincodes: [{ pincode: "400050", area: "Bandra West" }],
  created_by: "ops@maneman.in",
  created_at: "2026-10-25T10:00:00.000Z",
  live_at: null,
  alerted: null,
  cancelled_at: null,
  held_because: null,
};

let page: HTMLDivElement;
let root: Root;
let sent: { path: string; body: unknown }[];

const button = (text: string) =>
  [...page.querySelectorAll("button")].find((each) => each.textContent.trim() === text) ?? null;

async function press(element: HTMLElement | null) {
  act(() => {
    element?.click();
  });
  await answered();
}

beforeEach(() => {
  sent = [];
  vi.stubGlobal(
    "fetch",
    contractChecked("ops", (url: string, init?: RequestInit) => {
      const path = new URL(url, "https://fake.maneman.test").pathname;
      // Who is signed in is read as the bar opens; nobody, here, so the API decides.
      if (path === "/api/whoami") {
        return Promise.resolve(Response.json({ error: { code: "internal_error", request_id: "r" } }, { status: 500 }));
      }
      const body: unknown = typeof init?.body === "string" ? JSON.parse(init.body) : null;
      if ((init?.method ?? "GET") === "POST") sent.push({ path, body });
      if (path === "/api/pincode-launches" && init?.method === "POST") {
        return Promise.resolve(Response.json(LAUNCH, { status: 201 }));
      }
      if (path === "/api/pincode-launches") return Promise.resolve(Response.json({ launches: [LAUNCH] }));
      if (path.endsWith("/cancel"))
        return Promise.resolve(Response.json({ ...LAUNCH, state: "cancelled", cancelled_at: LAUNCH.created_at }));
      if (path === "/api/pincode-launches/readiness") {
        return Promise.resolve(
          Response.json({
            checks: [
              { check: "technicians", ready: true, count: 2 },
              { check: "stockroom", ready: false, count: 0 },
            ],
          }),
        );
      }
      if (path === "/api/service-area/pause") return Promise.resolve(Response.json({ changed: 1 }));
      if (path === "/api/service-area/stop-impact") return Promise.resolve(Response.json({ visits: 3, clients: 2 }));
      return undefined;
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

describe("the launches", () => {
  it("lists a launch scheduled, and cancels it once asked", async () => {
    act(() => {
      root.render(createElement(LaunchList));
    });
    await answered();
    expect(page.textContent).toContain(areas.launches.line("Mumbai", shortDate(LAUNCH.go_live_on), 1));
    await press(page.querySelector(`button[aria-label="${areas.launches.cancelLabel("Mumbai", shortDate(LAUNCH.go_live_on))}"]`));
    expect(page.textContent).toContain(areas.launches.cancelCheck("Mumbai", shortDate(LAUNCH.go_live_on)));
    await press(button(review.send));
    expect(sent.map((each) => each.path)).toEqual([`/api/pincode-launches/${LAUNCH.id}/cancel`]);
  });
});

describe("the chosen bar", () => {
  function bar(chosen: readonly ServedPincode[], onServe = vi.fn(), onPaused = vi.fn()) {
    act(() => {
      root.render(createElement(ChosenBar, { city: "Mumbai", chosen, onServe, onPaused, onClear: vi.fn() }));
    });
    return { onServe, onPaused };
  }

  it("schedules unserved pincodes, saying what the city still needs first", async () => {
    bar([row("400050", false)]);
    await press(button(areas.launches.schedule));
    await answered();
    expect(page.textContent).toContain(areas.readiness.checks.stockroom(false));
    expect(page.textContent).toContain(areas.readiness.checks.technicians(true, 2));
    await press(button(areas.launches.schedule));
    expect(sent[0]).toMatchObject({ path: "/api/pincode-launches", body: { city: "Mumbai", pincodes: ["400050"] } });
  });

  it("pauses served pincodes, and resumes one paused", async () => {
    const { onPaused } = bar([row("110001", true, "2026-11-01")]);
    expect(button(areas.launches.schedule)).toBeNull();
    await press(button(areas.pause.pause));
    await press(button(areas.pause.resume));
    expect(sent[0]).toEqual({ path: "/api/service-area/pause", body: { pincodes: ["110001"], until: null } });
    expect(onPaused).toHaveBeenCalledWith(["110001"], null);
  });

  it("says what stopping leaves booked before it asks", async () => {
    const { onServe } = bar([row("110001", true)]);
    await press(button(areas.served.chosen.stop));
    expect(onServe).toHaveBeenCalledWith(false, areas.served.chosen.stopLeaves(3, 2));
  });
});
