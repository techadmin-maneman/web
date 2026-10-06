// A client's record in the console (./clients.ts): who they are, their address, visits, money, history and the invite
// they came with. Of an erased client, only what is kept: when they were erased, their visits and their money.

import { createRoute, z } from "@hono/zod-openapi";
import { VISIT_TYPES } from "../../config/visit-types.ts";
import { currentAddress } from "../../domain/clients/profile.ts";
import { AUTO_REFUND_REASONS, autoRefundsOf, type AutoRefund } from "../../domain/money/auto-refunds.ts";
import { INVOICE_STATES, LINK_STATES, paymentLinksOf, visitInvoicesOf } from "../../domain/money/client-billing.ts";
import { paymentEntries } from "../../domain/money/client-payments.ts";
import { creditBalance } from "../../domain/money/credits.ts";
import { clientVisitCodes } from "../../domain/money/discount-code-uses.ts";
import { partialVisitsClosed } from "../../domain/ops/task-closures.ts";
import { clientInviteOf } from "../../domain/referrals/referrals.ts";
import { clientHistory } from "../../domain/visits/client-history.ts";
import {
  CLIENT_STATES,
  clientStateOf,
  isFitted,
  listVisits,
  visitOutcomes,
} from "../../domain/visits/client-visits.ts";
import { VISIT_OUTCOMES } from "../../domain/visits/visit-status.ts";
import type { App } from "../../http/context.ts";
import { errorResponse, refuse } from "../../http/errors.ts";
import { json } from "../../http/openapi.ts";
import { anyClientInReach } from "../../http/staff-access.ts";
import { EntrySchema } from "../client/payments.ts";
import { clientAddressOf, ClientAddressSchema, clientId } from "../schemas/clients.ts";
import { HISTORY_FIGURES, VisitSummarySchema } from "../schemas/visits.ts";
import { ClientInviteSchema } from "./client-referral.ts";

const ClientVisitSchema = VisitSummarySchema.extend({
  outcome: z
    .union([z.enum(VISIT_OUTCOMES), z.null()])
    .openapi({ description: "What the visit was closed as, a no-show being its own; null until it is closed." }),
  closed_without_follow_up: z
    .union([
      z
        .object({
          by: z.string().openapi({ description: "The Access e-mail of the member of staff who closed it." }),
          at: z.iso.datetime(),
          reason: z.union([z.string(), z.null()]).openapi({ description: "Null once the client is erased." }),
        })
        .strict(),
      z.null(),
    ])
    .openapi({
      description: "For a visit left partly done, ops closing its task without a follow-up visit; null otherwise.",
    }),
  discount_code: z
    .union([
      z
        .object({
          code: z.string(),
          amount_off: z
            .union([z.number().int(), z.null()])
            .openapi({ description: "In paise before GST; null until the visit's price is known." }),
          given_by: z.enum(["client", "technician", "ops"]),
        })
        .strict(),
      z.null(),
    ])
    .openapi({ description: "The discount code on the visit (docs/decisions/0108-discount-codes.md); else null." }),
  price_open: z.boolean().openapi({
    description: "Not yet paid for, linked or invoiced, so a discount code may still be entered on it or taken off.",
  }),
  requested_code: z.union([z.string(), z.null()]).openapi({
    description:
      "For a consultation and fit in one visit, the code the client typed on /book for it, honoured as it stood " +
      "then when entered on the visit; null for none.",
  }),
}).openapi("ClientVisit");

/**
 * The same derivation the client reads of themselves, with the replacement's
 * own day beside the month: ops order a piece against a date, and the board's
 * task queue already names one (src/domain/ops/tasks.ts).
 */
const OpsHistorySchema = z
  .object({
    ...HISTORY_FIGURES,
    replacement_due: z
      .union([z.object({ on: z.iso.date(), month: z.string(), piece_code: z.string() }).strict(), z.null()])
      .openapi({ description: "When the piece now in wear falls due; null when the client is wearing none." }),
  })
  .strict()
  .openapi("ClientRecordHistory");

