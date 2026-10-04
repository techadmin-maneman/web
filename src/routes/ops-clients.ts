// One client's record on the ops surface behind Access (Ops Console, B1 to B3;
// docs/decisions/0031-access-and-audit.md):
//   POST /api/clients/search               find a client by their whole mobile number
//   POST /api/clients/find                 find clients by part of a name or of a number
//   GET  /api/clients/:id                  who they are, their address, their visits, their payments, payment links
//                                          and invoices, their history, the invite they came with, any booking FSM
//                                          refused, held for ops, and any booking that refunded its payment by itself
//   GET  /api/clients/:id/photos           which photographs exist, by visit. No links: this is the locked view
//   POST /api/clients/:id/photos/view      open them: one audit entry, and who opened them before
//   GET  /api/clients/:id/photos/:photoId  one photograph, served within a logged opening
//   GET  /api/clients/:id/consents         every consent with its notice version, date and where it was given, and any
//                                          deletion request
//
// A client is always found by their ID. What ops search with goes in a request
// body, never in a path, so that a number stays out of URLs, referrers and logs.
// Each route keeps to the caller's cities: a client elsewhere is not found.
//
// The records are the ones the client reads of themselves, through the same
// domain functions, so the two surfaces cannot drift apart. Of an erased person,
// the record answers only what is kept: when they were erased, their visits,
// their money and any booking still held for them. Every other route here does
// not find them: their photographs, address and details are gone (ADR 0049).

import { createRoute, z } from "@hono/zod-openapi";
import { typedDigits } from "@maneman/web-kit/mobile";
import type { Context } from "hono";
import { staffOf } from "../http/audit.ts";
import type { App, AppEnv } from "../http/context.ts";
import { BOOKING_WINDOWS } from "../config/scheduling.ts";
import { VISIT_TYPES } from "../config/visit-types.ts";
import { earlierViews, logPhotoView, PHOTO_VIEW_MINUTES, viewInForce } from "../domain/photo-views.ts";
import {
  CLIENT_STATES,
  clientStateOf,
  isFitted,
  listVisits,
  ownPhotoKey,
  visitOutcomes,
} from "../domain/client-visits.ts";
import { AUTO_REFUND_REASONS, autoRefundsOf, type AutoRefund } from "../domain/auto-refunds.ts";
import { INVOICE_STATES, LINK_STATES, paymentLinksOf, visitInvoicesOf } from "../domain/client-billing.ts";
import { creditBalance } from "../domain/credits.ts";
import { clientVisitCodes } from "../domain/discount-code-uses.ts";
import { heldBookingsOf, type HeldBooking } from "../domain/held-bookings.ts";
import { reachBinding, withinReach } from "../domain/places.ts";
import { clientInviteOf } from "../domain/referrals.ts";
import { VISIT_OUTCOMES } from "../domain/visit-status.ts";
import { consentRecordsOf, currentAddress, type ConsentState, type SavedAddress } from "../domain/profile.ts";
import { partialVisitsClosed } from "../domain/task-closures.ts";
import { ANGLES, PHASES } from "../domain/visit-photos.ts";
import { errorBody, errorResponse } from "../http/errors.ts";
import { opsInputs } from "../http/ops-inputs.ts";
import { json } from "../http/openapi.ts";
import { routeReach, withinRouteReach } from "../http/staff-access.ts";
import { indiaDate } from "../lib/india-time.ts";
import { INDIAN_MOBILE_PATTERN, toE164 } from "../lib/mobile.ts";
import { CONSENT_PURPOSES, CONSENT_SOURCES } from "../policy/consents.ts";
import type { FsmRetry } from "../policy/held-bookings.ts";
import { clientHistory } from "../domain/client-history.ts";
import { paymentEntries } from "../domain/client-payments.ts";
import { latestProposal } from "../domain/proposed-visits.ts";
import { EntrySchema } from "./client-payments.ts";
import { ClientInviteSchema } from "./ops-client-referral.ts";
import { HISTORY_FIGURES, VisitSummarySchema } from "./client-visits.ts";

