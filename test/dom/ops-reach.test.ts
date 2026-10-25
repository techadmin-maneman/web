// A city's reach under Areas › Served (apps/ops/src/areas/Reach.tsx, ADR 0223): the served pincodes no reach takes in,
// and each technician's reach as a way to choose its pincodes. Every name and number is made up.

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CityReach } from "../../apps/ops/src/api.ts";
import { areas } from "../../apps/ops/src/content/areas.ts";
import { CityTools } from "../../apps/ops/src/areas/Reach.tsx";
import { answered } from "./render-hook.ts";
import { contractChecked } from "./contract-fetch.ts";

const copy = areas.reach;

const REACH: CityReach = {
  technicians: [
    {
      id: "t1",
      name: "Imran Qureshi",
      initials: "IQ",
      home: { lat: 28.45, lng: 77.02 },
      reach_min: 45,
      reach_km: 10,
    },
  ],
  pincodes: [
    {
      pincode: "122018",
      area: "Sector 65",
      served: true,
      paused_until: null,
      centre: { lat: 28.49, lng: 77.02 },
      nearest: { technician_id: "t1", minutes: 22 },
      reached: true,
      reached_by: ["t1"],
    },
    {
      pincode: "122099",
      area: "Sector 99",
      served: true,
      paused_until: null,
      centre: { lat: 28.72, lng: 77.02 },
      nearest: { technician_id: "t1", minutes: 95 },
      reached: false,
      reached_by: [],
    },
  ],
};

let page: HTMLDivElement;
let root: Root;
let chosen: ReadonlySet<string>[];

beforeEach(() => {
  chosen = [];
  vi.stubGlobal(
    "fetch",
    contractChecked("ops", (url: string) => {
      const path = new URL(url, "https://fake.maneman.test").pathname;
      if (path === "/api/whoami") {
        return Promise.resolve(Response.json({ error: { code: "internal_error", request_id: "r" } }, { status: 500 }));
      }
      if (path === "/api/service-area/reach") return Promise.resolve(Response.json(REACH));
      if (path === "/api/service-area/map") {
        return Promise.resolve(new Response("<svg/>", { headers: { "Content-Type": "image/svg+xml" } }));
      }
      if (path === "/api/pincode-launches") return Promise.resolve(Response.json({ launches: [] }));
      if (path === "/api/pincode-launches/recent") return Promise.resolve(Response.json({ launches: [] }));
      return undefined;
    }),
  );
  vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: () => "blob:map", revokeObjectURL: () => undefined }));
  page = document.createElement("div");
  document.body.append(page);
  root = createRoot(page);
  act(() => {
    root.render(
      createElement(CityTools, {
        city: "Gurgaon",
        onChoose: (pincodes: ReadonlySet<string>) => {
          chosen.push(pincodes);
        },
      }),
    );
  });
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  page.remove();
  vi.unstubAllGlobals();
});

const button = (label: string) =>
  [...page.querySelectorAll("button")].find(
    (each) => each.textContent.trim() === label || each.getAttribute("aria-label") === label,
  ) ?? null;

describe("a city's reach", () => {
  it("draws the map, and names the served pincodes out of every reach with the nearest technician", async () => {
    await answered();
    await answered();
    expect(page.querySelector(`img[alt="${copy.mapAlt("Gurgaon")}"]`)).not.toBeNull();
    expect(page.textContent).toContain(copy.outOfReach(1));
    expect(page.textContent).toContain(copy.unreached("122099", "Sector 99", copy.nearest("Imran Qureshi", 95)));
    act(() => {
      button(copy.chooseUnreached)?.click();
    });
    expect([...(chosen[0] ?? [])]).toEqual(["122099"]);
  });

  it("chooses the pincodes within a technician's reach", async () => {
    await answered();
    expect(page.textContent).toContain(copy.within("Imran Qureshi", 45, 1));
    act(() => {
      button(copy.chooseWithin("Imran Qureshi"))?.click();
    });
    expect([...(chosen[0] ?? [])]).toEqual(["122018"]);
  });
});
