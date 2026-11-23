// The Tasks board's calls to mm-api: a task's owner, a task closed, a payment link sent again, and the alerts that need
// a hand. Each is the console's client's (../api.ts), one function a route, so a call is found, and changed, in one
// place.

import { client, type TaskGroup, type ClosableGroup } from "../api.ts";
import type { Department } from "@rules/policy/access.ts";

export const tasksApi = {
  /** A task made a member of staff's, by their Access e-mail, or nobody's with null (ADR 0092). */
  setTaskOwner: (group: TaskGroup["group"], id: string, owner: string | null) =>
    client.put("/api/tasks/{group}/{id}/owner", { path: { group, id }, body: { owner } }),
  /**
   * A visit left partly done, closed without a follow-up; the reason is kept with it, under the caller's name. A
   * guarantee claim's may say why its hair system failed, which marks it failed (ADR 0273).
   */
  closeTask: (group: ClosableGroup, id: string, reason: string, failure: string | null = null) =>
    client.post("/api/tasks/{group}/{id}/close", {
      path: { group, id },
      body: failure === null ? { reason } : { reason, failure_reason: failure },
    }),
  /** A task written by hand for a department, about a client or the city chosen (ADR 0302). */
  writeTask: (task: {
    what: string;
    department: Department;
    client: string | null;
    city: string | null;
    due: string;
    owner: string | null;
  }) => client.post("/api/tasks", { body: task }),
  /** A task snoozed until 10 am tomorrow; it leaves the board until then (ADR 0303). */
  snoozeTask: (group: TaskGroup["group"], id: string) =>
    client.post("/api/tasks/{group}/{id}/snooze", { path: { group, id } }),
  /** A task written by hand marked done; it leaves the board. */
  markTaskDone: (id: string) => client.post("/api/tasks/staff/{id}/done", { path: { id } }),
  /** A one visit's payment link, texted to the client again by Razorpay, or made now where it never was. */
  resendPaymentLink: (linkId: string) => client.post("/api/payment-links/{id}/resend", { path: { id: linkId } }),
  /** A UPI payment taken at the visit, recorded under its UTR once it is in the account; the client is sent a receipt. */
  recordUpiPayment: (visitId: string, utr: string) =>
    client.post("/api/visits/{id}/upi-payment", { path: { id: visitId }, body: { utr } }),
  /** A technician's ask for leave approved, which records the leave, or declined. */
  decideLeave: (id: string, decision: "approved" | "declined") =>
    client.post("/api/leave-requests/{id}/decision", { path: { id }, body: { decision } }),
  /** The open alerts ops have been told of, of the caller's own departments. */
  alerts: () => client.get("/api/alerts"),
  /** An alert marked done, under the caller's name. */
  resolveAlert: (id: string) => client.post("/api/alerts/{id}/resolve", { path: { id } }),
  /** The message, lead or CRM erasure an alert gave up on, sent again; the alert closes. */
  sendAlertAgain: (id: string) => client.post("/api/alerts/{id}/send-again", { path: { id } }),
};
