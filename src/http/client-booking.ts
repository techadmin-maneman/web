// What the client's booking and change routes share: the days and the service a client may book, the terms a move
// of one of the client's visits is sold under, and starting to pay for a hold.

import { shortDate } from "@maneman/web-kit/dates";
import type { Context } from "hono";
import { type VisitType, VISIT_TYPE_NAMES } from "../config/visit-types.ts";
import { bookableTypes } from "../domain/booking/availability.ts";
import { startBooking } from "../domain/booking/bookings.ts";
import { checkoutHold } from "../domain/booking/holds.ts";
import type { Moving } from "../domain/booking/occupancy.ts";
import { type PricedService, bookableService, offeredProducts, serviceOf } from "../domain/booking/services.ts";
import { type Price, lateFeeOn } from "../domain/money/price-book.ts";
import type { OpsInputs } from "../domain/ops/ops-settings.ts";
import { bookableDays } from "../domain/visits/next-visit.ts";
import {
  type ChangeableVisit,
  type ChangeTerms,
  changeableVisit,
  changeTerms,
  termsInForce,
} from "../domain/visits/visit-changes.ts";
import { type SoldTerms, LATE_FEES } from "../policy/moving-a-visit.ts";
import { bookHold } from "./book-hold.ts";
import type { AppEnv } from "./context.ts";
import { opsInputs } from "./ops-inputs.ts";

/**
 * The terms for moving one of the client's visits of this type now, and the visit as a move sees it; null if it
 * can no longer be moved in the app. A visit with no technician yet is ops' to move.
 */
export async function moveTermsFor({
  c,
  personId,
  visitId,
  type,
  on,
}: {
  c: Context<AppEnv>;
  personId: string;
  visitId: string;
  type: VisitType | null;
  on?: string;
}): Promise<{ terms: ChangeTerms; moving: Moving } | null> {
  const now = c.var.deps.now();
  const visit = await changeableVisit(c.env.DB, personId, visitId, now);
  if (visit === null || (type !== null && visit.type !== type) || visit.technicianId === null) return null;
  const inForce = termsInForce(await opsInputs(c), visit.type);
  return {
    terms: await changeTerms({ db: c.env.DB, visit, now, inForce, on }),
    moving: { visitId: visit.id, technicianId: visit.technicianId },
  };
}

/** Starts paying for a live hold: what Checkout opens with, or null for one that is free and sent to be booked. */
export async function startCheckout(c: Context<AppEnv>, holdId: string, personId: string) {
  const { deps } = c.var;
  const started = await startBooking({ db: c.env.DB, payments: deps.payments, now: deps.now() }, holdId, personId);
  if (started === null) return null;
  if (started.kind === "free") {
    await bookHold(c, holdId);
    return { hold_id: holdId, checkout: null };
  }
  const row = await checkoutHold(c.env.DB, holdId);
  if (row === null) return null;
  // "Mane Man Natural · Sat 3 Oct", or "Moving your visit to Sat 3 Oct".
  const day = shortDate(row.date);
  const name = row.service_name ?? VISIT_TYPE_NAMES[row.type];
  const description = row.move_kind === "move" ? `Moving your visit to ${day}` : `${name} · ${day}`;
  return {
    hold_id: holdId,
    checkout: {
      key_id: c.var.config.settings.razorpay?.keyId ?? "",
      order_id: started.orderId,
      amount: row.amount,
      currency: "INR" as const,
      name: "Mane Man",
      description,
      prefill: { name: row.name, contact: row.mobile_e164 },
    },
  };
}

/** The days this client may book a visit of this type on, by the figures ops set (src/domain/visits/next-visit.ts). */
export const rangeFor = async (c: Context<AppEnv>, personId: string, type: VisitType) =>
  bookableDays({ db: c.env.DB, personId, type, now: c.var.deps.now(), days: (await opsInputs(c)).nextVisitDays });
/**
 * The service a client may book, offered that day with its price then: of a kind they may book now, the tier named,
 * or the kind's standard one where they name none. Else why not: no_product for a first fit on a day the console
 * offers no hair system, not_bookable for anything else.
 */
export async function bookable(
  c: Context<AppEnv>,
  personId: string,
  wanted: { readonly type: VisitType; readonly tier: string | undefined },
  on: string,
): Promise<PricedService | "no_product" | "not_bookable"> {
  const db = c.env.DB;
  const [types, service] = await Promise.all([
    bookableTypes(db, personId),
    bookableService(db, wanted.type, wanted.tier, on),
  ]);
  if (!types.includes(wanted.type)) return "not_bookable";
  if (service !== null) return service;
  const noProduct = wanted.type === "first_fit" && (await offeredProducts(db, on)).length === 0;
  return noProduct ? "no_product" : "not_bookable";
}

/** A moved visit's own service, by its name as it is now, with the length the visit keeps. */
export async function movedService(c: Context<AppEnv>, visit: ChangeableVisit) {
  const service = await serviceOf(c.env.DB, visit.type, visit.tier);
  return { tier: visit.tier, name: service?.name ?? VISIT_TYPE_NAMES[visit.type], minutes: visit.minutes };
}

/**
 * What a hold is sold under: a move in place carries the moved visit's own terms and late fee to its new time, since
 * it is the same visit, sold once; any other hold, a new booking or a charged move's new visit, is sold under the
 * terms in force and its kind's late fee on its day (docs/decisions/0088-every-policy-in-the-console.md).
 */
export async function soldAs(
  c: Context<AppEnv>,
  hold: { type: VisitType; date: string; move: ChangeTerms | null; kind: "move" | "replace" | null },
  inputs: OpsInputs,
): Promise<{ terms: SoldTerms; lateFee: Price | null }> {
  if (hold.move !== null && hold.kind === "move") return { terms: hold.move.sold, lateFee: hold.move.lateFee };
  const lateFeeItem = LATE_FEES[hold.type];
  return {
    terms: termsInForce(inputs, hold.type),
    lateFee: lateFeeItem === undefined ? null : await lateFeeOn(c.env.DB, lateFeeItem, hold.date),
  };
}
