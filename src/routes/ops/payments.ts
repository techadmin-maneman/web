// A day's money, and Finance's ledger of every payment over a period, behind Access (src/domain/money/day-money.ts,
// src/domain/money/payment-ledger.ts).
//
// Nothing here takes or gives back money. The figures are read from the rows
// Razorpay's webhook already wrote, so this route cannot make the books say
// something the payments do not.
//
// The third figure, "Charges and no-shows", adds what each late cancellation and
// each charged no-show kept, which the charge records as ops rule
// (docs/decisions/0096-a-no-shows-charge-and-its-dispute.md). The board's
// disputed charge is GET /api/no-shows/disputes, since a dispute belongs to no day.

import { opsRoute } from "../../http/session-routes.ts";
import { z } from "@hono/zod-openapi";
import type { App } from "../../http/context.ts";
import { dayMoney } from "../../domain/money/day-money.ts";
import { ledgerPayments, unpaidLinks } from "../../domain/money/payment-ledger.ts";
import { errorResponse, refuse } from "../../http/errors.ts";
import { json } from "../../http/openapi.ts";
import { capped, More } from "../../http/paging.ts";
import { routeReach } from "../../http/staff-access.ts";
import { addDays, indiaDate } from "../../lib/india-time.ts";

/** As many lines as the board can usefully hold; past this the day is not one to read on a card. */
const LIMIT = 200;

const paise = (description: string) =>
  z
    .number()
    .int()
    .openapi({ description: `In paise. ${description}` });

const ChargeSchema = z
  .object({
    id: z.uuid().openapi({ description: "The change's or the case's own id." }),
    kind: z.enum(["late_cancellation", "no_show"]),
    person: z
      .union([z.object({ id: z.uuid(), name: z.string() }).strict(), z.null()])
      .openapi({ description: "Null for a visit with no client of ours." }),
    amount: z.union([paise("What was kept."), z.null()]).openapi({
      description: "Null on a no-show charged before a charge recorded what it kept (migration 0059).",
    }),
    at: z.iso.datetime().openapi({ description: "When the client cancelled, or when ops ruled on the no-show." }),
    visit_started_at: z.union([z.iso.datetime(), z.null()]).openapi({ description: "When the visit was to start." }),
    change: z
      .union([z.enum(["cancelled", "moved"]), z.null()])
      .openapi({ description: "How the client ended the visit; null on a no-show, where they ended nothing." }),
    technician: z
      .union([z.string(), z.null()])
      .openapi({ description: "Who attended and found nobody in; null on a late cancellation." }),
  })
  .strict()
  .openapi("OpsCharge");

const DayMoneySchema = z
  .object({
    date: z.iso.date().openapi({ description: "India's calendar date the figures cover." }),
    collected: paise('Captured on the day: the board\'s "Collected today".'),
    refunds_processing: paise('Asked for on the day and not back with the client yet: "Refunds processing".'),
    refunded: paise("Processed by Razorpay on the day, which the board draws no figure of its own for."),
    charged: paise(
      'Kept from the client on the day: "Charges and no-shows", each late cancellation and charged no-show by what it kept.',
    ),
    charges: z.array(ChargeSchema).openapi({ description: "No-shows and late cancellations, the earliest first." }),
    more: More(LIMIT),
  })
  .strict()
  .openapi("OpsDayMoney", { description: "Derived at read time from the payments themselves; no total is kept." });

const dayRoute = opsRoute({
  method: "get",
  path: "/api/payments",
  summary: "A day's money in the caller's cities: what was collected, what went back, and each charge kept or ruled on",
  request: {
    query: z.object({
      date: z.iso.date().optional().openapi({ description: "India's calendar date; today when it is left out." }),
    }),
  },
  responses: {
    200: { description: "The day", ...json(DayMoneySchema) },
    400: errorResponse("invalid_request"),
  },
});

/** As many payments as a ledger's period lists; a longer period is narrowed. */
const LEDGER_LIMIT = 1000;

/** The days a ledger reads when none are asked for: the last thirty, today among them. */
const LEDGER_DAYS = 30;