const clientId = z.object({ id: z.uuid() });
const unknownClient = errorResponse(
  "not_found: no such client, or the client has been erased or is outside the caller's cities",
);

const nullable = z.union([z.string(), z.null()]);

export const ClientAddressSchema = z
  .object({
    line1: z.string(),
    line2: nullable,
    locality: z.string(),
    city: z.string(),
    pincode: z.string(),
    access_notes: nullable.openapi({ description: "For the technician: gate code, parking and the like." }),
    building: nullable.openapi({ description: "The building as chosen from the suggestions; null if typed." }),
    flat: nullable,
    floor: nullable,
    tower: nullable,
    landmark: nullable,
    given_to_ops: z
      .union([
        z
          .object({
            by: z.string().openapi({ description: "The Access e-mail of the member of staff who saved it." }),
            at: z.iso.datetime(),
          })
          .strict(),
        z.null(),
      ])
      .openapi({ description: "Where the client gave it to ops on the phone: who saved it, and when." }),
  })
  .strict()
  .openapi("ClientAddress");

/** The address visits go to now, as the client's page shows it. */
export const clientAddressOf = (address: SavedAddress) => ({
  line1: address.line1,
  line2: address.line2,
  locality: address.locality,
  city: address.city,
  pincode: address.pincode,
  access_notes: address.accessNotes,
  building: address.building,
  flat: address.flat,
  floor: address.floor,
  tower: address.tower,
  landmark: address.landmark,
  given_to_ops: address.givenToOps === null ? null : { by: address.givenToOps.staff, at: address.givenToOps.at },
});

const ClientVisitSchema = VisitSummarySchema.extend({
  outcome: z
    .union([z.enum(VISIT_OUTCOMES), z.null()])
    .openapi({ description: "What FSM closed the visit as, a no-show being its own; null until it is closed." }),
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
 * task queue already names one (src/domain/tasks.ts).
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

/**
 * A booking FSM refused five times running, held with its slot and its payment until a try books it or ops book it
 * or refund it (docs/decisions/0095-a-booking-fsm-refuses-is-held.md; POST /api/held-bookings/:id/*).
 */
const HeldBookingSchema = z
  .object({
    id: z.uuid().openapi({ description: "The booking's hold, which the three actions name." }),
    type: z.enum(VISIT_TYPES),
    service: z.string().openapi({ description: "Its service's name as it is now." }),
    starts_at: z.iso.datetime().openapi({ description: "When the visit it holds starts." }),
    window: z.enum(BOOKING_WINDOWS),
    paid: z.number().int().openapi({
      description: "In paise, GST included: what Razorpay took; 0 when a credit covers it, or it is free.",
    }),
    uses_credit: z.boolean(),
    moves_visit: z.boolean().openapi({
      description: "It moves a visit already booked: trying FSM again moves it, and there is no new visit to link.",
    }),
    held_at: z.iso.datetime().openapi({ description: "When FSM's fifth refusal running held it." }),
    refusal: z.union([z.string(), z.null()]).openapi({ description: "FSM's latest refusal, as the log gives it." }),
    retries_end: z.iso.datetime().openapi({ description: "When the hourly tries end, or ended, as ops set them." }),
    retrying: z.boolean().openapi({ description: "Still tried every hour: inside its tries, and its visit to come." }),
    discount_code: z
      .union([
        z
          .object({
            code: z.string(),
            amount_off: z
              .union([z.number().int(), z.null()])
              .openapi({ description: "In paise before GST; null until the visit's price is known." }),
          })
          .strict(),
        z.null(),
      ])
      .openapi({ description: "The discount code the client booked with (docs/decisions/0108-discount-codes.md)." }),
  })
  .strict()
  .openapi("HeldBooking");

const HeldBookingsSchema = z
  .array(HeldBookingSchema)
  .openapi({ description: "Bookings FSM refused, waiting for a try or for ops; the soonest visit first." });

const heldBookingOf = (booking: HeldBooking) => ({
  id: booking.id,
  type: booking.type,
  service: booking.serviceName,
  starts_at: booking.startsAt,
  window: booking.window,
  paid: booking.paid,
  uses_credit: booking.usesCredit,
  moves_visit: booking.movesVisit,
  held_at: booking.heldAt,
  refusal: booking.refusal,
  retries_end: booking.retriesEnd,
  retrying: booking.retrying,
  discount_code:
    booking.discountCode === null
      ? null
      : { code: booking.discountCode.code, amount_off: booking.discountCode.amountOff },
});

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
    held_bookings: HeldBookingsSchema,
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
    held_bookings: HeldBookingsSchema,
  })
  .strict()
  .openapi("ErasedClientRecord", {
    description:
      "What is kept of a client once erased: their visits, their money and any booking still held for them. " +
      "Nothing names them.",
  });

