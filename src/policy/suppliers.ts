// What a supplier's record holds (docs/decisions/0165-suppliers.md): the shapes the console checks before anything is
// written, and the bounds on its terms. No price is set here: every price is the supplier's, as ops record it.

/** India's GST number: state, PAN, entity, Z, check. */
export const GSTIN = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

/** A company's Corporate Identification Number: listed or not, industry, state, year, kind of company, number. */
export const CIN = /^[LU]\d{5}[A-Z]{2}\d{4}[A-Z]{3}\d{6}$/;

/** ISO 3166 alpha-2. */
export const COUNTRY = /^[A-Z]{2}$/;

/** ISO 4217. */
export const CURRENCY = /^[A-Z]{3}$/;

/** The longest a supplier's terms, warranty or lead time may run, in days, and the largest figures an item takes. */
export const SUPPLIER_BOUNDS = {
  paymentTermsDays: 365,
  warrantyDays: 3650,
  leadTimeDays: 365,
  packSize: 10_000,
  minimumOrder: 100_000,
  /** One unit's price, in the currency's smallest unit. */
  unitPrice: 100_000_000,
} as const;