const PersonSchema = z
  .union([z.object({ id: z.uuid(), name: z.string() }).strict(), z.null()])
  .openapi({ description: "Null for one with no client of ours, or whose client was erased." });

const LedgerPaymentSchema = z
  .object({
    id: z.uuid(),
    reference: z.union([z.string(), z.null()]).openapi({ description: "The receipt's number; null before one." }),
    person: PersonSchema,
    kind: z.string().openapi({ description: "What it paid for: a visit, or a late fee." }),
    method: z
      .union([z.string(), z.null()])
      .openapi({ description: "As Razorpay names it, or upi for one at the visit." }),
    status: z.string(),
    amount: paise("What was paid."),
    refunded_amount: paise("What has gone back of it."),
    created_at: z.iso.datetime(),
    captured_at: z.union([z.iso.datetime(), z.null()]),
    books: z
      .enum(["applied", "waiting", "none"])
      .openapi({ description: "Applied in Books; captured and still to reach it; or nothing for Books." }),
  })
  .strict()
  .openapi("LedgerPayment");

const UnpaidLinkSchema = z
  .object({
    id: z.uuid(),
    reference: z.union([z.string(), z.null()]),
    person: PersonSchema,
    amount: paise("What the link asks for."),
    created_at: z.iso.datetime(),
    sent_at: z.union([z.iso.datetime(), z.null()]),
    refused_at: z.union([z.iso.datetime(), z.null()]).openapi({ description: "When Razorpay refused to make it." }),
    closes_at: z.union([z.iso.datetime(), z.null()]).openapi({ description: "Past it, the link is closed unpaid." }),
  })
  .strict()
  .openapi("UnpaidLink");

const LedgerSchema = z
  .object({
    from: z.iso.date(),
    to: z.iso.date().openapi({ description: "The last day counted." }),
    payments: z.array(LedgerPaymentSchema).openapi({ description: "Newest first." }),
    more: More(LEDGER_LIMIT),
    unpaid_links: z.array(UnpaidLinkSchema).openapi({ description: "Payment links not yet paid, the oldest first." }),
    more_links: More(LIMIT),
  })
  .strict()
  .openapi("PaymentLedger", { description: "Read from the payments themselves; nothing is totalled or kept." });

const ledgerRoute = opsRoute({
  method: "get",
  path: "/api/payments/ledger",
  summary: "Every payment over a period in the caller's cities, and the payment links still unpaid",
  request: {
    query: z.object({
      from: z.iso.date().optional().openapi({ description: "India's first day; thirty days back when left out." }),
      to: z.iso.date().optional().openapi({ description: "India's last day, counted; today when left out." }),
    }),
  },
  responses: {
    200: { description: "The ledger", ...json(LedgerSchema) },
    400: errorResponse("invalid_request: from is after to"),
  },
});

export function registerOpsPayments(app: App): void {
  app.openapi(ledgerRoute, async (c) => {
    const asked = c.req.valid("query");
    const to = asked.to ?? indiaDate(c.var.deps.now());
    const from = asked.from ?? addDays(to, 1 - LEDGER_DAYS);
    if (from > to) return refuse(c, "invalid_request", ["from"]);
    const reached = await routeReach(c);
    const [payments, links] = await Promise.all([
      ledgerPayments(c.env.DB, { from, to }, reached, LEDGER_LIMIT + 1),
      unpaidLinks(c.env.DB, reached, LIMIT + 1),
    ]);
    const listed = capped(payments, LEDGER_LIMIT);
    const linked = capped(links, LIMIT);
    return c.json(
      { from, to, payments: listed.rows, more: listed.more, unpaid_links: linked.rows, more_links: linked.more },
      200,
    );
  });

  app.openapi(dayRoute, async (c) => {
    const { date } = c.req.valid("query");
    const money = await dayMoney(c.env.DB, date ?? indiaDate(c.var.deps.now()), LIMIT + 1, await routeReach(c));
    const { rows: charges, more } = capped(money.charges, LIMIT);
    return c.json({ ...money, charges, more }, 200);
  });
}
