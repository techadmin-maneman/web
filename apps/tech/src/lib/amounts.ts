// So many of a consumable, as a line names it from ops' name for it and the unit the stock counts it in.

import { amountOf } from "@maneman/web-kit/figures";

/**
 * A common name as it reads mid-sentence, "shampoo sachets"; a product's name, with a capital past its first letter,
 * as ops wrote it.
 */
export const midSentence = (name: string): string =>
  /^\p{Lu}[^\p{Lu}]*$/u.test(name) ? name.charAt(0).toLowerCase() + name.slice(1) : name;

/** A unit ops wrote in the plural counts as its one. */
const oneOf = (unit: string): string => unit.replace(/s$/, "");

/** Whether ops' name for a thing says what it is counted in: "Tape strips", counted in strips. */
export function namesItsUnit(name: string, unit: string): boolean {
  const words = name.toLowerCase();
  const one = oneOf(unit);
  return words.endsWith(one) || words.endsWith(`${one}s`);
}

/** So many of a thing counted: "4 tape strips", "1 shampoo sachet", "5 strips of walker tape". */
export function countOf(count: number, unit: string, name: string): string {
  const named = midSentence(name);
  if (!namesItsUnit(name, unit)) return `${amountOf(count, oneOf(unit))} of ${named}`;
  if (count === 1) return `1 ${named.replace(/s$/, "")}`;
  return `${String(count)} ${named.toLowerCase().endsWith("s") ? named : `${named}s`}`;
}