const PhotoSchema = z
  .object({
    id: z.uuid().openapi({ description: "For GET /api/clients/{id}/photos/{photo_id}, which is audited." }),
    phase: z.enum(PHASES),
    angle: z.enum(ANGLES),
    width: z.union([z.number().int(), z.null()]),
    height: z.union([z.number().int(), z.null()]),
    taken_at: z.iso.datetime(),
  })
  .strict()
  .openapi("ClientPhoto");

const ClientPhotosSchema = z
  .object({
    visits: z.array(
      z
        .object({
          visit_id: z.uuid(),
          date: z.iso.date(),
          type: z.union([z.enum(VISIT_TYPES), z.null()]),
          technician: z.union([z.object({ name: z.string(), initials: z.string() }).strict(), z.null()]),
          photos: z.array(PhotoSchema).openapi({ description: "Before then after, each in the design's angle order." }),
        })
        .strict(),
    ),
  })
  .strict()
  .openapi("ClientPhotos");

const ClientConsentsSchema = z
  .object({
    consents: z.array(
      z
        .object({
          purpose: z.enum(CONSENT_PURPOSES),
          state: z.enum(["given", "withdrawn", "not_given"]).openapi({
            description: "not_given until the client first switches it on; withdrawn once they switch it back off.",
          }),
          notice_version: z
            .union([z.string(), z.null()])
            .openapi({ description: "The notice the client saw when they last switched it." }),
          at: z.union([z.iso.datetime(), z.null()]).openapi({ description: "When they last switched it." }),
          source: z.union([z.enum(CONSENT_SOURCES), z.null()]).openapi({
            description:
              "Where they last switched it. null when never switched, or when no place was kept: given before this release reached the environment on a notice shown in more than one place, written by the Worker it replaced between its migration and its deploy, or switched from a copy of the app loaded before it, which names no screen.",
          }),
        })
        .strict(),
    ),
    deletion: z
      .union([
        z
          .object({
            id: z.uuid(),
            state: z.enum(["requested", "rejected"]),
            requested_at: z.iso.datetime(),
            decided_at: z.union([z.iso.datetime(), z.null()]),
          })
          .strict(),
        z.null(),
      ])
      .openapi({ description: "Their latest deletion request. A processed one leaves no client to read." }),
  })
  .strict()
  .openapi("ClientConsents");

const searchRoute = createRoute({
  method: "post",
  path: "/api/clients/search",
  summary: "Find a client by mobile number. A POST, so the number stays out of the URL",
  request: {
    body: {
      required: true,
      ...json(
        z
          .object({ mobile: z.string().regex(INDIAN_MOBILE_PATTERN) })
          .strict()
          .openapi("ClientSearch"),
      ),
    },
  },
  responses: {
    200: {
      description: "The client, to open their page with",
      ...json(z.object({ id: z.uuid(), name: z.string(), mobile: z.string() }).strict()),
    },
    400: errorResponse("invalid_request: not an Indian mobile number"),
    404: unknownClient,
  },
});

/** The most clients one search lists; past that, more letters or digits narrow it. */
export const CLIENTS_FOUND = 20;
/** A name is searched from two letters, a number from four digits, so no search lists everybody. */
const NAME_MIN = 2;
const DIGITS_MIN = 4;

