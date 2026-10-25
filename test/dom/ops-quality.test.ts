// Operations · Quality in the console (apps/ops/src/quality/; docs/decisions/0187-recalls.md): a lot recalled with
// why, a recall opened to where its stock is and who wears it, and one closed; failure rates grouped each way, and the
// value at risk with what to do (docs/decisions/0188-failure-rates-and-value-at-risk.md). Every name is made up.

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QualityScreen } from "../../apps/ops/src/quality/QualityScreen.tsx";
import { quality as copy } from "../../apps/ops/src/content/quality.ts";
import { answered } from "./render-hook.ts";
import { contractChecked } from "./contract-fetch.ts";

const RECALL = {
  id: "rc-1",
  number: 1,
  lot_id: "lot-1",
  lot_code: "BAD-0921",
  consumable_code: "hs-1",
  name: "Essential 8x10",
  unit: "piece",
  reason: "Supplier warned of shedding",
  raised_at: "2026-09-21T06:30:00.000Z",
  closed_at: null,
};
const DETAIL = {
  ...RECALL,
  held: [{ place_id: "central", place: "Warehouse", quantity: 2 }],
  worn: [
    {
      piece_id: "piece-1",
      piece_code: "MM-ESS-0000001-A",
      person_id: "p-1",
      person: "Rohit Malhotra",
      due_on: "2026-09-21",
    },
  ],
};
const BOOK = {
  recalls: [RECALL],
  lots: [{ id: "lot-2", lot_code: "OK-1", consumable_code: "hs-1", name: "Essential 8x10" }],
};

const GROUP = { name: "Essential 8x10", fitted: 8, failed: 1, rate_percent: 12.5 };
const RATES = {
  since: "2025-09-21",
  by_code: [GROUP],
  by_lot: [{ ...GROUP, name: "Essential 8x10 · BAD-0921" }],
  by_supplier: [{ ...GROUP, name: "Lumina Hair Co" }],
  by_technician: [{ ...GROUP, name: "Imran Qureshi" }],
};
const RISK = {
  total_value: 335000,
  lots: [
    {
      place_id: "central",
      place: "Warehouse",
      consumable_code: "solvent",
      name: "Solvent",
      lot_code: "SOON",
      expires_on: "2026-10-01",
      quantity: 62,
      value: 310000,
      suggestion: "move",
      move_to: "Imran Qureshi",
    },
  ],
};

let page: HTMLDivElement;
let root: Root;
let posted: { path: string; body: unknown }[];
let answers: unknown[];

const button = (text: string) => [...page.querySelectorAll("button")].find((each) => each.textContent.trim() === text);

async function press(element: Element | null | undefined) {
  await act(async () => {
    (element as HTMLElement | null | undefined)?.click();
    await answered();
  });
  await answered();
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
  answers = [];
  vi.stubGlobal(
    "fetch",
    contractChecked("ops", (url: string, init?: RequestInit) => {
      const address = new URL(url, "https://ops.maneman.test");
      if (init?.method === "POST") {
        posted.push({ path: address.pathname, body: typeof init.body === "string" ? JSON.parse(init.body) : null });
        return Promise.resolve(Response.json(answers.shift() ?? DETAIL));
      }
      if (address.pathname === "/api/recalls") return Promise.resolve(Response.json(BOOK));
      if (address.pathname === "/api/recalls/rc-1") return Promise.resolve(Response.json(DETAIL));
      if (address.pathname === "/api/quality/failures") return Promise.resolve(Response.json(RATES));
      if (address.pathname === "/api/stock/expiry-risk") return Promise.resolve(Response.json(RISK));
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
    root.render(createElement(QualityScreen));
  });
  await answered();
}

describe("the Quality page", () => {
  it("opens a recall to where its stock is and who wears it, and closes it", async () => {
    await show();
    expect(page.textContent).toContain(copy.number(1));
    await press(page.querySelector(`button[aria-label="${copy.view(copy.number(1))}"]`));
    expect(page.textContent).toContain("Warehouse");
    expect(page.textContent).toContain("Rohit Malhotra");
    answers = [{ ...DETAIL, closed_at: "2026-09-22T06:30:00.000Z" }];
    await press(button(copy.close));
    expect(posted).toEqual([{ path: "/api/recalls/rc-1/close", body: null }]);
    expect(document.body.textContent).toContain(copy.closedSaid);
    expect(button(copy.close)).toBeUndefined();
  });

  it("recalls a lot with why", async () => {
    await show();
    type(page.querySelector<HTMLInputElement>('input[maxlength="200"]'), "Supplier warned of shedding");
    answers = [{ ...DETAIL, id: "rc-2", number: 2, lot_id: "lot-2", lot_code: "OK-1" }];
    await press(button(copy.confirmRaise));
    expect(posted).toEqual([
      { path: "/api/recalls", body: { lot_id: "lot-2", reason: "Supplier warned of shedding" } },
    ]);
    expect(document.body.textContent).toContain(copy.raisedSaid);
    expect(page.textContent).toContain(copy.lotLabel("Essential 8x10", "OK-1"));
  });

  it("groups failure rates each way, and says what will expire unused and what to do", async () => {
    await show();
    expect(page.textContent).toContain(copy.rate(12.5));
    const select = [...page.querySelectorAll("select")].find((each) =>
      [...each.options].some((option) => option.value === "technician"),
    );
    act(() => {
      if (select === undefined) return;
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set?.call(select, "technician");
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(page.textContent).toContain("Imran Qureshi");
    expect(page.textContent).toContain(copy.moveTo("Imran Qureshi"));
    expect(page.textContent).toContain("Warehouse");
  });
});
