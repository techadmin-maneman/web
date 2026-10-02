// Razorpay Checkout (docs/decisions/0045-self-serve-booking.md): its script,
// loaded as the pay step opens, and its payment window, opened on the order
// our API made. Checkout tells the page whether the client paid; the booking
// itself waits for Razorpay's webhook, which the page then polls for.

import { cssToken } from "@maneman/ui/cssToken";
import type { Booking } from "../api.ts";

const SCRIPT = "https://checkout.razorpay.com/v1/checkout.js";
/**
 * How long the script may take before the payment counts as failed (board C6):
 * a script that never arrives would otherwise hold the sheet busy for ever.
 */
const PATIENCE_MS = 15_000;

interface RazorpayWindow {
  open(): void;
  on(event: "payment.failed", handler: () => void): void;
}

declare global {
  interface Window {
    Razorpay?: new (options: object) => RazorpayWindow;
  }
}

let loading: Promise<void> | null = null;

/** Loads Checkout's script once; a load that fails or takes too long is tried afresh the next time. */
export function loadCheckout(): Promise<void> {
  if (window.Razorpay !== undefined) return Promise.resolve();
  loading ??= new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    const fail = () => {
      window.clearTimeout(giveUp);
      script.remove();
      loading = null;
      reject(new Error("Checkout did not load"));
    };
    const giveUp = window.setTimeout(fail, PATIENCE_MS);
    script.src = SCRIPT;
    script.onload = () => {
      window.clearTimeout(giveUp);
      resolve();
    };
    script.onerror = fail;
    document.head.append(script);
  });
  return loading;
}

export type Paid = "paid" | "failed" | "dismissed";

/**
 * Opens Checkout on the order, where the client picks how to pay. Its script must have loaded. Checkout honours a
 * method chosen beforehand only when it is also given the client's e-mail, which the app does not have.
 */
export function pay(checkout: NonNullable<Booking["checkout"]>): Promise<Paid> {
  const Razorpay = window.Razorpay;
  if (Razorpay === undefined) return Promise.resolve("failed");
  return new Promise<Paid>((resolve) => {
    const razorpay = new Razorpay({
      key: checkout.key_id,
      order_id: checkout.order_id,
      amount: checkout.amount,
      currency: checkout.currency,
      name: checkout.name,
      description: checkout.description,
      prefill: checkout.prefill,
      // The brand's ink, for Checkout's own buttons.
      theme: { color: cssToken("--ink") },
      // A failure comes back to the app's own screen (board C6), not Checkout's retry.
      retry: { enabled: false },
      handler: () => {
        resolve("paid");
      },
      modal: {
        ondismiss: () => {
          resolve("dismissed");
        },
      },
    });
    razorpay.on("payment.failed", () => {
      resolve("failed");
    });
    razorpay.open();
  });
}
