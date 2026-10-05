// Paying for a hold through Razorpay Checkout, from the booking sheet.

import type { Booking } from "../api.ts";
import { loadCheckout, pay, type Paid } from "./checkout.ts";

/**
 * A sheet opened with showModal() sits in the browser's top layer and makes the rest of the page inert, so Checkout's
 * own window would be drawn under it and take no taps. The sheet therefore closes while Checkout is up, and rises
 * again with the answer; `paying` keeps that close from letting the hold go. Checkout's script is waited for first,
 * with the sheet still up and busy, so a script that never comes ends on the sheet's own payment-failed step.
 */
export async function throughCheckout(
  dialog: HTMLDialogElement | null,
  paying: { current: boolean },
  checkout: NonNullable<Booking["checkout"]>,
  payBy: string,
): Promise<Paid> {
  const ready = await loadCheckout().then(
    () => true,
    () => false,
  );
  if (!ready) return "failed";
  paying.current = true;
  dialog?.close();
  const outcome = await pay(checkout, payBy).catch(() => "failed" as const);
  dialog?.showModal();
  paying.current = false;
  return outcome;
}