const findRoute = createRoute({
  method: "post",
  path: "/api/clients/find",
  summary:
    "Find clients by part of a name, or four or more digits of a number. A POST, so the words stay out of the URL",
  request: {
    body: {
      required: true,
      ...json(
        z
          .object({
            text: z
              .string()
              .trim()
              .max(60)
              .refine((text) => searchOf(text) !== null, `${String(NAME_MIN)} letters or ${String(DIGITS_MIN)} digits`)
              .openapi({ description: "Any part of a name, or of a number typed any of the usual ways." }),
          })
          .strict()
          .openapi("ClientFind"),
      ),
    },
  },
  responses: {
    200: {
      description: "The clients it matches in the caller's cities, by name",
      ...json(
        z
          .object({
            clients: z.array(z.object({ id: z.uuid(), name: z.string(), mobile: z.string() }).strict()),
            more: z.boolean().openapi({ description: `More than ${String(CLIENTS_FOUND)} match: narrow the search.` }),
          })
          .strict()
          .openapi("ClientsFound"),
      ),
    },
    400: errorResponse("invalid_request: fewer than two letters or four digits"),
  },
});

const recordRoute = createRoute({
  method: "get",
  path: "/api/clients/{id}",
  summary:
    "The client's record: who they are, their address, their visits, their money, their history and their invite; " +
    "of an erased client, when they were erased, their visits, their money and any booking still held for them",
  request: { params: clientId },
  responses: {
    200: { description: "The record", ...json(z.union([ClientRecordSchema, ErasedClientRecordSchema])) },
    404: errorResponse("not_found: no such client, or the client is outside the caller's cities"),
  },
});

const photosRoute = createRoute({
  method: "get",
  path: "/api/clients/{id}/photos",
  summary: "Which photographs the client has, by visit, newest first. No image is served here",
  request: { params: clientId },
  responses: { 200: { description: "Visits that have photographs", ...json(ClientPhotosSchema) }, 404: unknownClient },
});

const viewRoute = createRoute({
  method: "post",
  path: "/api/clients/{id}/photos/view",
  summary: "Open the client's photographs: one audit entry, written before any image is served",
  request: { params: clientId },
  responses: {
    200: {
      description: "Logged",
      ...json(
        z
          .object({
            logged_at: z.iso.datetime().openapi({ description: "When the opening was logged, by our clock." }),
            before: z
              .array(z.object({ by: z.string(), at: z.iso.datetime() }).strict())
              .openapi({ description: "Who opened them before, and when, the latest first." }),
          })
          .strict()
          .openapi("PhotoView"),
      ),
    },
    404: unknownClient,
    503: errorResponse("unavailable: the opening could not be logged, so nothing is shown"),
  },
});

const photoRoute = createRoute({
  method: "get",
  path: "/api/clients/{id}/photos/{photo_id}",
  summary: `One of the client's photographs, within an opening logged in the last ${String(PHOTO_VIEW_MINUTES)} minutes; asked for outside one, it logs one first`,
  request: { params: clientId.extend({ photo_id: z.uuid() }) },
  responses: {
    200: {
      description: "The image",
      content: { "image/jpeg": { schema: z.string() }, "image/png": { schema: z.string() } },
    },
    404: errorResponse("not_found: no such photograph of this client's"),
    503: errorResponse("unavailable: the view could not be audited, so no photograph is served"),
  },
});

const consentsRoute = createRoute({
  method: "get",
  path: "/api/clients/{id}/consents",
  summary: "The client's consents and any deletion request. Ops read them and never grant one",
  request: { params: clientId },
  responses: { 200: { description: "Consents and data", ...json(ClientConsentsSchema) }, 404: unknownClient },
});

/** What a search looks in: the number, when it is digits as a number is typed, else the name. */
type Search = { readonly by: "number" | "name"; readonly text: string };

