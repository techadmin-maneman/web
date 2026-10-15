// Paying for a hold from the booking sheet (apps/app/src/booking/usePay.ts), each way it can go, against a fake of the
// API held to the contract: paid at once, through Checkout, Checkout closed, Checkout failing, the hold run out, the
// credit it counted on gone, and the booking refused. Razorpay's Checkout is faked.

import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Hold } from "../../apps/app/src/api.ts";
import type { Paid } from "../../apps/app/src/booking/checkout.ts";
import type { BookingEvent, Step } from "../../apps/app/src/booking/flow.ts";
import { usePay } from "../../apps/app/src/booking/usePay.ts";
import { booking } from "../../apps/app/src/content.ts";
import { holdOf, minutesFromNow } from "./app-holds.ts";
import { contractChecked } from "./contract-fetch.ts";
import { answered, renderHook } from "./render-hook.ts";

const checkout = vi.hoisted((): { outcome: Paid } => ({ outcome: "paid" }));

vi.mock("../../apps/app/src/booking/checkout.ts", () => ({
  loadCheckout: () => Promise.resolve(),
  pay: () => Promise.resolve(checkout.outcome),
}));

const ORDER = {
  key_id: "rzp_test_key",
  order_id: "order_test_1",
  amount: 200000,
  currency: "INR",
  name: "Mane Man",
  description: "Service visit",
  prefill: { name: "Rohit Malhotra", contact: "+919810000001" },
};

const error = (code: string, status: number) => Response.json({ error: { code, request_id: "r-1" } }, { status });

/** The API as each test has it: what starting the booking answers, and the hold as it stands now. */
let answers: { booked: () => Response; hold: () => Response };

let events: BookingEvent[];
let problems: (string | null)[];

beforeEach(() => {
  checkout.outcome = "paid";
  events = [];
  problems = [];
  answers = {
    booked: () => Response.json({ hold_id: holdOf().id, checkout: ORDER }, { status: 201 }),
    hold: () => Response.json(holdOf()),
  };
  vi.stubGlobal(
    "fetch",
    contractChecked("client", (url: string, init?: RequestInit) => {
      const { pathname } = new URL(url, "https://app.maneman.test");
      if (pathname === "/api/bookings" && init?.method === "POST") return answers.booked();
      if (pathname.startsWith("/api/holds/") && (init?.method ?? "GET") === "GET") return answers.hold();
      return undefined;
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** The hook on the pay step, and a tap on Pay for `hold` as the sheet last had it. */
async function pay(hold: Hold): Promise<ReturnType<typeof usePay>> {
  // The step's own hold has time left, so its countdown stays out of each test.
  const step = { kind: "pay", hold: holdOf() } as Step;
  const rendered = renderHook(() =>
    usePay(step, {
      dialog: { current: null },
      dispatch: (event) => events.push(event),
      movingId: undefined,
      beforeStarting: () => Promise.resolve(),
      once: (work) => work(),
      setProblem: (problem) => problems.push(problem),
    }),
  );
  await act(async () => {
    await rendered.current().payFor(hold);
  });
  await answered();
  const paying = rendered.current();
  rendered.unmount();
  return paying;
}

describe("paying for a hold", () => {
  it("books a visit Checkout took the payment for", async () => {
    const hold = holdOf();
    const paying = await pay(hold);
    expect(events).toEqual([{ kind: "paid", hold }]);
    expect(paying.changed.current).toBe(true);
  });

  it("books at once a visit the API needs no payment for", async () => {
    answers.booked = () => Response.json({ hold_id: holdOf().id, checkout: null }, { status: 201 });
    await pay(holdOf());
    expect(events.map((event) => event.kind)).toEqual(["paid"]);
  });

  it("stays on the pay step, saying nothing, when Checkout is closed", async () => {
    checkout.outcome = "dismissed";
    await pay(holdOf());
    expect(events).toEqual([]);
    expect(problems).toEqual([null]);
  });

  it("goes to the payment-failed step when Checkout fails", async () => {
    checkout.outcome = "failed";
    await pay(holdOf());
    expect(events.map((event) => event.kind)).toEqual(["payFailed"]);
  });

  it("says the booking could not start when the API refuses it", async () => {
    answers.booked = () => error("not_bookable", 409);
    await pay(holdOf());
    expect(events).toEqual([]);
    expect(problems).toEqual([null, booking.failedToStart]);
  });

  it("goes to the hold's lapse when the API says it ran out before the booking started", async () => {
    answers.booked = () => error("hold_expired", 409);
    await pay(holdOf());
    expect(events.map((event) => event.kind)).toEqual(["lapsed"]);
  });

  // A credit used on another booking meanwhile: the hold now asks to be paid for, so the price shows before Checkout.
  it("shows the price instead of Checkout when the credit it counted on went elsewhere", async () => {
    answers.hold = () => Response.json(holdOf({ credit: null }));
    await pay(holdOf({ credit: { remaining: 0 } }));
    expect(events.map((event) => event.kind)).toEqual(["held"]);
    expect(problems).toEqual([null, booking.creditGone]);
  });

  it("says the booking could not start when the hold cannot be read again after its credit went", async () => {
    answers.hold = () => error("not_found", 404);
    await pay(holdOf({ credit: { remaining: 0 } }));
    expect(events).toEqual([]);
    expect(problems).toEqual([null, booking.failedToStart]);
  });

  // The clock ran out while Checkout was up: the hold's lapse waited for Checkout, and a payment it took keeps it.
  it("keeps a hold whose time ran out during Checkout when Checkout's payment landed", async () => {
    checkout.outcome = "dismissed";
    answers.hold = () => Response.json(holdOf({ paid: true }));
    await pay(holdOf({ expires_at: minutesFromNow(-1) }));
    expect(events.map((event) => event.kind)).toEqual(["paid"]);
  });

  it("lets a hold go whose time ran out during Checkout with nothing paid", async () => {
    checkout.outcome = "dismissed";
    await pay(holdOf({ expires_at: minutesFromNow(-1) }));
    expect(events.map((event) => event.kind)).toEqual(["lapsed"]);
  });
});
