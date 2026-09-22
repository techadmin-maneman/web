// Amounts as the Phase 2 designs write them: "Rs. 2,000", "Rs. 35,400", with
// India's grouping ("Rs. 1,00,000"). The API gives paise; whole rupees drop
// the paise.

const grouped = new Intl.NumberFormat("en-IN", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
const withPaise = new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** 200000 → "Rs. 2,000"; 235932 → "Rs. 2,359.32". */
export function rupees(paise: number): string {
  const format = paise % 100 === 0 ? grouped : withPaise;
  return `Rs. ${format.format(paise / 100)}`;
}
