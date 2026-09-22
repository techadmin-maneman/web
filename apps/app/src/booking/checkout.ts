// Razorpay Checkout (docs/decisions/0045-self-serve-booking.md): its script,
// loaded when a client first pays, and its payment window, opened on the order
// our API made. Checkout tells the page whether the client paid; the booking
// itself waits for Razorpay's webhook, which the page then polls for.

import type { Booking } from "../api.ts";

const SCRIPT = "https://checkout.razorpay.com/v1/checkout.js";
/** The brand's ink (tokens.css --ink), for Checkout's own buttons. */
const INK = "#16233a";

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

function loadCheckout(): Promise<void> {
  if (window.Razorpay !== undefined) return Promise.resolve();
  loading ??= new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = SCRIPT;
    script.onload = () => {
      resolve();
    };
    script.onerror = () => {
      loading = null;
      reject(new Error("Checkout did not load"));
    };
    document.head.append(script);
  });
  return loading;
}

export type PayMethod = "upi" | "card";
export type Paid = "paid" | "failed" | "dismissed";

/** Opens Checkout on the order, with the method the client picked first. */
export async function pay(checkout: NonNullable<Booking["checkout"]>, method: PayMethod): Promise<Paid> {
  await loadCheckout();
  const Razorpay = window.Razorpay;
  if (Razorpay === undefined) return "failed";
  return new Promise<Paid>((resolve) => {
    const razorpay = new Razorpay({
      key: checkout.key_id,
      order_id: checkout.order_id,
      amount: checkout.amount,
      currency: checkout.currency,
      name: checkout.name,
      description: checkout.description,
      prefill: { ...checkout.prefill, method },
      theme: { color: INK },
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
