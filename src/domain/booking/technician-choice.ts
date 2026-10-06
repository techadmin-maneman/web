// Who takes a hold among the technicians free for it: whoever holds the least that day, then whoever holds the least
// over the week around it, so a tie never goes by name. Who may take it at all is src/domain/booking/technician-rotation.ts's.

import { addDays } from "../../lib/india-time.ts";

/** Days either side of the visit's own that a tie is weighed over: a week, centred on it. */
const TIE_REACH = 3;

/** The dates a tie on `date` is weighed over, for the occupancy read to cover. */
export const tieRange = (date: string): { readonly from: string; readonly to: string } => ({
  from: addDays(date, -TIE_REACH),
  to: addDays(date, TIE_REACH),
});

type Held = (technicianId: string, date: string) => { readonly units: ReadonlySet<number> };
type Candidate = { readonly technician: { readonly id: string } };

/** The order to try technicians in for a hold on `date`, as a sort's compare. */
export function inTakingOrder(held: Held, date: string) {
  const days = Array.from({ length: TIE_REACH * 2 + 1 }, (_, day) => addDays(date, day - TIE_REACH));
  const around = (technicianId: string) => days.reduce((sum, day) => sum + held(technicianId, day).units.size, 0);
  return (a: Candidate, b: Candidate) =>
    held(a.technician.id, date).units.size - held(b.technician.id, date).units.size ||
    around(a.technician.id) - around(b.technician.id);
}
