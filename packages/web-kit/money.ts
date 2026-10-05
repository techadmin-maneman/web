// Amounts as the Phase 2 boards write them, "Rs. 2,000", with India's grouping
// ("1,00,000"). The API gives paise; whole rupees drop the paise. The public
// site's own design wrote "₹2,000"; the owner ruled on 27 September 2026 that
// every surface writes "Rs." (ADR 0025, item 51). This is the one place any
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
