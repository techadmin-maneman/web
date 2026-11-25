// What a visit costs the client now, on its card: what is left to pay at it, that it is paid ahead (or covered by a
// free service visit, which the API flags alike), or a consultation's nothing. Null where there is nothing to say.

import { rupees } from "@maneman/web-kit/money";
import type { VisitSummary } from "../api.ts";
import { home, visits, withGst } from "../content.ts";

/** What is left to pay at a visit, GST in it: "Pay Rs. 2,200 including GST at the visit". */
export const payAtVisitLine = (amount: number): string => visits.payAtVisit(withGst(rupees(amount)));

export function paidLine(visit: Pick<VisitSummary, "pay_at_visit" | "prepaid" | "type">): string | null {
  if (visit.pay_at_visit !== null) return payAtVisitLine(visit.pay_at_visit);
  if (visit.prepaid) return home.next.paid;
  return visit.type === "consultation" ? home.next.free : null;
}
