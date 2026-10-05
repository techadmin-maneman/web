// What the client's booking and change routes share: the terms a move of one of the client's visits is sold under,
// and starting to pay for a hold.

import { shortDate } from "@maneman/web-kit/dates";
import type { Context } from "hono";
import { VISIT_TYPE_NAMES, type VisitType } from "../config/visit-types.ts";
import { startBooking } from "../domain/bookings.ts";
import { checkoutHold } from "../domain/holds.ts";
import type { Moving } from "../domain/occupancy.ts";
import { changeableVisit, changeTerms, termsInForce, type ChangeTerms } from "../domain/visit-changes.ts";
import { bookHold } from "./book-hold.ts";
import type { AppEnv } from "./context.ts";
import { opsInputs } from "./ops-inputs.ts";

/**
 * The terms for moving one of the client's visits of this type now, and the visit as a move sees it; null if it
 * can no longer be moved in the app. A visit with no technician yet is ops' to move.
 */
export async function moveTermsFor(
  c: Context<AppEnv>,
  personId: string,
  visitId: string,
  type: VisitType | null,
  on?: string,
): Promise<{ terms: ChangeTerms; moving: Moving } | null> {
  const now = c.var.deps.now();
  const visit = await changeableVisit(c.env.DB, personId, visitId, now);
  if (visit === null || (type !== null && visit.type !== type) || visit.technicianId === null) return null;
  const inForce = termsInForce(await opsInputs(c), visit.type);
  return {
    terms: await changeTerms(c.env.DB, visit, now, inForce, on),
    moving: { visitId: visit.id, technicianId: visit.technicianId },
  };
}

/** Starts paying for a live hold: what Checkout opens with, or null for one that is free and sent to be booked. */
export async function startCheckout(c: Context<AppEnv>, holdId: string, personId: string) {
  const { deps } = c.var;
  const started = await startBooking(c.env.DB, deps.payments, holdId, personId, deps.now());
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
