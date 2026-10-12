// Operations · Usage in the console (apps/ops/src/usage/; docs/decisions/0186-usage-and-shrinkage.md): technicians
// against expected, one opened to its items, and places' losses, the flagged marked. Every name is made up.

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UsageScreen } from "../../apps/ops/src/usage/UsageScreen.tsx";
import { usage as copy } from "../../apps/ops/src/content/usage.ts";

const USAGE = {
  since: "2026-08-24",
  technicians: [
    {
      technician_id: "t-1",
      name: "Imran Qureshi",
      visits: 6,
      expected_value: 3000,
      used_value: 4500,
      over_percent: 50,
      flagged: true,
      items: [{ consumable_code: "solvent", name: "Solvent", expected: 60, used: 90, over_percent: 50 }],
    },
  ],
  places: [
    {
      place_id: "t-1",
      place: "Imran Qureshi",
      kind: "kit",
      left_value: 6000,
      lost_value: 1500,
      write_offs: 3,
      shrinkage_percent: 25,
      count_accuracy_percent: null,
      flagged: true,
    },
  ],
};

let page: HTMLDivElement;
let root: Root;
let answer: unknown;

beforeEach(() => {
  answer = USAGE;
  vi.stubGlobal("fetch", (url: string) => {
    const address = new URL(url, "https://ops.maneman.test");
    if (address.pathname === "/api/stock/usage") return Promise.resolve(Response.json(answer));
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
    root.render(createElement(UsageScreen));
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

describe("the Usage page", () => {
  it("sets technicians against expected and opens one to its items, and gives each place's losses", async () => {
    await show();
    expect(page.textContent).toContain(copy.over(50));
    expect(page.textContent).toContain(copy.flagged);
    expect(page.textContent).toContain(copy.percent(25));
    await act(async () => {
      page.querySelector<HTMLButtonElement>(`button[aria-label="${copy.items("Imran Qureshi")}"]`)?.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(page.textContent).toContain("Solvent");
  });

  it("says when there is nothing to show", async () => {
    answer = { since: "2026-08-24", technicians: [], places: [] };
    await show();
    expect(page.textContent).toContain(copy.noTechnicians);
    expect(page.textContent).toContain(copy.noPlaces);
  });
});
