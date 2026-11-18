// A payment refunded from the console (apps/ops/src/clients/RefundPayment.tsx, src/routes/ops/payment-refunds.ts): with
// why, and how much of what is left, which starts at all of it. All of it goes back with no amount named; a part names
// its own, with the drawer's key; more than is left cannot be asked. Every name and amount is made up.

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RefundPayment } from "../../apps/ops/src/clients/RefundPayment.tsx";
import { clients } from "../../apps/ops/src/content/clients.ts";
import { rupees } from "../../packages/web-kit/money.ts";
import { answered } from "./render-hook.ts";
import { contractChecked } from "./contract-fetch.ts";
import { openDialogsAsJsdomCan } from "./dialogs.ts";

const copy = clients.payments;

/** Rs. 32,000 paid, Rs. 2,000 of it refunded: Rs. 30,000 left. */
const PAYMENT = {
  id: "55555555-5555-4555-8555-000000000001",
  amount: 3_200_000,
  refunded_amount: 200_000,
  status: "partially_refunded",
};

/** Who is signed in: unknown, so every action is shown and the API refuses what it must. */
const UNKNOWN_CALLER = () => Response.json({ error: { code: "internal_error", request_id: "r" } }, { status: 500 });

let page: HTMLDivElement;
let root: Root;
let posted: unknown[];
/** The answers lost on the way back, as when the network drops after the API made the refund. */
let lost: number;

/** The key the drawer made when it opened. */
const KEY = expect.stringMatching(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u) as string;

const button = (text: string) =>
  [...document.querySelectorAll("button")].find((each) => each.textContent.trim() === text);

function boxOf(label: string): HTMLInputElement | null {
  const field = [...document.querySelectorAll("label")].find((each) => each.textContent.trim() === label);
  return document.querySelector<HTMLInputElement>(`#${CSS.escape(field?.htmlFor ?? "")}`);
}

function type(label: string, value: string) {
  const input = boxOf(label);
  act(() => {
    if (input === null) return;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function press(text: string) {
  await act(async () => {
    button(text)?.click();
    await answered();
  });
}

beforeEach(() => {
  openDialogsAsJsdomCan();
  posted = [];
  lost = 0;
  vi.stubGlobal(
    "fetch",
    contractChecked("ops", (url: string, init?: RequestInit) => {
      const address = new URL(url, "https://ops.maneman.test");
      if (address.pathname === "/api/whoami") return Promise.resolve(UNKNOWN_CALLER());
      const body = (typeof init?.body === "string" ? JSON.parse(init.body) : {}) as { amount?: number };
      posted.push(body);
      if (lost > 0) {
        lost -= 1;
        return Promise.reject(new TypeError("Failed to fetch"));
      }
      return Promise.resolve(Response.json({ amount: body.amount ?? 3_000_000 }));
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

async function openDrawer() {
  act(() => {
    root.render(createElement(RefundPayment, { entry: PAYMENT }));
  });
  await answered();
  await press(copy.refundOpen);
}

describe("refunding a payment from the console", () => {
  it("starts at all that is left, and sends all of it with no amount named", async () => {
    await openDrawer();
    expect(boxOf(copy.refundAmount)?.value).toBe("30000");
    expect(button(copy.refundConfirm(rupees(3_000_000)))?.disabled).toBe(true);
    type(copy.refundReason, "Paid twice for the same fit");
    await press(copy.refundConfirm(rupees(3_000_000)));
    expect(posted).toEqual([{ reason: "Paid twice for the same fit" }]);
    expect(page.textContent).toContain(copy.refundAsked(rupees(3_000_000)));
  });

  it("sends a part with its amount, and names it on the button", async () => {
    await openDrawer();
    type(copy.refundReason, "Visit cut short");
    type(copy.refundAmount, "500");
    await press(copy.refundConfirm(rupees(50_000)));
    expect(posted).toEqual([{ reason: "Visit cut short", amount: 50_000, key: KEY }]);
    expect(page.textContent).toContain(copy.refundAsked(rupees(50_000)));
  });

  // The answer was lost, so the drawer stays open; pressed again, it sends the same key, and the part goes back once.
  it("sends a part pressed again after a lost answer under the same key", async () => {
    lost = 1;
    await openDrawer();
    type(copy.refundReason, "Visit cut short");
    type(copy.refundAmount, "500");
    await press(copy.refundConfirm(rupees(50_000)));
    expect(page.textContent).not.toContain(copy.refundAsked(rupees(50_000)));
    await press(copy.refundConfirm(rupees(50_000)));
    expect(posted).toHaveLength(2);
    const [first, again] = posted as { key: string }[];
    expect(again?.key).toBe(first?.key);
    expect(page.textContent).toContain(copy.refundAsked(rupees(50_000)));
  });

  it("asks nothing for more than is left, or for nothing", async () => {
    await openDrawer();
    type(copy.refundReason, "Goodwill");
    type(copy.refundAmount, "30000.01");
    expect(button(copy.refundConfirm(rupees(3_000_000)))?.disabled).toBe(true);
    expect(document.body.textContent).toContain(copy.refundAmountOver(rupees(3_000_000)));
    type(copy.refundAmount, "0");
    expect(button(copy.refundConfirm(rupees(3_000_000)))?.disabled).toBe(true);
    expect(document.body.textContent).toContain(copy.refundAmountNone);
    expect(posted).toEqual([]);
  });
});
