// Figures as the apps write them: a quantity in India's grouping, an amount in its unit, and a distance in metres or
// kilometres.

/** 1234.5 → "1,234.5", 100000 → "1,00,000": a count or a measure, to one decimal at most. */
export const quantity = (value: number): string => value.toLocaleString("en-IN", { maximumFractionDigits: 1 });

/** Units of measure, which never take a plural: "5 ml", not "5 mls". */
const MEASURES = new Set(["ml", "l", "g", "kg", "mg", "cm", "mm", "m", "in"]);

/** 1, "piece" → "1 piece"; 6, "piece" → "6 pieces"; 172, "strip" → "172 strips"; 5, "ml" → "5 ml". */
export function amountOf(value: number, unit: string): string {
  const one = Math.abs(value) === 1 || MEASURES.has(unit) || unit === "";
  const plural = /(s|x|ch|sh)$/.test(unit) ? `${unit}es` : `${unit}s`;
  return `${quantity(value)} ${one ? unit : plural}`.trim();
}

/** 240 → "240 m", 1400 → "1.4 km": how far, from metres. */
export function distance(metres: number): string {
  return metres < 1000 ? `${String(Math.round(metres))} m` : `${(metres / 1000).toFixed(1)} km`;
}
