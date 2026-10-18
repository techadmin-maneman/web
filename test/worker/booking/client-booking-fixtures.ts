// What the app's booking tests share (client-booking*.test.ts): the technicians, a client signed in with a fresh number
// each test, a visit of theirs, and a time some way on.

import { env } from "cloudflare:workers";
import { openSession } from "../../../src/domain/sign-in/sessions.ts";
import { aGenericFirstFit, aPackage, aPerson } from "../fixtures/index.ts";
import { appFor, fakeDependencies, NOW, savedAddress } from "../helpers.ts";

export const IMRAN = "t1";

export const SANDEEP = "t2";

/** Who did the clients' last visits here: a technician since switched off, who stands beside no one's next. */
export const SANA = "t0";

/** A technician in Gurgaon, where the client books: a visit goes only to a technician in its own city (ADR 0117). */
export async function technician(id: string, name: string, initials: string, city: string | null = "Gurgaon") {
  await env.DB.prepare(
    "INSERT INTO technicians (id, fsm_id, name, initials, active, updated_at, city, fits_trained) VALUES (?1, ?2, ?3, ?4, 1, ?5, ?6, 1)",
  )
    .bind(id, `fsm-${id}`, name, initials, NOW.toISOString(), city)
    .run();
}

/**
 * A package ops sell in the console, its first fit at the price and length the migrations gave the generic first fit,
 * which is retired from 2 October 2026.
 */
export async function essential(): Promise<void> {
  await aPackage({ code: "essential", firstFit: 3000000 });
}

/** The generic first fit the migrations began with, sold by a hair system of its own until 2 October 2026. */
export const theFirstFit = aGenericFirstFit;

export let people = 0;

/**
 * A client with a session and a saved address; fitted, unless `lead`, by `lastWith`, whose visit was their last.
 * `withoutAddress`: one who has not given their address yet.
 */
export async function client(
  lead = false,
  { withoutAddress = false, lastWith = SANA } = {},
): Promise<{ id: string; cookie: string }> {
  people += 1;
  const id = crypto.randomUUID();
  await env.DB.prepare("INSERT INTO people (id, created_at, mobile_e164, name) VALUES (?1, ?2, ?3, 'Rohit Malhotra')")
    .bind(id, NOW.toISOString(), `+9198100000${String(people).padStart(2, "0")}`)
    .run();
  if (!withoutAddress) await savedAddress(id, "122018");
  await visit(id, lead ? "consultation" : "service", "completed", "2026-09-01T06:30:00.000Z", lastWith);
  const session = await openSession(env.DB, { kind: "client", subjectId: id, deviceLabel: null, now: NOW });
  return { id, cookie: `mm_app=${session}` };
}

/** A visit with a technician, the client's own or, given none, another client's. Its ID. */
export async function visit(
  personId: string | null,
  type: string,
  status: string,
  startsAt: string,
  technicianId: string,
): Promise<string> {
  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO appointments (id, fsm_id, person_id, type, status, fsm_status, window_start, window_end, technician_id,
       fsm_modified_at, synced_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?5, ?6, ?6, ?7, ?8, ?8)`,
  )
    .bind(
      id,
      `fsm-${id}`,
      personId ?? (await aPerson({ name: "Kabir Sood" })).id,
      type,
      status,
      startsAt,
      technicianId,
      NOW.toISOString(),
    )
    .run();
  return id;
}

export const later = (minutes: number) =>
  appFor("local", fakeDependencies({ now: () => new Date(NOW.getTime() + minutes * 60_000) }), {}, "client");
