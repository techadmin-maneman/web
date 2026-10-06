// A client of the app as the booking and money tests start from one: the technician who fitted them, the client
// with an address, the first fit that makes a service visit theirs to book, a signed-in session, and a call to the
// client surface the way the app's browser makes it. Every name and number here is made up.

import { env } from "cloudflare:workers";
import { openSession } from "../../src/domain/sign-in/sessions.ts";
import { appFor, fakeDependencies, NOW, request, savedAddress, type TestDependencies } from "./helpers.ts";

/** The technician most booking tests are fitted by. */
export const IMRAN = "t1";

export async function technician(id = IMRAN, name = "Imran Qureshi", initials = "IQ"): Promise<void> {
  await env.DB.prepare(
    "INSERT INTO technicians (id, fsm_id, name, initials, active, updated_at) VALUES (?1, ?1, ?2, ?3, 1, ?4)",
  )
    .bind(id, name, initials, NOW.toISOString())
    .run();
}

/** A client with a saved address in Gurgaon, as booking asks for one before anything is held. */
export async function client(id: string, mobile = "+919810000001", name = "Rohit Malhotra"): Promise<void> {
  await env.DB.prepare("INSERT INTO people (id, created_at, mobile_e164, name) VALUES (?1, ?2, ?3, ?4)")
    .bind(id, NOW.toISOString(), mobile, name)
    .run();
  await savedAddress(id);
}

/** Who fitted the clients here: a technician since switched off, so Imran may take their next visit. */
export const FITTER = "t-fit";

/**
 * A first fit done on 1 August, so a service visit is the client's to book. It is the fitter's, not Imran's: a
 * technician never takes two of a client's visits in a row (src/domain/booking/technician-rotation.ts).
 */
export async function fittedInAugust(personId: string, visitId = "fit-1", technicianId = FITTER): Promise<void> {
  if (technicianId === FITTER) {
    await env.DB.prepare(
      `INSERT OR IGNORE INTO technicians (id, fsm_id, name, initials, active, updated_at)
       VALUES (?1, ?1, 'Sana Mirza', 'SM', 0, ?2)`,
    )
      .bind(FITTER, NOW.toISOString())
      .run();
  }
  await env.DB.prepare(
    `INSERT INTO appointments (id, fsm_id, person_id, type, status, window_start, window_end, technician_id, synced_at)
     VALUES (?1, ?1, ?2, 'first_fit', 'completed', '2026-08-01T03:30:00.000Z', '2026-08-01T06:30:00.000Z', ?3, ?4)`,
  )
    .bind(visitId, personId, technicianId, NOW.toISOString())
    .run();
}

/** The cookie of a session the client signed in to at `now`. */
export async function signedIn(personId: string, now = NOW): Promise<string> {
  return `mm_app=${await openSession(env.DB, { kind: "client", subjectId: personId, deviceLabel: null, now })}`;
}

export interface Call {
  readonly method?: string;
  readonly body?: unknown;
  /** More of the browser's headers, as the address Cloudflare saw it call from. */
  readonly headers?: Readonly<Record<string, string>>;
}

export interface Calling {
  /** The moment the app takes it to be, for a call made later than NOW. */
  readonly now?: Date;
  readonly deps?: TestDependencies;
  readonly bindings?: Partial<Env>;
}

/** Calls the client surface as the app's browser does: with the session's cookie, from the app's origin, in JSON. */
export function asClient(cookie: string, path: string, call: Call = {}, calling: Calling = {}): Promise<Response> {
  const deps = calling.deps ?? fakeDependencies({ now: () => calling.now ?? NOW });
  return request(
    appFor("local", deps, {}, "client"),
    path,
    {
      method: call.method ?? "GET",
      headers: { Cookie: cookie, "Content-Type": "application/json", Origin: "https://maneman.test", ...call.headers },
      ...(call.body === undefined ? {} : { body: JSON.stringify(call.body) }),
    },
    calling.bindings,
  );
}
