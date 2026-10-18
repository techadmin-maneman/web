// The week around a visit's day that a tie between technicians is weighed over (./start-offers.ts): whoever has the
// least that day, then over the week, so a tie never goes by name. Who may take it at all is
// src/domain/booking/technician-rotation.ts's.

import { addDays } from "../../lib/india-time.ts";

/** Days either side of the visit's own that a tie is weighed over: a week, centred on it. */
const TIE_REACH = 3;

/** The dates a tie on `date` is weighed over, for the occupancy read to cover. */
export const tieRange = (date: string): { readonly from: string; readonly to: string } => ({
  from: addDays(date, -TIE_REACH),
  to: addDays(date, TIE_REACH),
});
