// The client app's calls to mm-api (docs/openapi-client.json). Every call is
// same-origin, so the session cookie goes with it and the Origin matches.

import type { components } from "./api-schema.ts";
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
export type VisitSummary = Schemas["VisitSummary"];
export type Visits = Schemas["Visits"];
export type VisitDetail = Schemas["VisitDetail"];
export type PhotoLink = Schemas["PhotoLink"];
export type PhotoSet = Schemas["PhotoSet"];
export type PhotoTimeline = Schemas["PhotoTimeline"];
export type Angle = PhotoLink["angle"];
export type Entry = Schemas["PaymentEntry"] | Schemas["RefundEntry"];
export type EntryDetail = Schemas["PaymentDetail"] | Schemas["RefundDetail"];
export type Availability = Schemas["Availability"];
export type Hold = Schemas["Hold"];
export type Price = Schemas["Price"];
export type Booking = Schemas["Booking"];
export type MoveTerms = Schemas["MoveTerms"];
export type CancelTerms = Schemas["CancelTerms"];
export type Refer = Schemas["Refer"];
export type BookableType = Me["booking"]["types"][number];
export type BookingWindow = Hold["window"];

/**
 * A failed call carries the API's error code, or "offline" when it never reached
 * the API. `cached` is true for a Home the service worker kept (apps/app/sw/sw.ts).
 */
export type Answer<T> =
  | { readonly ok: true; readonly status: number; readonly body: T; readonly cached: boolean }
  | { readonly ok: false; readonly status: number; readonly code: string };

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

/** A call that never reached the API: no connection, or something else answering in its place. */
const OFFLINE = { ok: false, status: 0, code: "offline" } as const;

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

async function answerOf<T>(response: Response): Promise<Answer<T>> {
  if (!response.ok) {
    const error = (await response.json().catch(() => null)) as { error?: { code?: string } } | null;
    if (response.status === 401) for (const listener of sessionListeners) listener();
    return { ok: false, status: response.status, code: error?.error?.code ?? "unknown" };
  }
  const cached = response.headers.get(SERVED_FROM) === "cache";
  if (!cached) heardFromApi(response.headers.get("Date"));
  let value: unknown = null;
  if (response.status !== 204) {
    try {
      value = await response.json();
    } catch {
      // An answer that is not JSON is not ours (a Wi-Fi sign-in page, say), so the API was not reached.
      return OFFLINE;
    }
  }
  return { ok: true, status: response.status, body: value as T, cached };
}

async function call<T>(method: "GET" | "POST" | "PATCH" | "DELETE", path: string, body?: unknown): Promise<Answer<T>> {
  let response: Response;
  try {
    response = await fetch(path, {
      method,
      credentials: "same-origin",
      headers: body === undefined ? {} : { "Content-Type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  } catch {
    return OFFLINE;
  }
  return answerOf<T>(response);
}

export const api = {
  sendCode: (mobile: string) => call<LoginChallenge>("POST", "/api/auth/otp", { mobile }),
  resendCode: (challengeId: string) =>
    call<LoginChallenge>("POST", "/api/auth/otp/resend", { challenge_id: challengeId }),
  smsCode: (challengeId: string) => call<LoginChallenge>("POST", "/api/auth/otp/sms", { challenge_id: challengeId }),
  verify: (challengeId: string, code: string) =>
    call<LoginVerify>("POST", "/api/auth/verify", { challenge_id: challengeId, code }),
  logout: () => call<null>("POST", "/api/auth/logout"),
  me: () => call<Me>("GET", HOME_PATH),
  profile: () => call<Profile>("GET", "/api/profile"),
  saveAddress: (address: AddressSave) => call<Address>("PATCH", "/api/profile/address", address),
  /** One session token for every keystroke of a search, so Google bills the session and not the letters. */
  addressSuggestions: (query: string, session: string) =>
    call<Schemas["AddressSuggestions"]>(
      "GET",
      `/api/address/suggestions?q=${encodeURIComponent(query)}&session=${encodeURIComponent(session)}`,
    ),
  switchConsent: (purpose: ConsentPurpose, granted: boolean) =>
    call<{ purpose: ConsentPurpose; granted: boolean; since: string }>("PATCH", `/api/consents/${purpose}`, {
      granted,
    }),
  startNumberChange: (newMobile: string) =>
    call<{ request_id: string; expires_in_s: number }>("POST", "/api/number-change", { new_mobile: newMobile }),
  verifyNumberChange: (requestId: string, number: "old" | "new", code: string) =>
    call<NumberChange & { attempts_left: number | null }>("POST", "/api/number-change/verify", {
      request_id: requestId,
      number,
      code,
    }),
  requestDeletion: () => call<{ state: "requested"; requested_at: string }>("POST", "/api/deletion-request"),
  raiseGrievance: (text: string) => call<{ id: string; state: "open" }>("POST", "/api/grievances", { text }),
  refer: () => call<Refer>("GET", "/api/refer"),
  revokeCard: () => call<null>("DELETE", "/api/refer/card"),
  visits: () => call<Visits>("GET", "/api/visits"),
  visit: (id: string) => call<VisitDetail>("GET", `/api/visits/${id}`),
  photos: () => call<PhotoTimeline>("GET", "/api/photos"),
  payments: () => call<{ entries: Entry[] }>("GET", "/api/payments"),
  entry: (id: string) => call<EntryDetail>("GET", `/api/payments/${id}`),
  availability: (type: BookableType, moving?: string) =>
    call<Availability>("GET", `/api/availability?type=${type}${moving === undefined ? "" : `&moving=${moving}`}`),
  hold: (type: BookableType, date: string, window: BookingWindow, moving?: string) =>
    call<Hold>("POST", "/api/holds", { type, date, window, ...(moving === undefined ? {} : { moving }) }),
  holdById: (id: string) => call<Hold>("GET", `/api/holds/${id}`),
  releaseHold: (id: string) => call<null>("DELETE", `/api/holds/${id}`),
  book: (holdId: string) => call<Booking>("POST", "/api/bookings", { hold_id: holdId }),
  moveTerms: (visitId: string) => call<MoveTerms>("POST", `/api/appointments/${visitId}/reschedule`, {}),
  startMove: (visitId: string, holdId: string) =>
    call<Booking>("POST", `/api/appointments/${visitId}/reschedule`, { hold_id: holdId }),
  cancelTerms: (visitId: string) =>
    call<CancelTerms>("POST", `/api/appointments/${visitId}/cancel`, { confirm: false }),
  cancel: (visitId: string, notice: CancelTerms["notice"]) =>
    call<CancelTerms>("POST", `/api/appointments/${visitId}/cancel`, { confirm: true, notice }),
};

/** A visit's tax invoice, as a PDF the browser opens itself. */
export const documentUrl = (id: string) => `/api/documents/${id}`;
export const receiptUrl = (paymentId: string) => `/api/payments/${paymentId}/receipt`;
/** The client's own referral card, as the phone composed it. */
export async function putCard(card: Blob): Promise<Answer<{ version: number }>> {
  let response: Response;
  try {
    response = await fetch("/api/refer/card", {
      method: "PUT",
      credentials: "same-origin",
      headers: { "Content-Type": "image/jpeg" },
      body: card,
    });
  } catch {
    return OFFLINE;
  }
  return answerOf<{ version: number }>(response);
}

/** Everything held about the client, as a file the browser saves. */
export const EXPORT_URL = "/api/me/export";
