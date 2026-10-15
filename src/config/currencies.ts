// A currency's minor unit (ISO 4217): how many decimal places its smallest unit is. A supplier's prices are kept in
// their currency's smallest unit, so a yen price is whole yen and a dinar price thousandths, and converting one to
// paise needs the right power of ten. A currency not listed has two, as most do.

const MINOR_UNIT_DIGITS: Readonly<Record<string, number>> = {
  // No minor unit.
  JPY: 0,
  KRW: 0,
  VND: 0,
  IDR: 0,
  CLP: 0,
  ISK: 0,
  UGX: 0,
  // Three decimal places.
  BHD: 3,
  KWD: 3,
  OMR: 3,
  JOD: 3,
  TND: 3,
  LYD: 3,
  IQD: 3,
};

/** The decimal places of a currency's smallest unit: 2 for rupees and dollars, 0 for yen, 3 for dinars. */
export const minorUnitDigits = (currency: string): number => MINOR_UNIT_DIGITS[currency.toUpperCase()] ?? 2;

/** One rupee in micro-rupees, the unit a supplier's exchange rate is kept in. */
export const MICRO_PER_RUPEE = 1_000_000;

/** One paisa in micro-rupees. */
export const MICRO_PER_PAISA = 10_000;

/**
 * Paise for an amount in a currency's smallest unit, at `rateMicro` micro-rupees to one whole unit of the currency:
 * 1,050 cents at Rs. 83.25 to the dollar is 87,412.5 paise, 100 yen at Rs. 0.56 to the yen is 5,600.
 */
export function paiseOf(amountMinor: number, currency: string, rateMicro: number): number {
  return (amountMinor * rateMicro) / (10 ** minorUnitDigits(currency) * MICRO_PER_PAISA);
}
