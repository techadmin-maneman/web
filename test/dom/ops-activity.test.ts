// Activity in the console (apps/ops/src/activity/ActivityScreen.tsx): the audit log is read once when the page opens
// and once each time what it is narrowed to changes, never again on its own.

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ActivityScreen } from "../../apps/ops/src/activity/ActivityScreen.tsx";
import { activity } from "../../apps/ops/src/content/activity.ts";
import { contractChecked } from "./contract-fetch.ts";

let page: HTMLDivElement;
let root: Root;
let reads: string[];

const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, 10)));

const show = () => {
  act(() => {
    [...page.querySelectorAll("button")].find((each) => each.textContent.trim() === activity.filters.show)?.click();
  });
};

function choose(select: HTMLSelectElement | null, value: string) {
  act(() => {
    if (select === null) return;
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set?.call(select, value);
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

beforeEach(() => {
  reads = [];
  vi.stubGlobal(
    "fetch",
    contractChecked("ops", (url: string) => {
      const address = new URL(url, "https://ops.maneman.test");
      if (address.pathname === "/api/activity") {
        reads.push(address.search);
        return Promise.resolve(Response.json({ entries: [], next_cursor: null }));
      }
      return Promise.resolve(Response.json({ error: { code: "unavailable", request_id: "r-1" } }, { status: 503 }));
    }),
  );
  window.history.replaceState(null, "", "/activity?person=p-1");
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

describe("the Activity page", () => {
  it("reads the log once when it opens, and once more when a filter comes off", async () => {
    await act(async () => {
      root.render(createElement(ActivityScreen));
      await Promise.resolve();
    });
    await settle();
    await settle();
    expect(reads).toEqual(["?person=p-1"]);
    expect(page.textContent).toContain(activity.empty);

    const remove = page.querySelector<HTMLButtonElement>(
      `button[aria-label="${activity.filters.remove(activity.filters.person)}"]`,
    );
    act(() => {
      remove?.click();
    });
    await settle();
    await settle();
    expect(reads).toEqual(["?person=p-1", ""]);
  });

  it("reads nothing while the boxes are filled, once when they are applied, and not again for the same", async () => {
    await act(async () => {
      root.render(createElement(ActivityScreen));
      await Promise.resolve();
    });
    await settle();
    const who = page.querySelector<HTMLSelectElement>(`form[aria-label="${activity.filters.label}"] select`);
    const kind = who?.options[1]?.value ?? "";
    choose(who, kind);
    await settle();
    expect(reads).toEqual(["?person=p-1"]);

    show();
    await settle();
    expect(reads).toEqual(["?person=p-1", `?actor_kind=${kind}&person=p-1`]);
    show();
    await settle();
    expect(reads).toHaveLength(2);
  });
});
