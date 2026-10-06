// The services clients book. A service is a kind of visit and a tier of it; the kind is code, and the services within it are ops' (the services table,
// docs/decisions/0085-services-ops-can-edit.md). src/domain/booking/services.ts keeps them, and the price book prices each
// by its kind and tier (src/domain/money/price-book.ts).

import { hasStandardService, STANDARD_TIER, type VisitType } from "../config/visit-types.ts";
import type { OneVisitState } from "./one-visit.ts";
import { slugOf } from "../lib/slug.ts";

/**
 * Whether a service is offered on a day (India's date): it is, until the day it is retired from. A visit on that day
 * or after is sold to nobody; one sold before stays as it was sold.
 */
export const isOffered = (retiredDate: string | null, on: string): boolean => retiredDate === null || on < retiredDate;

/**
 * Whether a visit's service says more than its kind, so the technician, ops and the client see it named: a first
 * fit's hair system, say. A kind's standard service is named as the kind is. A one visit is held as the first hair
 * system on offer until the client chooses theirs, so it names none before then.
 */
export function namesMoreThanItsKind(tier: string | null, oneVisit: OneVisitState | null): boolean {
  if (tier === null || tier === STANDARD_TIER) return false;
  return oneVisit !== "booked";
}

/**
 * A service's name, as clients, ops and Books' items read it: a letter or a digit first, so a spreadsheet opening
 * an exported list never reads it as a formula, then letters in any script, digits, spaces and . , ' ( ) & - + /,
 * up to 60.
 */
export const SERVICE_NAME = /^[\p{L}\p{N}][\p{L}\p{M}\p{N} .,'()&+/-]{1,59}$/u;

/** The longest line a service's description may be. */
export const DESCRIPTION_LENGTH = 160;

/**
 * Whether a service's description, trimmed, is one line of up to DESCRIPTION_LENGTH characters. An empty one is: it
 * clears the description.
 */
export const isServiceDescription = (line: string): boolean =>
  line.length <= DESCRIPTION_LENGTH && !/\p{Cc}/u.test(line);

/** A tier names itself: "standard", and whatever the bases are called when the catalogue has them. */
export const PRICE_TIER = /^[a-z][a-z0-9_]{0,31}$/;

/** The longest a tier's code may be (PRICE_TIER). */
const CODE_LENGTH = 32;

/**
 * The code a new service is priced under, made from its name: small letters and digits, with _ between words, a
 * letter first. "Premium" is premium, "Lace, front" is lace_front. Null where the name gives none, as one written
 * in another script would; ops then give the code themselves. A code never changes after, whatever the service is
 * renamed to, so its prices stay its own.
 */
export function tierCodeOf(name: string): string | null {
  const code = slugOf(name, CODE_LENGTH).replace(/^[^a-z]+/, "");
  return code === "" ? null : code;
}

/**
 * Why a service may not be retired from a day: a kind with a standard service keeps one service that is never retired
 * and is priced by then, so it stays bookable whatever ops retire. To replace its last service, the new one is added
 * and priced first. A first fit's hair systems may all be retired: no first fit is then offered until ops add one.
 * Null when it may be retired.
 */
export function retireRefusal(
  kind: VisitType,
  others: readonly { readonly retiredDate: string | null; readonly pricedBy: boolean }[],
): "last_of_kind" | null {
  if (!hasStandardService(kind)) return null;
  return others.some((other) => other.retiredDate === null && other.pricedBy) ? null : "last_of_kind";
}
