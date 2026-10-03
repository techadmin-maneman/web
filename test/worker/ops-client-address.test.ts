// An address a client gives ops on the phone, recorded on their page (src/routes/ops-client-address.ts;
// docs/decisions/0092-task-owners.md, open point 62). Saved as the client's own save in the app saves one, marked as
// given to ops. NOW is Monday 21 September 2026, 12 noon in India. Every name and number here is made up.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import type { App } from "../../src/http/context.ts";
import { openSession } from "../../src/domain/sessions.ts";
import { appFor, captureLogs, fakeDependencies, fakeQueue, markDatabase, NOW, request } from "./helpers.ts";

const PERSON = "11111111-1111-4111-8111-111111111111";
const UNKNOWN = "99999999-9999-4999-8999-999999999999";
const VISIT = "22222222-2222-4222-8222-222222222222";
const ORIGIN = { Origin: "https://maneman.test", "Content-Type": "application/json" };

/** The address as the client read it out, with the building ops found in the search. */
const GIVEN = {
  line1: "Sunrise Greens",
  line2: null,
  locality: "Sector 65",
  city: "Gurgaon",
  pincode: "122018",
  access_notes: "Gate 2, then the lift on the left",
  building: "Sunrise Greens",
  flat: "Flat 1203",
  floor: "12",
  tower: "Tower C",
  landmark: null,
  place_id: "stub-place-sunrise",
  session_token: "s-1",
};

let ops: App;
let queues: { CRM_QUEUE: ReturnType<typeof fakeQueue>; FSM_QUEUE: ReturnType<typeof fakeQueue> };

const post = (app: App, path: string, body: unknown) =>
  request(app, path, { method: "POST", headers: ORIGIN, body: JSON.stringify(body) }, queues);
const save = (body: unknown, personId = PERSON) => post(ops, `/api/clients/${personId}/address`, body);

const current = () =>
  env.DB.prepare(
    `SELECT line1, flat, place_id, lat IS NOT NULL AS pinned, geocode_source, given_to_staff, created_at
     FROM addresses WHERE person_id = ?1 AND replaced_at IS NULL`,
  )
    .bind(PERSON)
    .first();

beforeEach(async () => {
  captureLogs();
  await markDatabase();
  ops = appFor("local", fakeDependencies(), {}, "ops");
  queues = { CRM_QUEUE: fakeQueue(), FSM_QUEUE: fakeQueue() };
  await env.DB.prepare(
    "INSERT INTO people (id, created_at, mobile_e164, name) VALUES (?1, '2026-08-01T06:00:00.000Z', '+919810000001', 'Rohit Malhotra')",
  )
    .bind(PERSON)
    .run();
});

describe("POST /api/clients/{id}/address", () => {
  it("saves the address as the client's, geocoding the building, marked as given to the member of staff", async () => {
    const answer = await save(GIVEN);
    expect(answer.status).toBe(200);
    expect(await answer.json()).toMatchObject({
      line1: "Sunrise Greens",
      flat: "Flat 1203",
      tower: "Tower C",
      access_notes: "Gate 2, then the lift on the left",
      given_to_ops: { by: "ops@localhost", at: NOW.toISOString() },
    });
    expect(await current()).toEqual({
      line1: "Sunrise Greens",
      flat: "Flat 1203",
      place_id: "stub-place-sunrise",
      pinned: 1,
      geocode_source: "google_geocoding",
      given_to_staff: "ops@localhost",
      created_at: NOW.toISOString(),
    });
  });

  it("audits it in the same write, naming the client and no part of the address", async () => {
    await save(GIVEN);
    const entries = await env.DB.prepare(
      "SELECT actor, subject_kind, subject_id, detail FROM audit_log WHERE action = 'address.given_to_ops'",
    ).all();
    expect(entries.results).toEqual([
      { actor: "ops@localhost", subject_kind: "person", subject_id: PERSON, detail: null },
    ]);
  });

  it("sends it on to FSM's contact and the CRM, as the client's own save does", async () => {
    await save(GIVEN);
    expect(queues.FSM_QUEUE.sent).toEqual([expect.objectContaining({ update_contact_person_id: PERSON })]);
    expect(queues.CRM_QUEUE.sent).toEqual([expect.objectContaining({ update_person_id: PERSON })]);
  });

  it("replaces the address before it, which is kept as replaced", async () => {
    await env.DB.prepare(
      `INSERT INTO addresses (id, person_id, created_at, line1, locality, city, pincode)
       VALUES ('address-1', ?1, '2026-09-01T06:00:00.000Z', 'House 7', 'Sector 65', 'Gurgaon', '122018')`,
    )
      .bind(PERSON)
      .run();
    await save(GIVEN);
    const rows = await env.DB.prepare(
      "SELECT line1, replaced_at IS NULL AS current FROM addresses ORDER BY created_at",
    ).all();
    expect(rows.results).toEqual([
      { line1: "House 7", current: 0 },
      { line1: "Sunrise Greens", current: 1 },
    ]);
  });

  it("takes a typed address with no building, and saves no pin rather than a wrong one", async () => {
    expect((await save({ ...GIVEN, building: null, place_id: null, session_token: null })).status).toBe(200);
    expect(await current()).toMatchObject({ place_id: null, pinned: 0, given_to_staff: "ops@localhost" });
  });

  it("refuses what the app's own save refuses", async () => {
    for (const body of [
      { ...GIVEN, flat: "" },
      { ...GIVEN, locality: "" },
      { ...GIVEN, pincode: "12201" },
      { ...GIVEN, lat: 28.4, lng: 77.0 },
    ]) {
      expect((await save(body)).status, JSON.stringify(body)).toBe(400);
    }
    expect(await current()).toBeNull();
  });

  it("geocodes no building once the day's ceiling is reached, and saves the address all the same", async () => {
    const capped = appFor("local", fakeDependencies(), { geocode: { apiKey: null, dailyCeiling: 0 } }, "ops");
    expect((await post(capped, `/api/clients/${PERSON}/address`, GIVEN)).status).toBe(200);
    expect(await current()).toMatchObject({ place_id: "stub-place-sunrise", pinned: 0 });
  });

  // A service token is let in by Access, and names no member of staff for the address to be marked with.
  it("saves nothing for a service token", async () => {
    const service = appFor(
      "local",
      fakeDependencies({
        access: { verify: () => Promise.resolve({ ok: true, identity: { kind: "service", clientId: "ci.access" } }) },
      }),
      {},
      "ops",
    );
    const answer = await post(service, `/api/clients/${PERSON}/address`, GIVEN);
    expect(answer.status).toBe(403);
    expect(await answer.json()).toMatchObject({ error: { code: "access_required" } });
    expect(await current()).toBeNull();
    expect(queues.FSM_QUEUE.sent).toEqual([]);
  });

  it("answers 404 for a client we do not have, or one erased", async () => {
    expect((await save(GIVEN, UNKNOWN)).status).toBe(404);
    await env.DB.prepare("UPDATE people SET erased_at = ?1").bind(NOW.toISOString()).run();
    expect((await save(GIVEN)).status).toBe(404);
  });

  // A visit to come with no address waits on the Tasks board; ops confirm it with the client on the phone.
  it("takes the visit's Address to confirm off the Tasks board", async () => {
    await env.DB.prepare(
      `INSERT INTO appointments (id, fsm_id, person_id, type, window_start, window_end, status, fsm_status,
         fsm_modified_at, synced_at, first_seen_at)
       VALUES (?1, 'fsm-1', ?2, 'consultation', '2026-09-23T04:30:00.000Z', '2026-09-23T05:30:00.000Z', 'scheduled',
         'Scheduled', ?3, ?3, ?3)`,
    )
      .bind(VISIT, PERSON, NOW.toISOString())
      .run();
    const groups = async () =>
      (await (await request(ops, "/api/tasks")).json<{ groups: { group: string }[] }>()).groups.map((g) => g.group);
    expect(await groups()).toEqual(["address_to_confirm"]);

    await save(GIVEN);
    expect(await groups()).toEqual([]);
  });

  it("shows on the client's page who it was given to, and when", async () => {
    await save(GIVEN);
    const record = await (await request(ops, `/api/clients/${PERSON}`)).json<{ address: unknown }>();
    expect(record.address).toMatchObject({ given_to_ops: { by: "ops@localhost", at: NOW.toISOString() } });
  });
});

