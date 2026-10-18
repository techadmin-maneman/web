// A client's page's calls to mm-api: the list of clients, booking, cancelling and closing a visit, credits, an address
// given on the phone, an invite, the photographs, pieces, hair profile and custom orders, a visit's discount code, a
// refund, and erasing the client. Each is the console's client's (../api.ts), one function a route, so a call is found,
// and changed, in one place.

import type { Sent } from "@maneman/web-kit/api";
import {
  client,
  type ClientListQuery,
  type VisitToBook,
  type CancelTerms,
  type HandClose,
  type CreditAdjustment,
  type AddressGiven,
  type AvailabilityQuery,
  type HairCorrection,
  type InviteAttachment,
} from "../api.ts";
import type { paths } from "../api-schema.ts";

export const clientsApi = {
  customOrders: (id: string) => client.get("/api/clients/{id}/custom-orders", { path: { id } }),
  raiseCustomOrder: (id: string, body: Sent<paths["/api/clients/{id}/custom-orders"]["post"]>) =>
    client.post("/api/clients/{id}/custom-orders", { path: { id }, body }),
  refundPayment: (id: string, body: Sent<paths["/api/payments/{id}/refund"]["post"]>) =>
    client.post("/api/payments/{id}/refund", { path: { id }, body }),
  setLostReason: (id: string, body: Sent<paths["/api/visits/{id}/lost-reason"]["post"]>) =>
    client.post("/api/visits/{id}/lost-reason", { path: { id }, body }),
  stockMatch: (id: string) => client.get("/api/clients/{id}/stock-match", { path: { id } }),
  sendCustomOrderLink: (id: string) => client.post("/api/custom-orders/{id}/send-link", { path: { id } }),
  cancelCustomOrder: (id: string) => client.post("/api/custom-orders/{id}/cancel", { path: { id } }),
  refundCustomOrder: (id: string, reason: Sent<paths["/api/custom-orders/{id}/refund"]["post"]>["reason"]) =>
    client.post("/api/custom-orders/{id}/refund", { path: { id }, body: { reason } }),
  /** Every client in the caller's cities, narrowed by where they stand and city, a page at a time. */
  clientList: (query: ClientListQuery) => client.get("/api/clients", { query }),
  /** A client's 14 days of windows for a kind of visit, who is free in each, and how it would be paid. */
  visitAvailability: (query: AvailabilityQuery) => client.get("/api/visits/availability", { query }),
  /** A visit booked for a client: at once when nothing is paid at booking, else a payment link goes to them. */
  bookVisit: (visit: VisitToBook) => client.post("/api/visits", { body: visit }),
  /** What a cancel would give back, free to the client and on their own late terms. Changes nothing. */
  cancelTerms: (visitId: string) =>
    client.post("/api/visits/{id}/cancel", { path: { id: visitId }, body: { confirm: false } }),
  /** The cancel, on the notice ops were shown: free to the client unless `onClientTerms`. */
  cancelVisit: (visitId: string, notice: CancelTerms["notice"], onClientTerms: boolean, reason: string) =>
    client.post("/api/visits/{id}/cancel", {
      path: { id: visitId },
      body: { confirm: true, notice, ...(onClientTerms ? { on_client_terms: true } : {}), reason },
    }),
  /** A visit whose technician's phone was lost before it sent the work, closed as ops say it went. */
  closeVisit: (visitId: string, close: HandClose) =>
    client.post("/api/visits/{id}/close", { path: { id: visitId }, body: close }),
  /** Visits added or taken away by hand, with the reason; the answer is the balance after it. */
  adjustCredits: (id: string, adjustment: CreditAdjustment) =>
    client.post("/api/clients/{id}/credits", { path: { id }, body: adjustment }),
  /**
   * Buildings matching what ops have typed of the address a client is giving them, in one billed session, kept near
   * the pincode's city where the form has one.
   */
  addressSuggestions: (id: string, q: string, session: string, pincode: string) =>
    client.post("/api/clients/{id}/address/suggestions", {
      path: { id },
      body: /^d{6}$/.test(pincode) ? { q, session, pincode } : { q, session },
    }),
  /** The address a client gave on the phone, saved as theirs, marked as given to ops (ADR 0092). */
  saveGivenAddress: (id: string, address: AddressGiven) =>
    client.post("/api/clients/{id}/address", { path: { id }, body: address }),
  /** An invite attached by hand, with why; the answer is the invite as the client's page shows it (ADR 0089). */
  attachInvite: (id: string, attachment: InviteAttachment) =>
    client.post("/api/clients/{id}/referral", { path: { id }, body: attachment }),
  /** Which photographs exist, by visit. No image comes with it, and nothing is audited. */
  clientPhotos: (id: string) => client.get("/api/clients/{id}/photos", { path: { id } }),
  /** Opening them: one audit entry, written before any image is served, and who opened them before (ADR 0031). */
  openPhotos: (id: string) => client.post("/api/clients/{id}/photos/view", { path: { id } }),
  /** One photograph's bytes, within the opening already logged. */
  clientPhoto: (id: string, photoId: string) =>
    client.request<Blob>("GET", `/api/clients/${encodeURIComponent(id)}/photos/${encodeURIComponent(photoId)}`, {
      file: true,
    }),
  clientConsents: (id: string) => client.get("/api/clients/{id}/consents", { path: { id } }),
  /** The client's pieces. */
  clientPieces: (id: string) => client.get("/api/clients/{id}/pieces", { path: { id } }),
  /** Puts the client on a package; their next service visit and replacement follow it. */
  setPackage: (id: string, code: string) =>
    client.post("/api/clients/{id}/package", { path: { id }, body: { package: code } }),
  /** The client's hair profile as it stands, and every version of it. */
  clientHairProfile: (id: string) => client.get("/api/clients/{id}/hair-profile", { path: { id } }),
  /** A correction: the whole profile as it now stands, a new version under the caller's name, audited. */
  correctHairProfile: (id: string, correction: HairCorrection) =>
    client.post("/api/clients/{id}/hair-profile", { path: { id }, body: correction }),
  /** What waits on ops for one client alone, for the head of their page. */
  clientTasks: (person: string) => client.get("/api/tasks", { query: { person } }),
  /**
   * Erases a client now, from their page; it cannot be undone. `settledByHand` erases despite a visit booked or a
   * payment held, which ops then cancel and refund themselves, or a payment link unpaid, which is cancelled.
   */
  eraseClient: (id: string, settledByHand: boolean) =>
    client.post("/api/clients/{id}/erasure", {
      path: { id },
      body: settledByHand ? { override_open_bookings: true } : {},
    }),
  /** Only on a visit not yet paid for, linked or invoiced; one code a visit. */
  enterVisitCode: (visitId: string, code: string) =>
    client.post("/api/visits/{id}/discount-code", { path: { id: visitId }, body: { code } }),
  removeVisitCode: (visitId: string) => client.post("/api/visits/{id}/discount-code/remove", { path: { id: visitId } }),
};
