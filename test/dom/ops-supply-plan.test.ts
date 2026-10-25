// Operations · Supply plan in the console (apps/ops/src/supply-plan/; docs/decisions/0180-supply-plan.md): transfers
// and orders each with why, approved at a quantity, rejected with why, decided ones saying what came of them, and the
// plan drafted again. Every name is made up.

import { act, createElement } from "react";
import { openDialogsAsJsdomCan } from "./dialogs.ts";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SupplyPlanScreen } from "../../apps/ops/src/supply-plan/SupplyPlanScreen.tsx";
import { supplyPlan as copy } from "../../apps/ops/src/content/supply-plan.ts";
import { answered } from "./render-hook.ts";
import { contractChecked } from "./contract-fetch.ts";

const LOAN = {
  id: "pl-1",
  kind: "transfer",
  consumable_code: "solvent",
  name: "Solvent",
  unit: "ml",
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

/** A button on the page, or in the drawer a line opens, which is drawn in the document's body. */
const buttons = (text: string) =>
  [...document.body.querySelectorAll("button")].filter((each) => each.textContent.trim() === text);
const button = (text: string) => buttons(text)[0];

async function press(element: HTMLButtonElement | undefined) {
  await act(async () => {
    element?.click();
    await answered();
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
  openDialogsAsJsdomCan();
  posted = [];
  next = { lines: [LOAN, ORDER] };
  vi.stubGlobal(
    "fetch",
    contractChecked("ops", (url: string, init?: RequestInit) => {
      const address = new URL(url, "https://ops.maneman.test");
      if (init?.method === "POST") {
        posted.push({ path: address.pathname, body: typeof init.body === "string" ? JSON.parse(init.body) : null });
        return Promise.resolve(Response.json(next));
      }
      if (address.pathname === "/api/supply-plan") return Promise.resolve(Response.json({ lines: [LOAN, ORDER] }));
      return Promise.resolve(Response.json({ error: { code: "unavailable", request_id: "r-1" } }, { status: 503 }));
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

async function show() {
  act(() => {
    root.render(createElement(SupplyPlanScreen));
  });
  await answered();
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
    // The row says where the line stands; its item opens it to decide.
    expect(page.textContent).toContain(copy.states.proposed);
    await press(button("Solvent"));
    const quantity = document.body.querySelector<HTMLInputElement>('dialog input[inputmode="numeric"]');
    type(quantity, "4");
    await press(button(copy.approve));
    expect(posted).toEqual([{ path: "/api/supply-plan/lines/pl-1/approve", body: { quantity: 4 } }]);
    expect(document.body.textContent).toContain(copy.approvedSaid);
    expect(page.textContent).toContain(copy.draftedAs(copy.order(7)));
  });

  it("rejects a line with why, and drafts the plan again", async () => {
    await show();
    next = { lines: [LOAN, { ...ORDER, state: "rejected", reject_reason: "Bought last week" }] };
    // The order's line, the second named Solvent.
    await press(buttons("Solvent")[1]);
    await press(button(copy.reject));
    type(document.body.querySelector<HTMLInputElement>('dialog input[maxlength="200"]'), "Bought last week");
    await press(button(copy.confirmReject));
    expect(page.textContent).toContain("Rejected · Bought last week");
    next = { lines: [] };
    await press(button(copy.draft));
    expect(page.textContent).toContain(copy.none);
    expect(posted.map((each) => each.path)).toEqual(["/api/supply-plan/lines/pl-2/reject", "/api/supply-plan/draft"]);
  });
});
