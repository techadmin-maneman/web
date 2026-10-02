// GST on what Mane Man sells, for a payment the price book did not price. Off
// (0%) until production: the owner switched GST off in Books on 22 September
// 2026 so billing works end to end on staging, and turns it on for production
// with the real GSTIN and the CA's rates (docs/open-points.md, items 2 and 3).

export const GST_PERCENT = 0;

/** The part of a GST-inclusive amount before GST, in paise. */
export function exGst(amount: number, percent: number = GST_PERCENT): number {
  return Math.round((amount * 100) / (100 + percent));
}

/** An ex-GST amount with GST added, in paise. */
export function withGst(amountExGst: number, percent: number): number {
  return Math.round((amountExGst * (100 + percent)) / 100);
}

/** Mane Man's GST registration, as Books' customers, invoices and items carry it. */
export interface GstRegistration {
  /** Null while GST is off in Books, which then refuses a place of supply or of contact, so none is sent. */
  readonly gstin: string | null;
  /** The GST code of the state registered in, e.g. HR: the place of supply of a client whose city we do not know. */
  readonly stateCode: string | null;
  /** The SAC code the visits are invoiced under, written on each Books item. */
  readonly sac: string | null;
}

/** For the CA to fill in, in the release that turns GST on in Books (docs/open-points.md, items 2 and 3). */
export const GST_REGISTRATION: GstRegistration = { gstin: null, stateCode: null, sac: null };

export interface IndianState {
  readonly name: string;
  /** Its GST code, as Books names a place of supply. */
  readonly code: string;
}

const HARYANA: IndianState = { name: "Haryana", code: "HR" };
const DELHI: IndianState = { name: "Delhi", code: "DL" };
const UTTAR_PRADESH: IndianState = { name: "Uttar Pradesh", code: "UP" };

/** The state each city we serve is in. */
const CITY_STATES: Readonly<Record<string, IndianState>> = {
  Gurgaon: HARYANA,
  Faridabad: HARYANA,
  Delhi: DELHI,
  Noida: UTTAR_PRADESH,
  Ghaziabad: UTTAR_PRADESH,
};

/** The state a city is in; null for a city we do not serve, or none. */
export function stateOf(city: string | null): IndianState | null {
  if (city === null) return null;
  return CITY_STATES[city] ?? null;
}

/**
 * The GST code Books is given as a place of supply or of contact: the city's state, else the state registered in,
 * where no city is known. Null while GST is off.
 */
export function placeOfSupply(city: string | null, registration: GstRegistration): string | null {
  if (registration.gstin === null) return null;
  return stateOf(city)?.code ?? registration.stateCode;
}
