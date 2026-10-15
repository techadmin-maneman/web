// What a printed purchase order says of us, on the Purchasing page (apps/ops/src/purchasing/Letterhead.tsx;
// docs/decisions/0166-purchase-orders.md): none until a manager sets it, the GSTIN optional and sent in capitals, and a
// refused box said beside it. Every name is made up.

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Letterhead } from "../../apps/ops/src/purchasing/Letterhead.tsx";
import type { Orders } from "../../apps/ops/src/purchasing/types.ts";
import { purchasing } from "../../apps/ops/src/content/purchasing.ts";

import { answered } from "./render-hook.ts";
import { contractChecked } from "./contract-fetch.ts";
const copy = purchasing.letterhead;

const BOOK = {
  orders: [],
  suppliers: [],
  consumables: [],
  second_approval_above_rupees: 0,
  letterhead: null,
} satisfies Orders;

const SET = { legal_name: "Kesh Grooming Private Limited", gstin: null, deliver_to: "Plot 9, Sector 18" };

let page: HTMLDivElement;
let root: Root;
let posted: unknown[];
let answer: () => Response;
let saved: { orders: Orders; said: string }[];

const button = (text: string) => [...page.querySelectorAll("button")].find((each) => each.textContent.trim() === text);

function type(label: string, value: string) {
  const field = [...page.querySelectorAll("label")].find((each) => each.textContent.trim() === label);
  const box = page.querySelector<HTMLInputElement | HTMLTextAreaElement>(`#${CSS.escape(field?.htmlFor ?? "")}`);
  act(() => {
    if (box === null) return;
    const prototype = box instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, "value")?.set?.call(box, value);
    box.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

beforeEach(() => {
  posted = [];
  saved = [];
  answer = () => Response.json({ ...BOOK, letterhead: SET });
  vi.stubGlobal(
    "fetch",
    contractChecked("ops", (_url: string, init?: RequestInit) => {
      posted.push(typeof init?.body === "string" ? JSON.parse(init.body) : null);
      return Promise.resolve(answer());
    }),
  );
  page = document.createElement("div");
  document.body.append(page);
  root = createRoot(page);
  act(() => {
    root.render(
      createElement(Letterhead, {
        orders: BOOK,
        onSaved: (orders: Orders, said: string) => {
          saved.push({ orders, said });
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

async function save() {
  await act(async () => {
    button(copy.save)?.click();
    await answered();
  });
}

describe("the letterhead", () => {
  it("asks to be set, and sends the GSTIN in capitals, or none for an empty box", async () => {
    expect(page.textContent).toContain(copy.missing);
    expect(button(copy.save)?.disabled).toBe(true);
    type(copy.legalName, SET.legal_name);
    type(copy.deliverTo, SET.deliver_to);
    await save();
    expect(posted).toEqual([SET]);
    expect(saved.map((each) => each.said)).toEqual([copy.saved]);

    type(copy.gstin, "06aabcm1234a1z5");
    await save();
    expect(posted[1]).toEqual({ ...SET, gstin: "06AABCM1234A1Z5" });
  });

  it("says a refused box beside it", async () => {
    answer = () =>
      Response.json({ error: { code: "invalid_request", request_id: "r", fields: ["gstin"] } }, { status: 400 });
    type(copy.legalName, SET.legal_name);
    type(copy.deliverTo, SET.deliver_to);
    type(copy.gstin, "123");
    await save();
    expect(page.textContent).toContain(copy.errors.gstin);
    expect(saved).toEqual([]);
  });
});
