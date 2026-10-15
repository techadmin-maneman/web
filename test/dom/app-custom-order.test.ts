// A custom order on the client's Home (apps/app/src/home/CustomOrderCard.tsx;
// docs/decisions/0177-custom-orders-in-the-app.md): ready to order with a way to pay, paid, being made by the day
// promised, or arrived; and nothing where it cannot be read.

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CustomOrderCard } from "../../apps/app/src/home/CustomOrderCard.tsx";
import { home } from "../../apps/app/src/content.ts";

import { answered } from "./render-hook.ts";
import { contractChecked } from "./contract-fetch.ts";
const copy = home.customOrder;

let page: HTMLDivElement;
let root: Root;

const order = (over: Record<string, unknown>) => ({
  number: 1,
  status: "awaiting_payment",
  promised_on: "2026-10-20",
  amount: 4500000,
  pay_url: null,
  ...over,
});

async function show(answer: Response) {
  vi.stubGlobal(
    "fetch",
    contractChecked("client", () => Promise.resolve(answer)),
  );
  act(() => {
    root.render(createElement(CustomOrderCard));
  });
  await answered();
}

beforeEach(() => {
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

describe("a custom order on Home", () => {
  it("says where each stands, with the way to pay while it waits for payment", async () => {
    await show(
      Response.json({
        orders: [
          order({ number: 1, pay_url: "https://rzp.io/i/abc" }),
          order({ number: 2, status: "paid" }),
          order({ number: 3, status: "ordered" }),
          order({ number: 4, status: "ordered", promised_on: null }),
          order({ number: 5, status: "arrived" }),
        ],
      }),
    );
    expect(page.textContent).toContain(copy.awaitingPayment);
    expect(page.querySelector("a")?.getAttribute("href")).toBe("https://rzp.io/i/abc");
    expect(page.textContent).toContain(copy.pay("Rs. 45,000"));
    expect(page.textContent).toContain(copy.paid);
    expect(page.textContent).toContain("Your hair system is being made, due by");
    expect(page.textContent).toContain(copy.ordered(null));
    expect(page.textContent).toContain(copy.arrived);
  });

  it("shows nothing where its orders cannot be read", async () => {
    await show(Response.json({ error: { code: "unavailable", request_id: "r-1" } }, { status: 503 }));
    expect(page.textContent).toBe("");
  });
});
