// A day as the console writes it in a list or beside a figure: "22 Aug" in the year it is now, and "22 Aug 2027" in
// any other, so a date this year reads short and one in another year is never mistaken for it.

import { apiNow } from "./clock.ts";
import { listDate, yearInIndia } from "./dates.ts";

export const plainDate = (isoDate: string): string => listDate(isoDate, yearInIndia(apiNow()));
