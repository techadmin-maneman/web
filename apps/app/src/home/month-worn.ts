// Which month of its life a hair system is in, as Home's hair system counts it (./HairSystemBlock.tsx), and how long
// one was worn, as Your hair system lists each (./HairSystemScreen.tsx).

/** Whole months from one day to another: 14 Mar to 13 Apr is none, to 14 Apr one. */
function wholeMonths(from: string, to: string): number {
  const part = (date: string, start: number, end: number) => Number(date.slice(start, end));
  return (
    (part(to, 0, 4) - part(from, 0, 4)) * 12 +
    (part(to, 5, 7) - part(from, 5, 7)) -
    (part(to, 8, 10) < part(from, 8, 10) ? 1 : 0)
  );
}

/** The month of its life a hair system is in, from 1, counted from the day it was fitted. */
export const monthWorn = (fittedOn: string, today: string): number => Math.max(1, wholeMonths(fittedOn, today) + 1);

/** How long a hair system was worn, in whole months; 0 for less than one. */
export const monthsWorn = (fittedOn: string, until: string): number => Math.max(0, wholeMonths(fittedOn, until));
