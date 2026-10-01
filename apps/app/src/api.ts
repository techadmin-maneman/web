// The client app's calls to mm-api (docs/openapi-client.json), made with the
// one client the apps share (packages/web-kit/api.ts). Each call's path, query,
// body and answer are checked against ./api-schema.ts, which `npm run openapi`
// writes from the schemas that serve the routes (FEA-30).
//
// Every call is same-origin, so the session cookie goes with it and the Origin matches.

import { createClient, type Answer as Answered, type OperationAt, type Success } from "@maneman/web-kit/api";
import type { components, paths } from "./api-schema.ts";
import { heardFromApi } from "./lib/clock.ts";

type Schemas = components["schemas"];
export type LoginChallenge = Schemas["LoginChallenge"];
export type LoginVerify = Schemas["LoginVerify"];
export type Me = Schemas["Me"];
export type Profile = Schemas["Profile"];
export type Address = Schemas["Address"];
export type AddressSave = Schemas["AddressSave"];
export type Suggestion = Schemas["AddressSuggestions"]["suggestions"][number];
export type NumberChange = Schemas["NumberChange"];
export type ConsentPurpose = Profile["consents"][number]["purpose"];
/** The screen a consent is switched on, which the consent keeps (docs/decisions/0094-where-a-consent-was-given.md). */
export type ConsentScreen = NonNullable<Schemas["ConsentSwitch"]["source"]>;
export type VisitSummary = Schemas["VisitSummary"];
export type Visits = Schemas["Visits"];
export type VisitDetail = Schemas["VisitDetail"];
export type PhotoLink = Schemas["PhotoLink"];
export type PhotoSet = Schemas["PhotoSet"];
export type PhotoTimeline = Schemas["PhotoTimeline"];
export type TryOn = Schemas["TryOn"];
export type Angle = PhotoLink["angle"];
export type Entry = Schemas["PaymentEntry"] | Schemas["RefundEntry"];
export type CreditLine = Schemas["CreditLine"];
export type EntryDetail = Schemas["PaymentDetail"] | Schemas["RefundDetail"];
export type Availability = Schemas["Availability"];
export type Hold = Schemas["Hold"];
export type Price = Schemas["Price"];
export type Booking = Schemas["Booking"];
export type BookingConsent = NonNullable<Schemas["BookingStart"]["consents"]>[number];
export type MoveTerms = Schemas["MoveTerms"];
export type CancelTerms = Schemas["CancelTerms"];
export type Refer = Schemas["Refer"];
export type BookableType = Me["booking"]["types"][number];
export type OfferedService = Me["booking"]["services"][number];
export type BookingWindow = Hold["window"];
/** What the app offers next, which the booking sheet opens pre-filled with (ADR 0086). */
export type NextOffer = NonNullable<Me["booking"]["next"]>;

/**
 * The service a booking is for: its kind, and its code within the kind. Without a code, the API books the kind's
 * standard service, and a move books its own visit's (docs/decisions/0085-services-ops-can-edit.md).
 */
export interface Wanted {
  readonly type: BookableType;
  readonly tier?: string;
}

/** A service's code, where one is named, and the visit moved, where there is one, as a query or a body takes them. */
const serviceOf = (wanted: Wanted, moving: string | undefined) => ({
  type: wanted.type,
  ...(wanted.tier === undefined ? {} : { tier: wanted.tier }),
  ...(moving === undefined ? {} : { moving }),
});

/** The codes the API refuses with, as its document writes them. */
export type ErrorCode = Schemas["ErrorResponse"]["error"]["code"];

/**
 * A failed call carries the API's error code, or "offline" when it never reached
 * the API. `cached` is true for a Home the service worker kept (apps/app/sw/sw.ts).
 */
export type Answer<T> = Answered<T, ErrorCode>;

/** Named as in apps/app/sw/sw.ts. */
const HOME_CACHE = "mm-app-home";
const SERVED_FROM = "Mm-Served-From";
const HOME_PATH = "/api/me";

/** The kept Home is the one personal thing the app keeps on the phone: gone at logout, and once the session has ended. */
export async function forgetHome(): Promise<void> {
  if ("caches" in window) await caches.delete(HOME_CACHE);
}

/** The Home the phone kept, if any: board B3's error can then say the visit is still booked. */
export async function keptHome(): Promise<Me | null> {
  if (!("caches" in window)) return null;
  const kept = await caches.match(HOME_PATH, { cacheName: HOME_CACHE });
  return kept === undefined ? null : ((await kept.json()) as Me);
}

const sessionListeners = new Set<() => void>();

/**
 * A 401 from any call means the session has ended: it ran out, or the client
 * logged out on another phone. App forgets the kept Home and shows the login
 * (apps/app/src/App.tsx), wherever the client was, so no page has to handle it.
 */
export function onSessionEnded(listener: () => void): () => void {
  sessionListeners.add(listener);
  return () => {
    sessionListeners.delete(listener);
  };
}

const client = createClient<paths, ErrorCode>({
  onSessionEnded: () => {
    for (const listener of sessionListeners) listener();
  },
  // A hold is counted on the API's clock. The Home the phone kept is as old as the day it was kept, so it is not asked.
  onAnswer: (response) => {
    if (response.ok && response.headers.get(SERVED_FROM) !== "cache") heardFromApi(response.headers.get("Date"));
  },
});

