// GST arithmetic, in paise. The rate is always the one a price was sold at:
// there is no default, so nothing is split at a rate nobody recorded.

/** The part of a GST-inclusive amount before GST. */
export function exGst(amount: number, percent: number): number {
  return Math.round((amount * 100) / (100 + percent));
}

/** An ex-GST amount with GST added. */
export function withGst(amountExGst: number, percent: number): number {
  return Math.round((amountExGst * (100 + percent)) / 100);
}

/**
 * Mane Man's GST registration, as Books' customers, invoices and items carry it. Set in BOOKS_GSTIN, BOOKS_GST_STATE
 * and BOOKS_SAC (src/config/settings.ts).
 */
export interface GstRegistration {
  /** Null while GST is off in Books, which then refuses a place of supply or of contact, so none is sent. */
  readonly gstin: string | null;
  /** The GST code of the state registered in, e.g. HR: the place of supply of a client whose city we do not know. */
  readonly stateCode: string | null;
  /** The SAC code the visits are invoiced under, written on each Books item. */
  readonly sac: string | null;
}

/** GST off in Books, and wherever Books is not Zoho's. */
export const NO_GST: GstRegistration = { gstin: null, stateCode: null, sac: null };

/** Two digits of state, the ten of a PAN, an entity number, Z and a check character, e.g. 06AAACM1234A1Z5. */
export const GSTIN_FORMAT = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
/** A state's GST code, as Books names a place of supply, e.g. HR. */
export const STATE_CODE_FORMAT = /^[A-Z]{2}$/;
/** Services' accounting codes are six digits, e.g. 999721. */
export const SAC_FORMAT = /^[0-9]{6}$/;

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
