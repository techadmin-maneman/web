// A payment Razorpay captured: Rs 30,000 by UPI, now, unless the test says otherwise; and a one visit's link to pay
// by, Rs 32,000 for a first fit, made and texted now and unpaid.

import { AT, nextSerial, writeRow, type RowOf } from "./rows.ts";

export const aPayment = (row: RowOf<"payments"> = {}) =>
  writeRow(
    "payments",
    {
      id: crypto.randomUUID(),
      razorpay_payment_id: `pay_test${String(nextSerial()).padStart(8, "0")}`,
      amount: 3_000_000,
      currency: "INR",
      method: "upi",
      status: "captured",
      captured_at: AT,
      created_at: AT,
      updated_at: AT,
    },
    row,
  );

export const aPaymentLink = (row: RowOf<"payment_links"> & { readonly appointment_id: string }) =>
  writeRow(
    "payment_links",
    {
      id: crypto.randomUUID(),
      tier: "natural",
      amount: 3_200_000,
      amount_ex_gst: 3_200_000,
      gst_percent: 0,
      short_url: "https://rzp.io/i/test",
      sent_at: AT,
      created_at: AT,
      updated_at: AT,
    },
    row,
  );
