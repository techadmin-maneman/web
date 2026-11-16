// The payment a client owes, as Home and their Payments both say it (src/routes/client/me.ts, src/routes/client/payments.ts).

import { z } from "@hono/zod-openapi";

/** A consultation and fit in one visit the client was fitted at and has not paid for yet. */
export const OwedPaymentSchema = z
  .object({
    visit_id: z.uuid(),
    date: z.iso.date().openapi({ description: "India's date of the visit." }),
    amount: z
      .number()
      .int()
      .openapi({ description: "In paise, GST included, after any code: what the link asks for." }),
    product: z.string().openapi({ description: 'The hair system fitted: "Mane Man Natural hair system".' }),
    url: z.union([z.string(), z.null()]).openapi({
      description: "The payment link Razorpay texted the client; null until it has made one.",
    }),
  })
  .strict()
  .openapi("OwedPayment");
