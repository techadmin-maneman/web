// Customer Care keeps to the caller's cities: once the Staff list is enforced, a grant of one city lists only that
// city's clients and requests, and a record elsewhere is not found. NOW is Monday 21 September 2026, 12 noon in India.
// Every name, number and photograph is made up.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import type { App } from "../../../src/http/context.ts";
import { captureLogs, fakeQueue, markDatabase, NOW, request } from "../helpers.ts";
import { enforce, listStaff, opsAs, person } from "./staff-fixtures.ts";

interface Client {
  readonly id: string;
  readonly name: string;
  readonly mobile: string;
  /** Where they live; null for a client nothing places in a city. */
  readonly pincode: string | null;
  readonly visit: string;
  readonly photo: string;
  readonly grievance: string;
  readonly change: string;
  readonly deletion: string;
}

/** A client whose IDs all end in the same digit. */
function clientNumbered(digit: number, name: string, pincode: string | null): Client {
  const end = (prefix: string) => `${prefix}${String(digit)}`;
  return {
    id: end("11111111-1111-4111-8111-11111111111"),
    name,
    mobile: `+91981000000${String(digit)}`,
    pincode,
    visit: end("22222222-2222-4222-8222-22222222222"),
    photo: end("33333333-3333-4333-8333-33333333333"),
    grievance: end("44444444-4444-4444-8444-44444444444"),
    change: end("55555555-5555-4555-8555-55555555555"),
    deletion: end("66666666-6666-4666-8666-66666666666"),
  };
}

const IN_DELHI = clientNumbered(1, "Arjun Mehta", "110017");
const IN_GURGAON = clientNumbered(2, "Rohit Mehta", "122018");
const NOWHERE = clientNumbered(3, "Zoya Mehta", null);

const AT = NOW.toISOString();
const ORIGIN = { Origin: "https://maneman.test", "Content-Type": "application/json" };

let queues: { CRM_QUEUE: ReturnType<typeof fakeQueue>; FSM_QUEUE: ReturnType<typeof fakeQueue> };

const get = (app: App, path: string) => request(app, path, undefined, queues);
const post = (app: App, path: string, body: unknown = {}) =>
  request(app, path, { method: "POST", headers: ORIGIN, body: JSON.stringify(body) }, queues);

const photoKey = (client: Client) => `visits/${client.visit}/after-front.jpg`;

/** The client, their address, a visit there with one photograph, and a grievance, number change and deletion open. */
async function seed(client: Client): Promise<void> {
  const db = env.DB;
  const statements = [
    db
      .prepare("INSERT INTO people (id, created_at, mobile_e164, name) VALUES (?1, ?2, ?3, ?4)")
      .bind(client.id, AT, client.mobile, client.name),
    db
      .prepare(
        `INSERT INTO appointments (id, fsm_id, person_id, type, status, window_start, window_end, technician_id,
           service_pincode, synced_at)
         VALUES (?1, ?1, ?2, 'service', 'completed', '2026-09-10T04:30:00.000Z', '2026-09-10T07:30:00.000Z', 't1',
           ?3, ?4)`,
      )
      .bind(client.visit, client.id, client.pincode, AT),
    db
      .prepare("INSERT INTO photo_sets (id, appointment_id, phase, created_at) VALUES (?1, ?1, 'after', ?2)")
      .bind(client.visit, AT),
    db
      .prepare(
        `INSERT INTO photos (id, photo_set_id, angle, r2_key, content_type, bytes, width, height, taken_at, created_at)
         VALUES (?1, ?2, 'front', ?3, 'image/jpeg', 3, 600, 800, ?4, ?4)`,
      )
      .bind(client.photo, client.visit, photoKey(client), AT),
    db
      .prepare(
        "INSERT INTO grievances (id, person_id, text, state, created_at) VALUES (?1, ?2, 'Late again.', 'open', ?3)",
      )
      .bind(client.grievance, client.id, AT),
    db
      .prepare(
        `INSERT INTO number_change_requests (id, person_id, created_at, new_mobile_e164, old_verified_at,
           new_verified_at, state)
         VALUES (?1, ?2, ?3, ?4, ?3, ?3, 'awaiting_ops')`,
      )
      .bind(client.change, client.id, AT, client.mobile.replace("98100", "98200")),
    db
      .prepare("INSERT INTO deletion_requests (id, person_id, created_at, state) VALUES (?1, ?2, ?3, 'requested')")
      .bind(client.deletion, client.id, AT),
  ];
  if (client.pincode !== null) {
    statements.push(
      db
        .prepare(
          `INSERT INTO addresses (id, person_id, created_at, line1, locality, city, pincode)
           VALUES (?1, ?1, ?2, 'House 7', 'Market Road', 'Delhi NCR', ?3)`,
        )
        .bind(client.id, AT, client.pincode),
    );
  }
  await db.batch(statements);
  await env.CLIENT_PHOTOS.put(photoKey(client), new Uint8Array([1, 2, 3]));
}

