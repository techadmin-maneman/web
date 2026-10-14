// A credit a client spent on a visit, as booking the visit spends one (src/domain/money/credits.ts,
// redeemCreditForBooking): through the hold the visit was booked from, or a hold booked as it where the test made
// none, from the grant that expires soonest.

import { env } from "cloudflare:workers";
import { redeemCreditForBooking } from "../../../src/domain/money/credits.ts";
import { NOW } from "../clock.ts";
import { aHold } from "./holds.ts";
import { AT } from "./rows.ts";
import { aTechnician } from "./technicians.ts";

async function bookedFrom(personId: string, appointmentId: string): Promise<string> {
  const held = await env.DB.prepare("SELECT id FROM slot_holds WHERE appointment_id = ?1 AND state = 'booked'")
    .bind(appointmentId)
    .first<string>("id");
  if (held !== null) return held;
  const technician = await aTechnician();
  const hold = await aHold({
    person_id: personId,
    technician_id: String(technician.id),
    state: "booked",
    appointment_id: appointmentId,
    use_credit: 1,
  });
  return String(hold.id);
}

export async function aCreditSpent(personId: string, appointmentId: string): Promise<void> {
  const holdId = await bookedFrom(personId, appointmentId);
  await redeemCreditForBooking(env.DB, { holdId, personId, madeAt: AT }, NOW).run();
}
