// The services clients book: the owner's rulings of 27 September 2026, in the owner's words as
// docs/owner-answers-2026-09-27.md records them ("Services, as the console will hold them"). A service is a kind of
// visit and a tier of it; the kind is code, and the services within it are ops' (the services table,
// docs/decisions/0085-services-ops-can-edit.md). src/domain/services.ts keeps them, and the price book prices each
// by its kind and tier (src/domain/price-book.ts).

export const RULES = [
  "every service belongs to one of four kinds (consultation, first fit, service visit, replacement), and the kind decides the technician's steps, the booking rules and which fees apply; within a kind ops add, rename, price, reorder and retire services from the console, each synced to FSM; a new kind needs a release.",
  "Retiring a service stops clients seeing it from a date and changes nothing already sold; prices stay dated rows.",
] as const;

/**
 * Whether a service is offered on a day (India's date): it is, until the day it is retired from. A visit on that day
 * or after is sold to nobody; one sold before stays as it was sold.
 */
export const isOffered = (retiredDate: string | null, on: string): boolean => retiredDate === null || on < retiredDate;

/**
 * A service's name, as clients, ops and FSM's catalogue read it: a letter or a digit first, so a spreadsheet opening
 * an exported list never reads it as a formula, then letters in any script, digits, spaces and . , ' ( ) & - + /,
 * up to 60.
 */
export const SERVICE_NAME = /^[\p{L}\p{N}][\p{L}\p{M}\p{N} .,'()&+/-]{1,59}$/u;

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
 * Why a service may not be retired from a day: every kind keeps one service that is never retired and is priced by
 * then, so a kind stays bookable whatever ops retire. To replace a kind's last service, the new one is added and
 * priced first. Null when it may be retired.
 */
export function retireRefusal(
  others: readonly { readonly retiredDate: string | null; readonly pricedBy: boolean }[],
): "last_of_kind" | null {
  return others.some((other) => other.retiredDate === null && other.pricedBy) ? null : "last_of_kind";
}
