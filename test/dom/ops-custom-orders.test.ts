// A client's custom orders, on their Pieces tab in the console (apps/ops/src/clients/CustomOrders.tsx,
// RaiseCustomOrder.tsx; docs/decisions/0174-custom-orders.md): each with its spec, price and where it stands, one raised
// to the profile with its prices typed in their units, and one unpaid sent its link again or cancelled. Every name is
// made up.

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CustomOrders } from "../../apps/ops/src/clients/CustomOrders.tsx";
import { customOrders as copy } from "../../apps/ops/src/content/custom-orders.ts";

const CLIENT = "11111111-1111-4111-8111-111111111111";

const ORDER = {
  id: "co-1",
  number: 7,
  product: "essential",
  base_width_in: 7.5,
  base_length_in: 9,
  colour: "1B",
  grey_percent: 30,
  density_percent: 120,
  wave: "slight_wave",
  note: null,
  supplier_id: "sup-1",
  supplier_price: 15000,
  currency: "USD",
  amount: 4500000,
  promised_on: "2026-10-20",
  status: "awaiting_payment",
  short_url: null,
  link_sent_at: null,
  paid_at: null,
  po_number: null,
  refund_reason: null,
  raised_at: "2026-09-21T05:12:00.000Z",
};

const BOOK = { orders: [ORDER], suppliers: [{ id: "sup-1", name: "Lumina Hair Co", currency: "USD" }] };

let page: HTMLDivElement;
let root: Root;
let posted: { path: string; body: unknown }[];

const button = (text: string) => [...page.querySelectorAll("button")].find((each) => each.textContent.trim() === text);

const settle = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

function type(label: string, value: string) {
  const field = [...page.querySelectorAll("label")].find((each) => each.textContent.trim() === label);
  const input = page.querySelector<HTMLInputElement>(`#${CSS.escape(field?.htmlFor ?? "")}`);
  act(() => {
    if (input === null) return;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function press(text: string) {
  await act(async () => {
    button(text)?.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

beforeEach(() => {
  posted = [];
  vi.stubGlobal("fetch", (url: string, init?: RequestInit) => {
    const address = new URL(url, "https://ops.maneman.test");
    if (init?.method === "POST") {
      posted.push({ path: address.pathname, body: typeof init.body === "string" ? JSON.parse(init.body) : null });
      const status = address.pathname.endsWith("/cancel") ? "cancelled" : "awaiting_payment";
      const sent = { ...ORDER, status, short_url: "https://rzp.io/i/abc", link_sent_at: "2026-09-21T05:20:00.000Z" };
      return Promise.resolve(Response.json({ ...BOOK, orders: [sent] }));
    }
    return Promise.resolve(Response.json(BOOK));
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
    root.render(createElement(CustomOrders, { clientId: CLIENT }));
  });
  await settle();
}

describe("the client's custom orders", () => {
  it("lists each with its spec, price and where it stands", async () => {
    await show();
    expect(page.textContent).toContain(copy.number(7));
    expect(page.textContent).toContain("7.5×9 in, 1B, 30% grey, 120% density, slight wave");
    expect(page.textContent).toContain("Rs. 45,000");
    expect(page.textContent).toContain(copy.statuses.awaiting_payment);
  });

  it("raises one to the profile, its prices typed in their units, and shows its link while unpaid", async () => {
    await show();
    act(() => {
      button(copy.raise.open)?.click();
    });
    expect(button(copy.raise.send)?.disabled).toBe(true);
    type(copy.raise.supplierPrice("USD"), "150");
    type(copy.raise.amount, "45000");
    await press(copy.raise.send);
    expect(posted).toEqual([
      {
        path: `/api/clients/${CLIENT}/custom-orders`,
        body: {
          supplier_id: "sup-1",
          supplier_price: 15000,
          amount: 4500000,
          promised_on: null,
          wave: null,
          note: null,
        },
      },
    ]);
    expect(page.textContent).toContain(copy.raise.raised);
    expect(page.querySelector("a")?.getAttribute("href")).toBe("https://rzp.io/i/abc");
  });

  it("sends an unpaid order's link again, or cancels it", async () => {
    await show();
    await press(copy.sendAgain);
    expect(page.textContent).toContain(copy.sent);
    await press(copy.cancel);
    expect(posted.map((each) => each.path)).toEqual([
      "/api/custom-orders/co-1/send-link",
      "/api/custom-orders/co-1/cancel",
    ]);
    expect(page.textContent).toContain(copy.statuses.cancelled);
  });

  it("refunds a paid order in full for the reason chosen, and says when that reason does not hold", async () => {
    vi.stubGlobal("fetch", (url: string, init?: RequestInit) => {
      const address = new URL(url, "https://ops.maneman.test");
      const paid = { ...ORDER, status: "ordered", paid_at: "2026-09-21T06:00:00.000Z", po_number: 3 };
      if (init?.method !== "POST") return Promise.resolve(Response.json({ ...BOOK, orders: [paid] }));
      posted.push({ path: address.pathname, body: typeof init.body === "string" ? JSON.parse(init.body) : null });
      if (posted.length === 1) {
        return Promise.resolve(
          Response.json({ error: { code: "refund_not_due", request_id: "r-1" } }, { status: 409 }),
        );
      }
      const refunded = { ...paid, status: "refunded", refund_reason: "late" };
      return Promise.resolve(Response.json({ ...BOOK, orders: [refunded] }));
    });
    await show();
    await press(copy.refund);
    expect(page.textContent).toContain(copy.errors.refund_not_due);
    await press(copy.refund);
    expect(posted).toEqual([
      { path: "/api/custom-orders/co-1/refund", body: { reason: "late" } },
      { path: "/api/custom-orders/co-1/refund", body: { reason: "late" } },
    ]);
    expect(page.textContent).toContain(copy.refunded);
    expect(page.textContent).toContain(copy.statuses.refunded);
  });
});