function searchOf(typed: string): Search | null {
  const digits = typed.replace(/[\s+-]/g, "");
  if (/^\d+$/.test(digits)) return digits.length >= DIGITS_MIN ? { by: "number", text: typedDigits(digits) } : null;
  return typed.length >= NAME_MIN ? { by: "name", text: typed } : null;
}

/** A purpose as the console shows it: given, never given, or given and then withdrawn. */
function consentStateOf(consent: ConsentState): "given" | "not_given" | "withdrawn" {
  if (consent.granted) return "given";
  return consent.since === null ? "not_given" : "withdrawn";
}

/** A LIKE pattern for text anywhere in the column, with LIKE's own wildcards taken as themselves. */
const containing = (text: string): string => `%${text.replace(/[\\%_]/g, (character) => `\\${character}`)}%`;

interface PersonRow {
  id: string;
  name: string;
  mobile_e164: string;
  created_at: string;
}

/** The client by ID, erased or not; null when there is no such person or they are outside the caller's cities. */
async function anyClientInReach(
  c: Context<AppEnv>,
  id: string,
): Promise<(PersonRow & { erased_at: string | null }) | null> {
  const person = await c.env.DB.prepare("SELECT id, name, mobile_e164, created_at, erased_at FROM people WHERE id = ?1")
    .bind(id)
    .first<PersonRow & { erased_at: string | null }>();
  if (person === null || !(await withinRouteReach(c, "client", id))) return null;
  return person;
}

/** The client by ID; null when there is no such person, they were erased, or they are outside the caller's cities. */
export async function clientInReach(c: Context<AppEnv>, id: string): Promise<PersonRow | null> {
  const person = await anyClientInReach(c, id);
  return person?.erased_at === null ? person : null;
}

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

/**
 * What is kept of an erased client: their visits, none of them open to a discount code any more, their money, and any
 * booking FSM refused that is still held for them, for ops to refund.
 */
async function erasedRecord(db: D1Database, person: { id: string; erasedAt: string }, now: Date, retry: FsmRetry) {
  const personId = person.id;
  const [visits, payments, links, invoices, held] = await Promise.all([
    recordVisits(db, personId, now),
    paymentEntries(db, personId, now),
    paymentLinksOf(db, personId, now),
    visitInvoicesOf(db, personId),
    heldBookingsOf(db, personId, now, retry),
  ]);
  const closed = (list: typeof visits.upcoming) => list.map((visit) => ({ ...visit, price_open: false }));
  return {
    id: personId,
    erased_at: person.erasedAt,
    visits: { upcoming: closed(visits.upcoming), past: closed(visits.past) },
    payments,
    payment_links: links,
    invoices,
    held_bookings: held.map(heldBookingOf),
  };
}

interface PhotoListRow {
  id: string;
  appointment_id: string;
  window_start: string;
  type: (typeof VISIT_TYPES)[number] | null;
  technician_name: string | null;
  technician_initials: string | null;
  phase: (typeof PHASES)[number];
  angle: (typeof ANGLES)[number];
  width: number | null;
  height: number | null;
  taken_at: string;
}