/** A booking that refunded its payment by itself, as the client's Visits tab says it, and the client was told. */
const AutoRefundSchema = z
  .object({
    hold_id: z.uuid(),
    type: z.enum(VISIT_TYPES),
    service: z.string().openapi({ description: "Its service's name as it is now." }),
    date: z.iso.date().openapi({ description: "India's day the visit was to be on." }),
    amount: z.union([z.number().int(), z.null()]).openapi({
      description:
        "In paise, GST included: what Razorpay took, all of which went back; null where it is not on record.",
    }),
    reason: z.enum(AUTO_REFUND_REASONS).openapi({
      description: "lapsed: paid after the hold and its grace ran out; not_movable: a move whose visit had begun.",
    }),
    refunded_at: z.iso.datetime(),
  })
  .strict()
  .openapi("AutoRefund");

const autoRefundOf = (refund: AutoRefund) => ({
  hold_id: refund.holdId,
  type: refund.type,
  service: refund.serviceName,
  date: refund.date,
  amount: refund.amount,
  reason: refund.reason,
  refunded_at: refund.refundedAt,
});

const ClientPaymentLinkSchema = z
  .object({
    id: z.uuid(),
    product: z.string().openapi({ description: "The service it pays for, by its name now." }),
    visit_date: z
      .union([z.iso.date(), z.null()])
      .openapi({ description: "India's date of the visit it pays for; null where the visit has no start." }),
    amount: z.number().int().openapi({ description: "In paise, GST included." }),
    reference: z.union([z.string(), z.null()]).openapi({
      description: "As the client reads it on Razorpay's page; null on a link made before links had one.",
    }),
    short_url: z
      .union([z.string(), z.null()])
      .openapi({ description: "The address Razorpay texted the client; null until Razorpay has made the link." }),
    sent_at: z.union([z.iso.datetime(), z.null()]),
    state: z.enum(LINK_STATES).openapi({
      description:
        "making: Razorpay has not made it yet, and it is asked again; open: sent and not paid; paid; refused: " +
        "Razorpay would not make it, so ops send one by hand; lapsed: closed unpaid.",
    }),
    paid_at: z.union([z.iso.datetime(), z.null()]),
  })
  .strict()
  .openapi("ClientPaymentLink");

const ClientInvoiceSchema = z
  .object({
    visit_id: z.uuid(),
    date: z.iso.date(),
    type: z.enum(VISIT_TYPES),
    state: z.enum(INVOICE_STATES).openapi({
      description: "to_raise: Books holds none yet; draft: Books holds it unsent; issued: sent to the client.",
    }),
    issued_at: z.union([z.iso.datetime(), z.null()]),
  })
  .strict()
  .openapi("ClientInvoice");

const RecordVisitsSchema = z
  .object({ upcoming: z.array(ClientVisitSchema), past: z.array(ClientVisitSchema) })
  .strict()
  .openapi({ description: "Upcoming soonest first; past newest first." });
/** What the client's money is on the record, kept as it is once they are erased. */
const RECORD_MONEY = {
  payments: z.array(EntrySchema).openapi({ description: "Payments and refunds as one list, newest first." }),
  payment_links: z.array(ClientPaymentLinkSchema).openapi({ description: "Every payment link, newest first." }),
  invoices: z
    .array(ClientInvoiceSchema)
    .openapi({ description: "Each finished visit sold for a price, with its invoice; the latest visit first." }),
};

const ClientRecordSchema = z
  .object({
    id: z.uuid(),
    name: z.string(),
    mobile: z.string().openapi({ description: "E.164, as ops need it to call or message." }),
    state: z.enum(CLIENT_STATES),
    known_since: z.iso.datetime().openapi({ description: "When the person's record was first written." }),
    address: z.union([ClientAddressSchema, z.null()]).openapi({ description: "The address visits go to now." }),
    credits: z
      .union([z.object({ visits: z.number().int(), earliest_expiry: z.iso.datetime().nullable() }).strict(), z.null()])
      .openapi({ description: "Service visits left and when the soonest expires; null with none left." }),
    visits: RecordVisitsSchema,
    ...RECORD_MONEY,
    history: OpsHistorySchema,
    invite: z
      .union([ClientInviteSchema, z.null()])
      .openapi({ description: "The invite they came with, or ops attached; null for none." }),
    auto_refunds: z
      .array(AutoRefundSchema)
      .openapi({ description: "Bookings that refunded their payment by themselves; the latest refund first." }),
  })
  .strict()
  .openapi("ClientRecord");

