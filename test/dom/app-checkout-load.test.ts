// Razorpay Checkout's script failing to load in the client app (apps/app/src/booking/checkout.ts,
// docs/decisions/0277-alerts-that-come-sooner.md): the payment fails, and mm-api hears of it, as no other way tells ops.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadCheckout } from "../../apps/app/src/booking/checkout.ts";
import { contractChecked } from "./contract-fetch.ts";

let reports: { kind?: string; message?: string; source?: string }[];

beforeEach(() => {
  reports = [];
  vi.stubGlobal(
    "fetch",
    contractChecked("client", (_url: string, init?: RequestInit) => {
      reports.push(JSON.parse(typeof init?.body === "string" ? init.body : "{}") as (typeof reports)[number]);
      return Promise.resolve(new Response(null, { status: 204 }));
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  for (const script of document.head.querySelectorAll("script")) script.remove();
});

describe("Checkout's script", () => {
  it("that fails to load fails the payment, and tells mm-api", async () => {
    const loaded = loadCheckout();
    const script = document.head.querySelector<HTMLScriptElement>("script");
    script?.dispatchEvent(new Event("error"));
    await expect(loaded).rejects.toThrow("Checkout did not load");
    expect(reports).toEqual([
      expect.objectContaining({
        kind: "checkout_unavailable",
        message: "Checkout did not load: script error",
        source: "https://checkout.razorpay.com/v1/checkout.js",
      }),
    ]);
  });
});
