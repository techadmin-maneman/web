// The Tasks board's calls to mm-api: a task's owner, a task closed, a payment link sent again, and the alerts that need
// a hand. Each is the console's client's (../api.ts), one function a route, so a call is found, and changed, in one
// place.

import { client, type TaskGroup, type ClosableGroup } from "../api.ts";

export const tasksApi = {
  /** A task made a member of staff's, by their Access e-mail, or nobody's with null (ADR 0092). */
  setTaskOwner: (group: TaskGroup["group"], id: string, owner: string | null) =>
    client.put("/api/tasks/{group}/{id}/owner", { path: { group, id }, body: { owner } }),
  /** A visit left partly done, closed without a follow-up; the reason is kept with it, under the caller's name. */
  closeTask: (group: ClosableGroup, id: string, reason: string) =>
    client.post("/api/tasks/{group}/{id}/close", { path: { group, id }, body: { reason } }),
  /** A one visit's payment link, texted to the client again by Razorpay, or made now where it never was. */
  resendPaymentLink: (linkId: string) => client.post("/api/payment-links/{id}/resend", { path: { id: linkId } }),
  /** The open alerts ops have been told of, of the caller's own departments. */
  alerts: () => client.get("/api/alerts"),
  /** An alert marked done, under the caller's name. */
  resolveAlert: (id: string) => client.post("/api/alerts/{id}/resolve", { path: { id } }),
  /** The message, lead or CRM erasure an alert gave up on, sent again; the alert closes. */
  sendAlertAgain: (id: string) => client.post("/api/alerts/{id}/send-again", { path: { id } }),
};
