// Amounts as the apps' designs write them, "Rs. 2,000", with India's grouping
// ("1,00,000"). The API gives paise; whole rupees drop the paise. The public
// site's own design wrote "₹2,000", but every surface writes "Rs." (ADR 0025,
// item 51). This is the one place any
// front end, the site included, writes an amount.

const wholeRupees = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });
const withPaise = new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** 200000 → "2,000"; 10000000 → "1,00,000"; 235932 → "2,359.32": the figure alone. */
export function rupeeFigure(paise: number): string {
  const format = paise % 100 === 0 ? wholeRupees : withPaise;
  return format.format(paise / 100);
}

/** 200000 → "Rs. 2,000", as every surface writes an amount. */
export function rupees(paise: number): string {
  return `Rs. ${rupeeFigure(paise)}`;
}

/** "499.50", as a form takes rupees, → 49950: the paise the API counts in, to the nearest paisa. */
export const paiseFromRupees = (typed: string): number => Math.round(Number(typed) * 100);

/**
 * An amount in a supplier's currency, from its smallest unit (docs/decisions/0165-suppliers.md): rupees as every
 * surface writes them, any other currency by its code. 1250 USD → "USD 12.50"; 125000 INR → "Rs. 1,250".
 */
export function inCurrency(minor: number, currency: string): string {
  return currency === "INR" ? rupees(minor) : `${currency} ${withPaise.format(minor / 100)}`;
}
