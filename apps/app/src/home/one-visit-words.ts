// What a consultation and fit in one visit costs and how it is paid, as its card says it: the price once fitted,
// only if the client goes ahead, then the code on it, then that a link comes by text.

import { rupees } from "@maneman/web-kit/money";
import type { VisitSummary } from "../api.ts";
import { home } from "../content.ts";

export type OneVisitPrice = NonNullable<VisitSummary["one_visit"]>;

function priceLine(price: OneVisitPrice): string {
  const copy = home.oneVisit;
  if (price.amount === null) return copy.unpriced;
  const amount = rupees(price.amount);
  return price.from ? copy.from(amount) : copy.price(amount);
}

/** The card's lines: "Rs. 45,000, only if you go ahead", "Code AUDTEST applied", "Paid once fitted, by a link …". */
export function oneVisitLines(price: OneVisitPrice): string[] {
  const copy = home.oneVisit;
  const { code } = price;
  if (code !== null && price.amount === 0 && !price.from) return [copy.covered(code)];
  const lines = [priceLine(price)];
  if (code !== null) lines.push(copy.code(code));
  lines.push(copy.paidBy);
  return lines;
}