describe("the client, afterwards", () => {
  const client = () => appFor("local", fakeDependencies(), {}, "client");
  async function asClient(method: string, path: string, body?: unknown) {
    const cookie = `mm_app=${await openSession(env.DB, { kind: "client", subjectId: PERSON, deviceLabel: null, now: NOW })}`;
    return request(
      client(),
      path,
      {
        method,
        headers: { ...ORIGIN, Cookie: cookie },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      },
      queues,
    );
  }

  it("sees the address in their profile, and when they gave it to us on the phone, never who took it", async () => {
    await save(GIVEN);
    const profile = await (await asClient("GET", "/api/profile")).json<Record<string, unknown>>();
    expect(profile.address).toMatchObject({ line1: "Sunrise Greens", flat: "Flat 1203" });
    expect(profile.address_given_to_ops).toBe(NOW.toISOString());
    expect(JSON.stringify(profile)).not.toContain("ops@localhost");
  });

  it("changes it as any address, which is then their own", async () => {
    await env.DB.prepare(
      "INSERT INTO serviceable_pincodes (pincode, area, city, served) VALUES ('122018', 'Sector 65', 'Gurgaon', 1)",
    ).run();
    await save(GIVEN);
    const { session_token: _, ...theirs } = GIVEN;
    expect((await asClient("PATCH", "/api/profile/address", { ...theirs, flat: "Flat 1204" })).status).toBe(200);
    const profile = await (await asClient("GET", "/api/profile")).json<Record<string, unknown>>();
    expect(profile.address).toMatchObject({ flat: "Flat 1204" });
    expect(profile.address_given_to_ops).toBeNull();
    expect(await current()).toMatchObject({ given_to_staff: null });
  });
});

describe("POST /api/clients/{id}/address/suggestions", () => {
  const suggest = (app: App, q: string, session: string, personId = PERSON) =>
    post(app, `/api/clients/${personId}/address/suggestions`, { q, session });

  it("suggests buildings, with Google's name, as the app's search does", async () => {
    const answer = await suggest(ops, "Sunrise", "s-1");
    expect(answer.status).toBe(200);
    expect(await answer.json()).toEqual({
      suggestions: [{ place_id: "stub-place-sunrise", primary: "Sunrise Greens", secondary: "Sector 65, Gurugram" }],
      attribution: "Google Maps",
    });
  });

  it("answers busy, having spent nothing more, once the day's ceiling is reached", async () => {
    const capped = appFor("local", fakeDependencies(), { geocode: { apiKey: null, dailyCeiling: 1 } }, "ops");
    expect((await suggest(capped, "Sunrise", "s-1")).status).toBe(200);
    const refused = await suggest(capped, "Mayfield", "s-2");
    expect(refused.status).toBe(503);
    expect(await refused.json()).toMatchObject({ error: { code: "busy" } });
  });

  it("answers 404 for a client we do not have, and spends nothing", async () => {
    expect((await suggest(ops, "Sunrise", "s-1", UNKNOWN)).status).toBe(404);
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM counters").first()).toEqual({ n: 0 });
  });
});
