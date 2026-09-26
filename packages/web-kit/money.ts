// Amounts as the designs write them, with India's grouping ("1,00,000"). The
// API gives paise; whole rupees drop the paise. The Phase 2 boards write
// "Rs. 2,000"; the public site's design writes "₹2,000", its sign drawn from a
// one-glyph font (packages/brand/fonts.css). The figure is the same under
// both, and this is the one place any front end writes it (VIS-24).

const wholeRupees = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });
const withPaise = new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** 200000 → "2,000"; 10000000 → "1,00,000"; 235932 → "2,359.32": the figure alone. */
export function rupeeFigure(paise: number): string {
  const format = paise % 100 === 0 ? wholeRupees : withPaise;
  return format.format(paise / 100);
}

/** 200000 → "Rs. 2,000", as the Phase 2 boards write an amount. */
export function rupees(paise: number): string {
  return `Rs. ${rupeeFigure(paise)}`;
}

/** 3000000 → "₹30,000", as the public site's design writes a price. */
export function rupeeSign(paise: number): string {
  return `₹${rupeeFigure(paise)}`;
}
