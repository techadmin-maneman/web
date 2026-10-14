// What a grade is paid for a kind of visit in a city, as the Technician pay page reads it from the rates the API
// answers (docs/decisions/0122-technician-pay-per-visit.md): a city's own rate, else every city's, which stands in.

import { shortDate } from "@maneman/web-kit/dates";
import { rupees } from "@maneman/web-kit/money";
import type { PayKind, PayRate, TechnicianPay } from "../api.ts";
import { technicianPay } from "../content/technician-pay.ts";

const copy = technicianPay.rates;

/** One cell of the table: a grade, a kind of visit, and a city, or null for every city. */
export interface RateCell {
  readonly grade: string;
  readonly kind: PayKind;
  readonly city: string | null;
}

const isCell = (rate: PayRate, cell: RateCell) =>
  rate.grade_id === cell.grade && rate.kind === cell.kind && rate.city === cell.city;

/** The rate in force on `today` for the cell's own city alone, if one is set. */
const ownRate = (rates: readonly PayRate[], cell: RateCell, today: string) =>
  rates.find((rate) => isCell(rate, cell) && rate.effective_from <= today);

/** What the cell pays today, in words: its own rate, every city's standing in for a city, or none. */
export function rateNow(pay: TechnicianPay, cell: RateCell): string {
  const own = ownRate(pay.rates, cell, pay.today);
  if (own?.amount !== undefined && own.amount !== null) return rupees(own.amount);
  if (cell.city === null) return copy.empty;
  const every = ownRate(pay.rates, { ...cell, city: null }, pay.today);
  return every?.amount !== undefined && every.amount !== null ? copy.inherited(rupees(every.amount)) : copy.empty;
}

/** Each rate the cell's own city has set to start later, in words. */
export function ratesLater(pay: TechnicianPay, cell: RateCell): string[] {
  return pay.rates
    .filter((rate) => isCell(rate, cell) && rate.effective_from > pay.today)
    .map((rate) =>
      rate.amount === null
        ? copy.laterNone(shortDate(rate.effective_from))
        : copy.later(rupees(rate.amount), shortDate(rate.effective_from)),
    );
}
