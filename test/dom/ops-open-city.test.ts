// Opening a city from India Post's pincodes, under Areas › Served (apps/ops/src/areas/OpenCity.tsx, ADR 0220): a
// state, its districts, their pincodes with those not held ticked, added to one of our cities in runs the API takes;
// and a service-area file's new pincodes added city by city before its changes are read. Every pincode is real only as
// a number.

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DirectoryPincode, ServedPincode } from "../../apps/ops/src/api.ts";
import { areas } from "../../apps/ops/src/content/areas.ts";
import { addFromFile, OpenCity } from "../../apps/ops/src/areas/OpenCity.tsx";
import type { CsvRow } from "../../apps/ops/src/areas/csv.ts";
import { answered } from "./render-hook.ts";
import { contractChecked } from "./contract-fetch.ts";

const copy = areas.directory;

const listed = (pincode: string, area: string, held: DirectoryPincode["held"] = null): DirectoryPincode => ({
  pincode,
  district: "MUMBAI",
  area,
  offices: [`${area} SO`],
  latitude: null,
  longitude: null,
  held,
});

const servedRow = (pincode: string, area: string, city: string): ServedPincode => ({
  pincode,
  area,
  city,
  served: false,
  launch_on: null,
  waiting: 0,
  to_alert: 0,
  paused_until: null,
});

let page: HTMLDivElement;
let root: Root;
let sent: { pincodes: { pincode: string; area?: string }[]; city: string }[];
let directory: DirectoryPincode[];
let added: (readonly ServedPincode[])[];

const button = (text: string) =>
  [...page.querySelectorAll("button")].find((each) => each.textContent.trim() === text) ?? null;
const box = (label: string) => page.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`);
const selects = () => [...page.querySelectorAll("select")];

async function choose(select: HTMLSelectElement | undefined, value: string) {
  await act(async () => {
    if (select === undefined) return;
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set?.call(select, value);
    select.dispatchEvent(new Event("change", { bubbles: true }));
    await Promise.resolve();
  });
  await answered();
}

async function press(element: HTMLElement | null) {
  act(() => {
    element?.click();
  });
  await answered();
}

beforeEach(() => {
  sent = [];
  added = [];
  directory = [
    listed("400050", "Bandra West"),
    listed("400051", "Kherwadi"),
    listed("400001", "Fort", { city: "Mumbai", area: "Fort", served: true }),
  ];
  vi.stubGlobal(
    "fetch",
    contractChecked("ops", (url: string, init?: RequestInit) => {
      const path = new URL(url, "https://fake.maneman.test").pathname;
      if (path === "/api/pincode-directory/states") return Promise.resolve(Response.json({ states: ["MAHARASHTRA"] }));
      if (path === "/api/pincode-directory/districts") {
        const district = { state: "MAHARASHTRA", district: "MUMBAI", pincodes: directory.length, held: 1 };
        return Promise.resolve(Response.json({ districts: [district] }));
      }
      if (path === "/api/pincode-directory/pincodes") return Promise.resolve(Response.json({ pincodes: directory }));
      const body = JSON.parse(typeof init?.body === "string" ? init.body : "{}") as (typeof sent)[number];
      sent.push(body);
      const rows = body.pincodes.map((each) => servedRow(each.pincode, each.area ?? "Suggested", body.city));
      return Promise.resolve(Response.json({ added: rows, held: [], unlisted: [] }, { status: 201 }));
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

async function showMumbai() {
  act(() => {
    root.render(
      createElement(OpenCity, {
        cities: ["Delhi", "Mumbai"],
        onAdded: (rows: readonly ServedPincode[]) => {
          added.push(rows);
        },
      }),
    );
  });
  await answered();
  await choose(selects()[0], "MAHARASHTRA");
  await press(box(copy.district("Mumbai", directory.length, 1)) ?? page.querySelector("input[type=checkbox]"));
  await press(button(copy.show));
}

describe("adding pincodes by district", () => {
  it("ticks those not held, holds back one held already, and adds the ticked to the city chosen", async () => {
    await showMumbai();
    expect(box(copy.tick("400050", "Bandra West"))?.checked).toBe(true);
    expect(box(copy.tick("400001", "Fort"))?.disabled).toBe(true);
    expect(page.textContent).toContain(copy.held("Mumbai"));

    await press(box(copy.tick("400051", "Kherwadi")));
    expect(button(copy.add(2))).toBeNull();
    await choose(selects()[1], "Mumbai");
    await press(button(copy.add(1)));

    expect(sent).toEqual([{ city: "Mumbai", pincodes: [{ pincode: "400050", area: "Bandra West" }] }]);
    expect(added.flat().map((each) => each.pincode)).toEqual(["400050"]);
    expect(document.body.textContent).toContain(copy.added(1, "Mumbai", 0));
  });

  it("sends more than the API takes at once in runs, all of them added", async () => {
    directory = Array.from({ length: 301 }, (_, at) => listed(String(400100 + at), `Area ${String(at)}`));
    await showMumbai();
    await choose(selects()[1], "Mumbai");
    await press(button(copy.add(301)));
    expect(sent.map((each) => each.pincodes.length)).toEqual([300, 1]);
    expect(added.flat()).toHaveLength(301);
  });
});

describe("a file's new pincodes", () => {
  const line = (pincode: string, city: string, area: string, served = true): CsvRow => ({
    pincode,
    city,
    area,
    served,
    launch_on: "2026-09-01",
  });

  it("are added city by city, the file's name where the API takes it, then the file is read for its changes", async () => {
    const lines = [
      line("400050", "Mumbai", "Bandra West"),
      line("411001", "Pune", "=SUM(1)"),
      line("400051", "Mumbai", ""),
    ];
    const done = await addFromFile([], lines, lines);
    expect(sent).toEqual([
      { city: "Mumbai", pincodes: [{ pincode: "400050", area: "Bandra West" }, { pincode: "400051" }] },
      { city: "Pune", pincodes: [{ pincode: "411001" }] },
    ]);
    expect(done.added.map((each) => each.pincode)).toEqual(["400050", "400051", "411001"]);
    expect(done.upload).toMatchObject({ step: "read", adds: [], said: areas.served.upload.added(3, []) });
    expect(done.upload.step === "read" ? done.upload.rows.map((each) => each.pincode.pincode) : []).toEqual([
      "400050",
      "411001",
      "400051",
    ]);
  });
});
