// A payment Razorpay captured: Rs 30,000 by UPI, now, unless the test says otherwise.

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