export function registerOpsClients(app: App): void {
  app.openapi(searchRoute, async (c) => {
    const mobile = toE164(c.req.valid("json").mobile);
    if (mobile === null) return c.json(errorBody("invalid_request", c.var.requestId, ["mobile"]), 400);
    const person = await c.env.DB.prepare(
      "SELECT id, name, mobile_e164, created_at FROM people WHERE mobile_e164 = ?1 AND erased_at IS NULL",
    )
      .bind(mobile)
      .first<PersonRow>();
    if (person === null || !(await withinRouteReach(c, "client", person.id))) {
      return c.json(errorBody("not_found", c.var.requestId), 404);
    }
    return c.json({ id: person.id, name: person.name, mobile: person.mobile_e164 }, 200);
  });

  app.openapi(findRoute, async (c) => {
    const search = searchOf(c.req.valid("json").text);
    if (search === null) return c.json(errorBody("invalid_request", c.var.requestId, ["text"]), 400);
    const column = search.by === "number" ? "mobile_e164" : "name";
    const reached = await routeReach(c);
    const { results } = await c.env.DB.prepare(
      `SELECT client.id, client.name, client.mobile_e164 FROM people client
       WHERE client.erased_at IS NULL AND client.${column} LIKE ?1 ESCAPE '\\'
         AND ${withinReach("client", "client", "?3")}
       ORDER BY client.name, client.id LIMIT ?2`,
    )
      .bind(containing(search.text), CLIENTS_FOUND + 1, reachBinding(reached))
      .all<{ id: string; name: string; mobile_e164: string }>();
    return c.json(
      {
        clients: results
          .slice(0, CLIENTS_FOUND)
          .map((row) => ({ id: row.id, name: row.name, mobile: row.mobile_e164 })),
        more: results.length > CLIENTS_FOUND,
      },
      200,
    );
  });

  app.openapi(recordRoute, async (c) => {
    const { id } = c.req.valid("param");
    const db = c.env.DB;
    const person = await anyClientInReach(c, id);
    if (person === null) return c.json(errorBody("not_found", c.var.requestId), 404);
    const now = c.var.deps.now();
    const retry = (await opsInputs(c)).fsmRetry;
    if (person.erased_at !== null) {
      return c.json(await erasedRecord(db, { id, erasedAt: person.erased_at }, now, retry), 200);
    }

    const [address, credits, visits, fitted, payments, links, invoices, history, proposal, invite, held, refunded] =
      await Promise.all([
        currentAddress(db, id),
        creditBalance(db, id, now),
        recordVisits(db, id, now),
        isFitted(db, id),
        paymentEntries(db, id, now),
        paymentLinksOf(db, id, now),
        visitInvoicesOf(db, id),
        clientHistory(db, id),
        // A Phase 1 booking still waiting for FSM makes the person a lead, as it does on /api/me.
        latestProposal(db, id),
        clientInviteOf(db, id),
        heldBookingsOf(db, id, now, retry),
        autoRefundsOf(db, id),
      ]);

    return c.json(
      {
        id: person.id,
        name: person.name,
        mobile: person.mobile_e164,
        state: clientStateOf(fitted, visits.upcoming.length > 0 || proposal !== null),
        known_since: person.created_at,
        address: address === null ? null : clientAddressOf(address),
        credits: credits.visits > 0 ? { visits: credits.visits, earliest_expiry: credits.earliestExpiry } : null,
        visits,
        payments,
        payment_links: links,
        invoices,
        history,
        invite,
        held_bookings: held.map(heldBookingOf),
        auto_refunds: refunded.map(autoRefundOf),
      },
      200,
    );
  });

  app.openapi(photosRoute, async (c) => {
    const { id } = c.req.valid("param");
    const db = c.env.DB;
    if ((await clientInReach(c, id)) === null) return c.json(errorBody("not_found", c.var.requestId), 404);

    const { results } = await db
      .prepare(
        `SELECT p.id, s.appointment_id, s.phase, p.angle, p.width, p.height, p.taken_at,
           a.window_start, a.type, t.name AS technician_name, t.initials AS technician_initials
         FROM photos p
         JOIN photo_sets s ON s.id = p.photo_set_id
         JOIN appointments a ON a.id = s.appointment_id
         LEFT JOIN technicians t ON t.id = a.technician_id
         WHERE a.person_id = ?1 AND a.deleted_at IS NULL AND a.window_start IS NOT NULL
         ORDER BY a.window_start DESC`,
      )
      .bind(id)
      .all<PhotoListRow>();

    // The rows arrive newest visit first; each visit keeps that order, and its
    // photographs are sorted before then after, each in the design's angle order.
    const byVisit = new Map<string, { visit: PhotoListRow; photos: PhotoListRow[] }>();
    for (const row of results) {
      const group = byVisit.get(row.appointment_id) ?? { visit: row, photos: [] };
      group.photos.push(row);
      byVisit.set(row.appointment_id, group);
    }
    const order = (row: PhotoListRow) => PHASES.indexOf(row.phase) * ANGLES.length + ANGLES.indexOf(row.angle);

    return c.json(
      {
        visits: [...byVisit.values()].map(({ visit, photos }) => ({
          visit_id: visit.appointment_id,
          date: indiaDate(new Date(visit.window_start)),
          type: visit.type,
          technician:
            visit.technician_name === null || visit.technician_initials === null
              ? null
              : { name: visit.technician_name, initials: visit.technician_initials },
          photos: photos.sort((a, b) => order(a) - order(b)).map(photoOf),
        })),
      },
      200,
    );
  });

  app.openapi(viewRoute, async (c) => {
    const { id } = c.req.valid("param");
    const db = c.env.DB;
    if ((await clientInReach(c, id)) === null) return c.json(errorBody("not_found", c.var.requestId), 404);
    const now = c.var.deps.now();
    try {
      await logPhotoView(db, { personId: id, actor: staffOf(c), requestId: c.var.requestId, now });
    } catch (error) {
      c.var.log.error("audit_write_failed", { action: "photo.view", error });
      return c.json(errorBody("unavailable", c.var.requestId), 503);
    }
    return c.json({ logged_at: now.toISOString(), before: await earlierViews(db, id, now) }, 200);
  });

  app.openapi(photoRoute, async (c) => {
    const { id, photo_id: photoId } = c.req.valid("param");
    const db = c.env.DB;
    if ((await clientInReach(c, id)) === null) return c.json(errorBody("not_found", c.var.requestId), 404);
    // The same lookup the client's own photographs go through: a photograph of
    // anyone else is not found, whatever ID is asked for.
    const photo = await ownPhotoKey(db, id, photoId);
    if (photo === null) return c.json(errorBody("not_found", c.var.requestId), 404);

    // Within an opening already logged, the image goes; outside one, the opening
    // is logged first, and a failure serves no photograph (ADR 0031).
    const staff = staffOf(c);
    const now = c.var.deps.now();
    if (!(await viewInForce(db, id, staff, now))) {
      try {
        await logPhotoView(db, { personId: id, actor: staff, requestId: c.var.requestId, now });
      } catch (error) {
        c.var.log.error("audit_write_failed", { action: "photo.view", error });
        return c.json(errorBody("unavailable", c.var.requestId), 503);
      }
    }

    const object = await c.env.CLIENT_PHOTOS.get(photo.key);
    if (object === null) return c.json(errorBody("not_found", c.var.requestId), 404);
    return new Response(object.body, {
      headers: { "Content-Type": photo.contentType, "Cache-Control": "private, no-store" },
    });
  });

  app.openapi(consentsRoute, async (c) => {
    const { id } = c.req.valid("param");
    const db = c.env.DB;
    if ((await clientInReach(c, id)) === null) return c.json(errorBody("not_found", c.var.requestId), 404);

    const [consents, deletion] = await Promise.all([
      consentRecordsOf(db, id),
      db
        .prepare(
          `SELECT id, state, created_at, decided_at FROM deletion_requests
           WHERE person_id = ?1 AND state != 'done' ORDER BY created_at DESC LIMIT 1`,
        )
        .bind(id)
        .first<{ id: string; state: "requested" | "rejected"; created_at: string; decided_at: string | null }>(),
    ]);
    return c.json(
      {
        consents: consents.map((consent) => ({
          purpose: consent.purpose,
          state: consentStateOf(consent),
          notice_version: consent.noticeVersion,
          at: consent.since,
          source: consent.source,
        })),
        deletion:
          deletion === null
            ? null
            : {
                id: deletion.id,
                state: deletion.state,
                requested_at: deletion.created_at,
                decided_at: deletion.decided_at,
              },
      },
      200,
    );
  });
}

const photoOf = (row: PhotoListRow) => ({
  id: row.id,
  phase: row.phase,
  angle: row.angle,
  width: row.width,
  height: row.height,
  taken_at: row.taken_at,
});