const ErasedClientRecordSchema = z
  .object({
    id: z.uuid(),
    erased_at: z.iso.datetime(),
    visits: RecordVisitsSchema.openapi({
      description:
        "Upcoming soonest first; past newest first. No discount code may be entered or taken off: price_open is false.",
    }),
    ...RECORD_MONEY,
  })
  .strict()
  .openapi("ErasedClientRecord", {
    description: "What is kept of a client once erased: their visits and their money. Nothing names them.",
  });
/** The client's visits, each with how it closed, any closing of its task by hand, and its discount code. */
async function recordVisits(db: D1Database, personId: string, now: Date) {
  const visits = await listVisits(db, personId, now);
  const visitIds = [...visits.upcoming, ...visits.past].map((visit) => visit.id);
  const [outcomes, closings, codes] = await Promise.all([
    visitOutcomes(db, visitIds),
    partialVisitsClosed(db, visitIds),
    clientVisitCodes(db, personId),
  ]);
  const withOutcome = (list: typeof visits.upcoming) =>
    list.map((visit) => ({
      ...visit,
      outcome: outcomes.get(visit.id) ?? null,
      closed_without_follow_up: closings.get(visit.id) ?? null,
      discount_code: codes.get(visit.id)?.code ?? null,
      price_open: codes.get(visit.id)?.open ?? false,
      requested_code: codes.get(visit.id)?.requested ?? null,
    }));
  return { upcoming: withOutcome(visits.upcoming), past: withOutcome(visits.past) };
}

/** What is kept of an erased client: their visits, none of them open to a discount code any more, and their money. */
async function erasedRecord(db: D1Database, person: { id: string; erasedAt: string }, now: Date) {
  const personId = person.id;
  const [visits, payments, links, invoices] = await Promise.all([
    recordVisits(db, personId, now),
    paymentEntries(db, personId, now),
    paymentLinksOf(db, personId, now),
    visitInvoicesOf(db, personId),
  ]);
  const closed = (list: typeof visits.upcoming) => list.map((visit) => ({ ...visit, price_open: false }));
  return {
    id: personId,
    erased_at: person.erasedAt,
    visits: { upcoming: closed(visits.upcoming), past: closed(visits.past) },
    payments,
    payment_links: links,
    invoices,
  };
}

const recordRoute = createRoute({
  method: "get",
  path: "/api/clients/{id}",
  summary:
    "The client's record: who they are, their address, their visits, their money, their history and their invite; " +
    "of an erased client, when they were erased, their visits and their money",
  request: { params: clientId },
  responses: {
    200: { description: "The record", ...json(z.union([ClientRecordSchema, ErasedClientRecordSchema])) },
    400: errorResponse("invalid_request: the ID is not one"),
    404: errorResponse("not_found: no such client, or the client is outside the caller's cities"),
  },
});

export function registerOpsClientRecord(app: App): void {
  app.openapi(recordRoute, async (c) => {
    const { id } = c.req.valid("param");
    const db = c.env.DB;
    const person = await anyClientInReach(c, id);
    if (person === null) return refuse(c, "not_found");
    const now = c.var.deps.now();
    if (person.erased_at !== null) {
      return c.json(await erasedRecord(db, { id, erasedAt: person.erased_at }, now), 200);
    }

    const [address, credits, visits, fitted, payments, links, invoices, history, invite, refunded] = await Promise.all([
      currentAddress(db, id),
      creditBalance(db, id, now),
      recordVisits(db, id, now),
      isFitted(db, id),
      paymentEntries(db, id, now),
      paymentLinksOf(db, id, now),
      visitInvoicesOf(db, id),
      clientHistory(db, id),
      clientInviteOf(db, id),
      autoRefundsOf(db, id),
    ]);

    return c.json(
      {
        id: person.id,
        name: person.name,
        mobile: person.mobile_e164,
        // Booked only while a visit is to come: a booking the site's form left that booked nothing is not one.
        state: clientStateOf(fitted, visits.upcoming.length > 0),
        known_since: person.created_at,
        address: address === null ? null : clientAddressOf(address),
        credits: credits.visits > 0 ? { visits: credits.visits, earliest_expiry: credits.earliestExpiry } : null,
        visits,
        payments,
        payment_links: links,
        invoices,
        history,
        invite,
        auto_refunds: refunded.map(autoRefundOf),
      },
      200,
    );
  });
}
