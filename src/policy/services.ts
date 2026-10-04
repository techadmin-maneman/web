// The services clients book: the owner's rulings of 27 September 2026, in the owner's words as
// docs/archive/owner-answers-2026-09-27.md records them ("Services, as the console will hold them"). A service is a kind of
// visit and a tier of it; the kind is code, and the services within it are ops' (the services table,
// docs/decisions/0085-services-ops-can-edit.md). src/domain/services.ts keeps them, and the price book prices each
// by its kind and tier (src/domain/price-book.ts).

import { hasStandardService, STANDARD_TIER, type VisitType } from "../config/visit-types.ts";
import type { OneVisitState } from "./one-visit.ts";

export const RULES = [
  "every service belongs to one of four kinds (consultation, first fit, service visit, replacement), and the kind decides the technician's steps, the booking rules and which fees apply; within a kind ops add, rename, describe, price, reorder and retire services from the console, each synced to Books; a new kind needs a release.",
  "Retiring a service stops clients seeing it from a date and changes nothing already sold; prices stay dated rows.",
] as const;

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

/** The longest a tier's code may be (PRICE_TIER, src/config/ops-settings.ts). */
const CODE_LENGTH = 32;

/**
 * The code a new service is priced under, made from its name: small letters and digits, with _ between words, a
 * letter first. "Premium" is premium, "Lace, front" is lace_front. Null where the name gives none, as one written
 * in another script would; ops then give the code themselves. A code never changes after, whatever the service is
 * renamed to, so its prices stay its own.
 */
export function tierCodeOf(name: string): string | null {
  const code = name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^[^a-z]+/, "")
    .slice(0, CODE_LENGTH)
    .replace(/_+$/, "");
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
