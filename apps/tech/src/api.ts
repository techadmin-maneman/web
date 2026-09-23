// ─────────────────────────────────────────────────────────────────────────────
// PROVISIONAL. The technician API is P2-M4's, and it is being built beside this
// app. Nothing here is generated from an OpenAPI document yet, so nothing here
// is the contract.
//
// Every route this app calls is named below exactly as the P2-M4 section of
// `docs/prompts/phase2-backend.md` writes it, so the two can be put side by
// side; `test/node/tech-routes.test.ts` does that against the prompt itself.
// ROUTES_ASSUMED holds the two the prompt does not write, which the app needs
// and which must be confirmed. The shapes below are this app's reading of the
// technician boards, not the API's answer: when `docs/openapi-tech.json`
// exists, `npm run openapi` generates them and this file keeps only the calls.
//
// Every call is same-origin, so the session cookie goes with it and the Origin
// matches (docs/decisions/0026-hosts-and-surfaces.md). Every write carries the
// client-generated `X-Client-Event-Id`, which makes it idempotent.
// ─────────────────────────────────────────────────────────────────────────────

// The routes themselves are in ./routes.ts, which holds no browser code, so the
// route names can be checked against the prompt in a Node test.
import { EVENT_ID_HEADER, SUPERSEDED } from "./routes.ts";

export { DEVICE_REVOKED, pathFor, ROUTES_ASSUMED, ROUTES_SPECIFIED, SUPERSEDED } from "./routes.ts";

// ---- The shapes, read off the boards ----------------------------------------

export type VisitType = "consultation" | "service" | "replacement" | "first_fit";
/** No amount ever reaches this app: a badge only (board A1). */
export type Badge = "prepaid" | "credit" | "free";

export interface JobSummary {
  readonly id: string;
  readonly starts_at: string;
  readonly slots: number;
  readonly type: VisitType;
  readonly badge: Badge;
  readonly client_name: string;
  readonly sector: string;
  readonly distance_km: number | null;
  /** True until the backend's day-before unlock releases the address and the card. */
  readonly locked: boolean;
}

export interface Day {
  readonly date: string;
  readonly jobs: readonly JobSummary[];
}

export interface Address {
  readonly line: string;
  readonly access_notes: string | null;
}

/** The piece card's rows, as board A3 draws them: tier, base, colour, adhesive, template, scalp. */
export interface SpecRow {
  readonly key: string;
  readonly value: string;
}

export interface LastVisit {
  readonly photo_url: string;
  readonly on: string;
  readonly technician: string;
}

export interface Job extends JobSummary {
  readonly address: Address | null;
  readonly spec: readonly SpecRow[];
  readonly last_visit: LastVisit | null;
  readonly started_at: string | null;
}

export interface Technician {
  readonly name: string;
  readonly initials: string;
}

export interface Me {
  readonly technician: Technician;
  readonly device: { readonly id: string; readonly label: string };
}

export interface Challenge {
  readonly challenge_id: string;
  readonly expires_in_s: number;
}

// ---- The calls ---------------------------------------------------------------

/**
 * A failed call carries the API's error code, or "offline" when it never
 * reached the API. `message` is the API's own words, which board B5 and the
 * outbox show as they are: a supersede never becomes a generic error.
 */
export type Answer<T> =
  | { readonly ok: true; readonly status: number; readonly body: T }
  | { readonly ok: false; readonly status: number; readonly code: string; readonly message: string | null };

export interface Write {
  /** The UUIDv7 that makes this write idempotent, whatever it takes to arrive. */
  readonly eventId: string;
}

async function call<T>(method: string, path: string, body?: unknown, write?: Write): Promise<Answer<T>> {
  let response: Response;
  const headers: Record<string, string> = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (write !== undefined) headers[EVENT_ID_HEADER] = write.eventId;
  try {
    response = await fetch(`/api${path}`, {
      method,
      credentials: "same-origin",
      headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  } catch {
    return { ok: false, status: 0, code: "offline", message: null };
  }
  if (response.ok) {
    const value = response.status === 204 ? null : ((await response.json()) as unknown);
    return { ok: true, status: response.status, body: value as T };
  }
  const failure = (await response.json().catch(() => null)) as {
    error?: { code?: string; message?: string };
  } | null;
  return {
    ok: false,
    status: response.status,
    code: failure?.error?.code ?? (response.status === 409 ? SUPERSEDED : "unknown"),
    message: failure?.error?.message ?? null,
  };
}

export const api = {
  /** POST /tech/auth/otp — the code goes to the technician's mobile, as the client app's login does. */
  sendCode: (mobile: string) => call<Challenge>("POST", "/tech/auth/otp", { mobile }),
  /**
   * POST /tech/auth/verify — enrols this device and opens the session bound to
   * it (ADR 0029). ASSUMED: `device_id`, the ID this phone made for itself. The
   * prompt names the route but not its body; the label is the server's, from
   * the User-Agent, and never sent from here.
   */
  verify: (challengeId: string, code: string, deviceId: string) =>
    call<Me>("POST", "/tech/auth/verify", { challenge_id: challengeId, code, device_id: deviceId }),
  /** ASSUMED: GET /tech/me. */
  me: () => call<Me>("GET", "/tech/me"),
  /** ASSUMED: POST /tech/auth/logout. */
  logout: () => call<null>("POST", "/tech/auth/logout"),

  /** GET /tech/jobs?date= — today and tomorrow in full; later dates carry time, type and sector only. */
  jobs: (date: string) => call<Day>("GET", `/tech/jobs?date=${encodeURIComponent(date)}`),
  /** GET /tech/jobs/:id — the card, which respects the day-before unlock. */
  job: (id: string) => call<Job>("GET", `/tech/jobs/${id}`),
  /** GET /tech/pieces/lookup?code= */
  piece: (code: string) => call<SpecRow[]>("GET", `/tech/pieces/lookup?code=${encodeURIComponent(code)}`),

  /** Every write below goes through the outbox, never straight from a screen (apps/tech/src/store/outbox.ts). */
  send: (method: string, path: string, body: unknown, write: Write) => call<unknown>(method, path, body, write),
};
