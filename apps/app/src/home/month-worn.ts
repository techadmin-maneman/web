// Which month of its life a hair system is in, as Home's hair system counts it (./HairSystemBlock.tsx).

/** The month of its life a hair system is in, from 1, counted from the day it was fitted. */
export function monthWorn(fittedOn: string, today: string): number {
  const part = (date: string, from: number, to: number) => Number(date.slice(from, to));
  const months =
    (part(today, 0, 4) - part(fittedOn, 0, 4)) * 12 +
    (part(today, 5, 7) - part(fittedOn, 5, 7)) -
    (part(today, 8, 10) < part(fittedOn, 8, 10) ? 1 : 0);
  return Math.max(1, months + 1);
}