export const api = {
  sendCode: (mobile: string) => client.post("/api/auth/otp", { body: { mobile } }),
  resendCode: (challengeId: string) => client.post("/api/auth/otp/resend", { body: { challenge_id: challengeId } }),
  smsCode: (challengeId: string) => client.post("/api/auth/otp/sms", { body: { challenge_id: challengeId } }),
  verify: (challengeId: string, code: string) =>
    client.post("/api/auth/verify", { body: { challenge_id: challengeId, code } }),
  logout: () => client.post("/api/auth/logout"),
  me: () => client.get(HOME_PATH),
  profile: () => client.get("/api/profile"),
  saveAddress: (address: AddressSave) => client.patch("/api/profile/address", { body: address }),
  /** One session token for every keystroke of a search, so Google bills the session and not the letters. */
  addressSuggestions: (query: string, session: string) =>
    client.post("/api/address/suggestions", { body: { q: query, session } }),
  switchConsent: (purpose: ConsentPurpose, granted: boolean, source: ConsentScreen) =>
    client.patch("/api/consents/{purpose}", { path: { purpose }, body: { granted, source } }),
  startNumberChange: (newMobile: string) => client.post("/api/number-change", { body: { new_mobile: newMobile } }),
  verifyNumberChange: (requestId: string, number: "old" | "new", code: string) =>
    client.post("/api/number-change/verify", { body: { request_id: requestId, number, code } }),
  withdrawNumberChange: () => client.delete("/api/number-change"),
  requestDeletion: () => client.post("/api/deletion-request"),
  raiseGrievance: (text: string) => client.post("/api/grievances", { body: { text } }),
  refer: () => client.get("/api/refer"),
  revokeCard: () => client.delete("/api/refer/card"),
  visits: () => client.get("/api/visits"),
  visit: (id: string) => client.get("/api/visits/{id}", { path: { id } }),
  photos: () => client.get("/api/photos"),
  payments: () => client.get("/api/payments"),
  entry: (id: string) => client.get("/api/payments/{id}", { path: { id } }),
  /** `from`: the strip's first day, which the API keeps within the days a visit may be booked on. */
  availability: (wanted: Wanted, moving?: string, from?: string) =>
    client.get("/api/availability", {
      query: { ...serviceOf(wanted, moving), ...(from === undefined ? {} : { from }) },
    }),
  hold: (wanted: Wanted, date: string, window: BookingWindow, moving?: string) =>
    client.post("/api/holds", { body: { ...serviceOf(wanted, moving), date, window } }),
  holdById: (id: string) => client.get("/api/holds/{id}", { path: { id } }),
  releaseHold: (id: string) => client.delete("/api/holds/{id}", { path: { id } }),
  /** A discount code off the hold's price, before Checkout has its order; the hold, priced again. */
  enterCode: (holdId: string, code: string) =>
    client.post("/api/holds/{id}/discount-code", { path: { id: holdId }, body: { code } }),
  removeCode: (holdId: string) => client.delete("/api/holds/{id}/discount-code", { path: { id: holdId } }),
  /** `consents`: the photograph purposes whose lines the pay step showed, which the tap agrees to (ADR 0080). */
  book: (holdId: string, consents: readonly BookingConsent[]) =>
    client.post("/api/bookings", {
      body: { hold_id: holdId, ...(consents.length === 0 ? {} : { consents: [...consents] }) },
    }),
  // One path, two answers: sent no hold it gives the move's terms (200), sent one the booking (201).
  moveTerms: (visitId: string) =>
    client.post("/api/appointments/{id}/reschedule", { path: { id: visitId }, body: {} }) as Promise<Answer<MoveTerms>>,
  startMove: (visitId: string, holdId: string) =>
    client.post("/api/appointments/{id}/reschedule", { path: { id: visitId }, body: { hold_id: holdId } }) as Promise<
      Answer<Booking>
    >,
  cancelTerms: (visitId: string) =>
    client.post("/api/appointments/{id}/cancel", { path: { id: visitId }, body: { confirm: false } }),
  cancel: (visitId: string, notice: CancelTerms["notice"]) =>
    client.post("/api/appointments/{id}/cancel", { path: { id: visitId }, body: { confirm: true, notice } }),
  /** The client's note on a visit to come, for the technician's card; the latest replaces any before it. */
  note: (visitId: string, note: string) =>
    client.post("/api/appointments/{id}/note", { path: { id: visitId }, body: { note } }),
  /** The client's dispute of the no-show's charge on a visit, once a charge (ADR 0096). */
  dispute: (visitId: string, reason: string) =>
    client.post("/api/visits/{id}/dispute", { path: { id: visitId }, body: { reason } }),
};

/** A visit's tax invoice, as a PDF the browser opens itself. */
export const documentUrl = (id: string) => `/api/documents/${id}`;
export const receiptUrl = (paymentId: string) => `/api/payments/${paymentId}/receipt`;

/** The client's own referral card, as the phone composed it: a JPEG, not JSON, so it goes as it is. */
export const putCard = (card: Blob) =>
  client.request<Success<OperationAt<paths, "/api/refer/card", "put">>>("PUT", "/api/refer/card", {
    body: card,
    headers: { "Content-Type": "image/jpeg" },
  });

/** The client's card as stored, which the phone keeps a day: each version has a link of its own. */
export const cardUrl = (version: number) => `/api/refer/card?v=${String(version)}`;

/** The same card as a file, for the share sheet to send. */
export const storedCard = (version: number) => client.request<Blob>("GET", cardUrl(version), { file: true });

/** Everything held about the client, as a file the browser saves. */
export const EXPORT_URL = "/api/me/export";