beforeEach(async () => {
  captureLogs();
  await markDatabase();
  queues = { CRM_QUEUE: fakeQueue(), FSM_QUEUE: fakeQueue() };
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO serviceable_pincodes (pincode, area, city, served) VALUES
         ('110017', 'Saket', 'Delhi', 1), ('122018', 'Sector 65', 'Gurgaon', 1)`,
    ),
    env.DB.prepare(
      "INSERT INTO technicians (id, fsm_id, name, initials, active, updated_at) VALUES ('t1', 't1', 'Imran Qureshi', 'IQ', 1, ?1)",
    ).bind(AT),
  ]);
  for (const client of [IN_DELHI, IN_GURGAON, NOWHERE]) await seed(client);
});

/** The ops console as a member of staff holding these grants, with the Staff list enforced. */
async function staffWith(...grants: `${string}:${string}:${string}`[]): Promise<App> {
  await enforce();
  await listStaff("care@maneman.in", grants);
  return opsAs(person("care@maneman.in"));
}

const idsIn = async (res: Response, key: string): Promise<string[]> =>
  ((await res.json<Record<string, { id: string }[]>>())[key] ?? []).map((row) => row.id).sort();

const errorCode = async (res: Response) => (await res.json<{ error: { code: string } }>()).error.code;

/** The hair profile as ops send it: every field, null where it was not taken. */
const CORRECTION = {
  fit: {
    norwood_stage: "IV",
    head_circumference_cm: 57.5,
    front_to_nape_cm: 36,
    ear_to_ear_cm: 33.5,
    temple_to_temple_cm: 34,
    base_width_in: 8,
    base_length_in: 10,
    colour: "1B",
    grey_percent: 20,
    density_percent: 120,
    wave: "slight_wave",
    hairline: "natural",
    product: null,
    attachment: "tape",
  },
  history: null,
  based_on: null,
};

const ADDRESS = {
  line1: "Sunrise Greens",
  line2: null,
  locality: "Saket",
  city: "Delhi",
  pincode: "110017",
  access_notes: null,
  building: "Sunrise Greens",
  flat: "Flat 1203",
  floor: "12",
  tower: "Tower C",
  landmark: null,
  place_id: "stub-place-sunrise",
  session_token: "s-1",
};

describe("a grant of Customer Care in one city", () => {
  let delhi: App;

  beforeEach(async () => {
    delhi = await staffWith("customer_care:manage:city:Delhi");
  });

  it("finds a client by their number in its city, and not one elsewhere", async () => {
    const found = await post(delhi, "/api/clients/search", { mobile: IN_DELHI.mobile });
    expect(found.status).toBe(200);
    expect(await found.json()).toMatchObject({ id: IN_DELHI.id });

    const elsewhere = await post(delhi, "/api/clients/search", { mobile: IN_GURGAON.mobile });
    expect(elsewhere.status).toBe(404);
    expect(await errorCode(elsewhere)).toBe("not_found");
  });

  it("lists only its city's clients by part of a name or a number", async () => {
    expect(await idsIn(await post(delhi, "/api/clients/find", { text: "Mehta" }), "clients")).toEqual([IN_DELHI.id]);
    expect(await idsIn(await post(delhi, "/api/clients/find", { text: "98100" }), "clients")).toEqual([IN_DELHI.id]);
  });

  const CLIENT_READS: readonly [string, (client: Client) => string][] = [
    ["the record", (client) => `/api/clients/${client.id}`],
    ["the photographs", (client) => `/api/clients/${client.id}/photos`],
    ["a photograph", (client) => `/api/clients/${client.id}/photos/${client.photo}`],
    ["the consents", (client) => `/api/clients/${client.id}/consents`],
    ["the pieces", (client) => `/api/clients/${client.id}/pieces`],
    ["the hair profile", (client) => `/api/clients/${client.id}/hair-profile`],
  ];

  it.each(CLIENT_READS)("opens %s of a client in its city, and finds none elsewhere", async (_, path) => {
    expect((await get(delhi, path(IN_DELHI))).status).toBe(200);
    expect((await get(delhi, path(IN_GURGAON))).status).toBe(404);
    expect((await get(delhi, path(NOWHERE))).status).toBe(404);
  });

  it("logs an opening of the photographs only in its city", async () => {
    expect((await post(delhi, `/api/clients/${IN_DELHI.id}/photos/view`)).status).toBe(200);
    expect((await post(delhi, `/api/clients/${IN_GURGAON.id}/photos/view`)).status).toBe(404);

    const opened = await env.DB.prepare("SELECT subject_id FROM audit_log WHERE action = 'photo.view'").all();
    expect(opened.results).toEqual([{ subject_id: IN_DELHI.id }]);
  });

  it("corrects a hair profile only in its city", async () => {
    expect((await post(delhi, `/api/clients/${IN_DELHI.id}/hair-profile`, CORRECTION)).status).toBe(200);
    expect((await post(delhi, `/api/clients/${IN_GURGAON.id}/hair-profile`, CORRECTION)).status).toBe(404);

    const versions = await env.DB.prepare("SELECT person_id FROM hair_profiles").all();
    expect(versions.results).toEqual([{ person_id: IN_DELHI.id }]);
  });

  it("takes an address on the phone only in its city", async () => {
    const suggest = (client: Client) =>
      post(delhi, `/api/clients/${client.id}/address/suggestions`, { q: "Sunrise", session: "s-1" });
    expect((await suggest(IN_DELHI)).status).toBe(200);
    expect((await suggest(IN_GURGAON)).status).toBe(404);

    expect((await post(delhi, `/api/clients/${IN_DELHI.id}/address`, ADDRESS)).status).toBe(200);
    expect((await post(delhi, `/api/clients/${IN_GURGAON.id}/address`, ADDRESS)).status).toBe(404);
    const given = await env.DB.prepare("SELECT person_id FROM addresses WHERE given_to_staff IS NOT NULL").all();
    expect(given.results).toEqual([{ person_id: IN_DELHI.id }]);
  });

  it("erases a client only in its city", async () => {
    expect((await post(delhi, `/api/clients/${IN_GURGAON.id}/erasure`)).status).toBe(404);
    expect((await post(delhi, `/api/clients/${NOWHERE.id}/erasure`)).status).toBe(404);
    expect((await post(delhi, `/api/clients/${IN_DELHI.id}/erasure`)).status).toBe(200);

    const erased = await env.DB.prepare("SELECT id FROM people WHERE erased_at IS NOT NULL").all();
    expect(erased.results).toEqual([{ id: IN_DELHI.id }]);
  });

  it("lists and answers only its city's grievances", async () => {
    expect(await idsIn(await get(delhi, "/api/grievances"), "grievances")).toEqual([IN_DELHI.grievance]);

    const answer = { response: "Sorted on the phone." };
    expect((await post(delhi, `/api/grievances/${IN_GURGAON.grievance}/resolve`, answer)).status).toBe(404);
    expect((await post(delhi, `/api/grievances/${IN_DELHI.grievance}/resolve`, answer)).status).toBe(200);
    const open = await env.DB.prepare("SELECT id FROM grievances WHERE state = 'open' ORDER BY id").all();
    expect(open.results).toEqual([{ id: IN_GURGAON.grievance }, { id: NOWHERE.grievance }]);
  });

  it("lists and decides only its city's number changes", async () => {
    expect(await idsIn(await get(delhi, "/api/number-changes"), "changes")).toEqual([IN_DELHI.change]);

    const rejection = { decision: "reject", reason: "The client asked us to stop it." };
    expect((await post(delhi, `/api/number-changes/${IN_GURGAON.change}/decision`, rejection)).status).toBe(404);
    expect((await post(delhi, `/api/number-changes/${IN_DELHI.change}/decision`, rejection)).status).toBe(200);
    const waiting = await env.DB.prepare(
      "SELECT id FROM number_change_requests WHERE state = 'awaiting_ops' ORDER BY id",
    ).all();
    expect(waiting.results).toEqual([{ id: IN_GURGAON.change }, { id: NOWHERE.change }]);
  });

  it("lists and decides only its city's deletion requests", async () => {
    expect(await idsIn(await get(delhi, "/api/deletion-requests"), "requests")).toEqual([IN_DELHI.deletion]);

    const rejection = { decision: "reject", reason: "The client withdrew it on the phone." };
    expect((await post(delhi, `/api/deletion-requests/${IN_GURGAON.deletion}/decision`, rejection)).status).toBe(404);
    expect((await post(delhi, `/api/deletion-requests/${IN_DELHI.deletion}/decision`, rejection)).status).toBe(200);
    const waiting = await env.DB.prepare(
      "SELECT id FROM deletion_requests WHERE state = 'requested' ORDER BY id",
    ).all();
    expect(waiting.results).toEqual([{ id: IN_GURGAON.deletion }, { id: NOWHERE.deletion }]);
  });
});

describe("Customer Care's reach", () => {
  it("is each level's own: a national View reads everywhere while an Act in one city acts only there", async () => {
    const care = await staffWith("customer_care:view:national", "customer_care:act:city:Delhi");

    expect((await get(care, `/api/clients/${IN_GURGAON.id}`)).status).toBe(200);
    expect(await idsIn(await get(care, "/api/grievances"), "grievances")).toHaveLength(3);
    const answer = { response: "Sorted on the phone." };
    expect((await post(care, `/api/grievances/${IN_GURGAON.grievance}/resolve`, answer)).status).toBe(404);
    expect((await post(care, `/api/grievances/${IN_DELHI.grievance}/resolve`, answer)).status).toBe(200);
  });

  it("takes in every city of a zone, and a client in no city only nationally", async () => {
    const ncr = await staffWith("customer_care:view:zone:NCR");
    expect(await idsIn(await post(ncr, "/api/clients/find", { text: "Mehta" }), "clients")).toEqual([
      IN_DELHI.id,
      IN_GURGAON.id,
    ]);
  });

  it("is everywhere for a national grant", async () => {
    const national = await staffWith("customer_care:view:national");
    expect(await idsIn(await post(national, "/api/clients/find", { text: "Mehta" }), "clients")).toHaveLength(3);
    expect((await get(national, `/api/clients/${NOWHERE.id}`)).status).toBe(200);
  });

  it("narrows nothing while the Staff list is not enforced", async () => {
    await listStaff("delhi@maneman.in", ["customer_care:view:city:Delhi"]);
    const delhi = opsAs(person("delhi@maneman.in"));

    expect(await idsIn(await get(delhi, "/api/grievances"), "grievances")).toHaveLength(3);
    expect((await get(delhi, `/api/clients/${IN_GURGAON.id}`)).status).toBe(200);
  });
});
