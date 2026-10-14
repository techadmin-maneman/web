// Figures as the apps write them: a quantity in India's grouping, and a distance in metres or kilometres.

/** 1234.5 → "1,234.5", 100000 → "1,00,000": a count or a measure, to one decimal at most. */
export const quantity = (value: number): string => value.toLocaleString("en-IN", { maximumFractionDigits: 1 });

/** 240 → "240 m", 1400 → "1.4 km": how far, from metres. */
export function distance(metres: number): string {
  return metres < 1000 ? `${String(Math.round(metres))} m` : `${(metres / 1000).toFixed(1)} km`;
}
