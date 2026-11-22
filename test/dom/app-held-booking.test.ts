// A visit ops booked that waits on the payment link they sent, on the client's Home (apps/app/src/home/
// HeldBookingCard.tsx): the visit, until when it is held, and the link to pay it, so it can be paid whether or not the
// text reached them; and nothing where it cannot be read.

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HeldBookingCard } from "../../apps/app/src/home/HeldBookingCard.tsx";
import { home } from "../../apps/app/src/content.ts";
import { answered } from "./render-hook.ts";
import { contractChecked } from "./contract-fetch.ts";

const copy = home.heldBooking;

let page: HTMLDivElement;
let root: Root;

async function show(answer: Response) {
  vi.stubGlobal(
    "fetch",
    contractChecked("client", () => Promise.resolve(answer)),
  );
  act(() => {
    root.render(createElement(HeldBookingCard));
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

describe("a booking held on its link, on Home", () => {
  it("names the visit, until when it is held, and the link to pay it", async () => {
    await show(
      Response.json({
        held: [
          {
            type: "first_fit",
            date: "2026-11-22",
            starts_at: "2026-11-22T04:30:00.000Z",
            amount: 2150000,
            pay_url: "https://rzp.io/i/held",
            open_until: "2026-11-22T01:30:00.000Z",
          },
        ],
      }),
    );
    expect(page.textContent).toContain(copy.line("first fit", "Sun 22 Nov at 10 am", "7 am Sun 22 Nov"));
    expect(page.querySelector("a")?.getAttribute("href")).toBe("https://rzp.io/i/held");
    expect(page.textContent).toContain(copy.pay("Rs. 21,500"));
  });

  it("shows nothing where its bookings cannot be read", async () => {
    await show(Response.json({ error: { code: "unavailable", request_id: "r-1" } }, { status: 503 }));
    expect(page.textContent).toBe("");
  });
});
