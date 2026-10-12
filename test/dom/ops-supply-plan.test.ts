// Operations · Supply plan in the console (apps/ops/src/supply-plan/; docs/decisions/0180-supply-plan.md): transfers
// and orders each with why, approved at a quantity, rejected with why, decided ones saying what came of them, and the
// plan drafted again. Every name is made up.

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SupplyPlanScreen } from "../../apps/ops/src/supply-plan/SupplyPlanScreen.tsx";
import { supplyPlan as copy } from "../../apps/ops/src/content/supply-plan.ts";

const LOAN = {
  id: "pl-1",
  kind: "transfer",
  consumable_code: "solvent",
  name: "Solvent",
  city: "Gurgaon",
  from: "Delhi stockroom",
  to: "Gurgaon stockroom",
  supplier: null,
  proposed: 5,
  quantity: null,
  usable: 0,
  need: 10,
  safety: 5,
  state: "proposed",
  reject_reason: null,
  po_number: null,
};
const ORDER = {
  ...LOAN,
  id: "pl-2",
  kind: "order",
  city: null,
  from: null,
  to: null,
  supplier: "Kesh Supplies",
  proposed: 24,
};

let page: HTMLDivElement;
let root: Root;
let posted: { path: string; body: unknown }[];
let next: unknown;

const button = (text: string) => [...page.querySelectorAll("button")].find((each) => each.textContent.trim() === text);

async function press(element: HTMLButtonElement | undefined) {
  await act(async () => {
    element?.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function type(input: HTMLInputElement | null, value: string) {
  act(() => {
    if (input === null) return;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

beforeEach(() => {
  posted = [];
  next = { lines: [LOAN, ORDER] };
  vi.stubGlobal("fetch", (url: string, init?: RequestInit) => {
    const address = new URL(url, "https://ops.maneman.test");
    if (init?.method === "POST") {
      posted.push({ path: address.pathname, body: typeof init.body === "string" ? JSON.parse(init.body) : null });
      return Promise.resolve(Response.json(next));
    }
    if (address.pathname === "/api/supply-plan") return Promise.resolve(Response.json({ lines: [LOAN, ORDER] }));
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
    root.render(createElement(SupplyPlanScreen));
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

describe("the supply plan", () => {
  it("lists transfers and orders with why, and approves one at the quantity typed", async () => {
    await show();
    expect(page.textContent).toContain("Delhi stockroom");
    expect(page.textContent).toContain("Kesh Supplies");
    expect(page.textContent).toContain(copy.why({ need: 10, safety: 5, usable: 0 }));
    next = {
      lines: [
        { ...LOAN, state: "approved", quantity: 4 },
        { ...ORDER, state: "approved", quantity: 24, po_number: 7 },
      ],
    };
    const quantity = page.querySelector<HTMLInputElement>('input[inputmode="numeric"]');
    type(quantity, "4");
    await press(button(copy.approve));
    expect(posted).toEqual([{ path: "/api/supply-plan/lines/pl-1/approve", body: { quantity: 4 } }]);
    expect(page.textContent).toContain(copy.approvedSaid);
    expect(page.textContent).toContain(`Approved · ${copy.order(7)}`);
  });

  it("rejects a line with why, and drafts the plan again", async () => {
    await show();
    next = { lines: [LOAN, { ...ORDER, state: "rejected", reject_reason: "Bought last week" }] };
    await press([...page.querySelectorAll("button")].filter((each) => each.textContent.trim() === copy.reject)[1]);
    type(page.querySelector<HTMLInputElement>('input[maxlength="200"]'), "Bought last week");
    await press(button(copy.confirmReject));
    expect(page.textContent).toContain("Rejected · Bought last week");
    next = { lines: [] };
    await press(button(copy.draft));
    expect(page.textContent).toContain(copy.none);
    expect(posted.map((each) => each.path)).toEqual(["/api/supply-plan/lines/pl-2/reject", "/api/supply-plan/draft"]);
  });
});
