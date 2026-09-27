// One client's record on the ops surface (src/routes/ops-clients.ts): the client
// page, its photographs and its consents, Ops Console B1 to B3. NOW is Monday
// 21 September 2026, 12 noon in India. Every name, number and photograph is made up.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import type { App } from "../../src/http/context.ts";
import { grantCredits } from "../../src/domain/credits.ts";
import { PHOTO_VIEW_MINUTES } from "../../src/domain/photo-views.ts";
import { CLIENTS_FOUND } from "../../src/routes/ops-clients.ts";
import { appFor, captureLogs, fakeDependencies, markDatabase, NOW, request } from "./helpers.ts";

const PERSON = "11111111-1111-4111-8111-111111111111";
const OTHER = "11111111-1111-4111-8111-111111111112";
const UNKNOWN = "99999999-9999-4999-8999-999999999999";
const VISIT = "22222222-2222-4222-8222-222222222222";
const SET = "33333333-3333-4333-8333-333333333333";
const FRONT = "44444444-4444-4444-8444-444444444441";
const TOP = "44444444-4444-4444-8444-444444444442";
const PAYMENT = "55555555-5555-4555-8555-555555555555";
const MOBILE = "+919810000001";

let ops: App;

async function person(id: string, name: string, mobile: string) {
  await env.DB.prepare("INSERT INTO people (id, created_at, mobile_e164, name) VALUES (?1, ?2, ?3, ?4)")
    .bind(id, "2026-08-01T06:00:00.000Z", mobile, name)
    .run();
}

/** A finished service visit with a technician, an address, two photographs, a payment and a credit. */
async function record() {
  await env.DB.prepare(
    "INSERT INTO technicians (id, fsm_id, name, initials, active, updated_at) VALUES ('t1', 'fsm-t1', 'Imran Qureshi', 'IQ', 1, ?1)",
  )
    .bind(NOW.toISOString())
    .run();
  await env.DB.prepare(
    `INSERT INTO appointments (id, fsm_id, person_id, type, status, fsm_status, window_start, window_end,
       technician_id, service_city, service_pincode, fsm_modified_at, synced_at)
     VALUES (?1, 'fsm-1', ?2, 'service', 'completed', 'Completed', '2026-09-10T04:30:00.000Z',
       '2026-09-10T07:30:00.000Z', 't1', 'Gurgaon', '122018', ?3, ?3)`,
  )
    .bind(VISIT, PERSON, NOW.toISOString())
    .run();
  await env.DB.prepare(
    "INSERT INTO visits (id, appointment_id, outcome, duration_minutes, updated_at) VALUES ('v1', ?1, 'partial', 95, ?2)",
  )
    .bind(VISIT, NOW.toISOString())
    .run();
  await env.DB.prepare(
    `INSERT INTO addresses (id, person_id, created_at, line1, line2, locality, city, pincode, access_notes)
     VALUES ('addr-1', ?1, ?2, 'House 7', NULL, 'Sector 65', 'Gurgaon', '122018', 'Gate 4417, visitor bay B')`,
  )
    .bind(PERSON, NOW.toISOString())
    .run();
  await env.DB.prepare("INSERT INTO photo_sets (id, appointment_id, phase, created_at) VALUES (?1, ?2, 'after', ?3)")
    .bind(SET, VISIT, NOW.toISOString())
    .run();
  for (const [id, angle] of [
    [TOP, "top"],
    [FRONT, "front"],
  ] as const) {
    await env.DB.prepare(
      `INSERT INTO photos (id, photo_set_id, angle, r2_key, content_type, bytes, width, height, taken_at, created_at)
       VALUES (?1, ?2, ?3, ?4, 'image/jpeg', 3, 600, 800, ?5, ?5)`,
    )
      .bind(id, SET, angle, `visits/${VISIT}/after-${angle}.jpg`, NOW.toISOString())
      .run();
    await env.CLIENT_PHOTOS.put(`visits/${VISIT}/after-${angle}.jpg`, new Uint8Array([1, 2, 3]));
  }
  await env.DB.prepare(
    `INSERT INTO payments (id, reference, person_id, appointment_id, razorpay_payment_id, amount, currency, method,
       status, created_at, updated_at)
     VALUES (?1, 'MM-2026-0841', ?2, ?3, 'pay_1', 236000, 'INR', 'upi', 'captured', ?4, ?4)`,
  )
    .bind(PAYMENT, PERSON, VISIT, "2026-09-09T06:00:00.000Z")
    .run();
  await grantCredits(env.DB, { personId: PERSON, visits: 2, source: "ops", sourceId: "o1", now: NOW }).run();
}

async function consent(purpose: string, granted: 0 | 1, notice: string, at: string) {
  await env.DB.prepare(
    "INSERT INTO consents (id, person_id, purpose, notice_version, granted, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
  )
    .bind(crypto.randomUUID(), PERSON, purpose, notice, granted, at)
    .run();
}

const auditRows = () =>
  env.DB.prepare("SELECT action, actor, subject_kind, subject_id, detail FROM audit_log WHERE action != 'ops.call'")
    .all<{ action: string; actor: string; subject_kind: string; subject_id: string; detail: string | null }>()
    .then((rows) => rows.results);

beforeEach(async () => {
  captureLogs();
  ops = appFor("local", fakeDependencies(), {}, "ops");
  await markDatabase();
  await person(PERSON, "Rohit Malhotra", MOBILE);
});

describe("GET /api/clients/{id}", () => {
  it("gives ops the client, their address, their visits with technician and outcome, and their payments", async () => {
    await record();
    const body = await (await request(ops, `/api/clients/${PERSON}`)).json<Record<string, never>>();

    expect(body).toMatchObject({
      id: PERSON,
      name: "Rohit Malhotra",
      mobile: MOBILE,
      state: "fitted",
      known_since: "2026-08-01T06:00:00.000Z",
      address: {
        line1: "House 7",
        locality: "Sector 65",
        city: "Gurgaon",
        pincode: "122018",
        access_notes: "Gate 4417, visitor bay B",
      },
      credits: { visits: 2 },
      payments: [{ kind: "payment", id: PAYMENT, reference: "MM-2026-0841", amount: 236000 }],
    });
    expect(body.visits).toEqual({
      upcoming: [],
      past: [
        expect.objectContaining({
          id: VISIT,
          date: "2026-09-10",
          type: "service",
          status: "completed",
          outcome: "partial",
          technician: { name: "Imran Qureshi", initials: "IQ" },
          place: "Sector 65, Gurgaon 122018",
        }),
      ],
    });
  });

  it("reads nothing booked and no address for a client with only a record", async () => {
    const body = await (await request(ops, `/api/clients/${PERSON}`)).json();
    expect(body).toMatchObject({
      state: "nothing_booked",
      address: null,
      credits: null,
      visits: { upcoming: [], past: [] },
      payments: [],
    });
  });

  it("answers 404 for a client we do not have", async () => {
    const answer = await request(ops, `/api/clients/${UNKNOWN}`);
    expect(answer.status).toBe(404);
    expect(await answer.json()).toMatchObject({ error: { code: "not_found" } });
  });

  it("answers 404 once the client has been erased", async () => {
    await record();
    await env.DB.prepare("UPDATE people SET erased_at = ?2, name = 'Erased' WHERE id = ?1")
      .bind(PERSON, NOW.toISOString())
      .run();
    for (const path of ["", "/photos", "/consents"]) {
      expect((await request(ops, `/api/clients/${PERSON}${path}`)).status, path).toBe(404);
    }
    expect((await request(ops, `/api/clients/${PERSON}/photos/${FRONT}`)).status).toBe(404);
  });

  it("is refused, and audits nothing, without an Access identity", async () => {
    const refused = appFor(
      "local",
      fakeDependencies({ access: { verify: () => Promise.resolve({ ok: false, reason: "missing" }) } }),
      {},
      "ops",
    );
    const answer = await request(refused, `/api/clients/${PERSON}`);
    expect(answer.status).toBe(403);
    expect(await answer.json()).toMatchObject({ error: { code: "access_required" } });
    expect(await env.DB.prepare("SELECT COUNT(*) AS rows FROM audit_log").first<{ rows: number }>()).toEqual({
      rows: 0,
    });
  });
});

describe("GET /api/clients/{id}/photos", () => {
  it("lists what there is by visit, in the design's angle order, and serves no image or key", async () => {
    await record();
    const body = await (
      await request(ops, `/api/clients/${PERSON}/photos`)
    ).json<{ visits: Record<string, never>[] }>();

    expect(body.visits).toEqual([
      {
        visit_id: VISIT,
        date: "2026-09-10",
        type: "service",
        technician: { name: "Imran Qureshi", initials: "IQ" },
        photos: [
          { id: FRONT, phase: "after", angle: "front", width: 600, height: 800, taken_at: NOW.toISOString() },
          { id: TOP, phase: "after", angle: "top", width: 600, height: 800, taken_at: NOW.toISOString() },
        ],
      },
    ]);
    expect(JSON.stringify(body)).not.toContain("visits/");
    expect(await auditRows()).toEqual([]);
  });
});

/**
 * One opening of a client's photographs is one entry in the log, whose time is
 * the server's (OPS-17). It once wrote an entry for every image, ten for one
 * visit and ten more on every return to the tab, and the console lettered the
 * browser's own clock as the time it was logged.
 */
describe("POST /api/clients/{id}/photos/view", () => {
  const view = (app = ops) =>
    request(app, `/api/clients/${PERSON}/photos/view`, {
      method: "POST",
      headers: { Origin: "https://maneman.test" },
    });

  it("writes one entry naming the staff and the client, and answers when it was logged", async () => {
    await record();
    const answer = await view();

    expect(answer.status).toBe(200);
    expect(await answer.json()).toEqual({
      logged_at: NOW.toISOString(),
      before: [],
    });
    expect(await auditRows()).toEqual([
      { action: "photo.view", actor: "ops@localhost", subject_kind: "person", subject_id: PERSON, detail: null },
    ]);
  });

  it("serves every photograph within the view, and writes nothing more for them", async () => {
    await record();
    await view();
    for (const photo of [FRONT, TOP]) {
      const answer = await request(ops, `/api/clients/${PERSON}/photos/${photo}`);
      expect(answer.status, photo).toBe(200);
      expect(answer.headers.get("Cache-Control")).toBe("private, no-store");
    }
    expect(await auditRows()).toHaveLength(1);
  });

  it("says who opened them before, the latest first", async () => {
    await record();
    const earlier = (minutes: number) =>
      appFor("local", fakeDependencies({ now: () => new Date(NOW.getTime() - minutes * 60_000) }), {}, "ops");
    await view(earlier(24 * 60));
    await view(earlier(90));

    expect(await (await view()).json()).toEqual({
      logged_at: NOW.toISOString(),
      before: [
        { by: "ops@localhost", at: new Date(NOW.getTime() - 90 * 60_000).toISOString() },
        { by: "ops@localhost", at: new Date(NOW.getTime() - 24 * 60 * 60_000).toISOString() },
      ],
    });
  });

  it("logs nothing for a client we do not have", async () => {
    const answer = await request(ops, `/api/clients/${UNKNOWN}/photos/view`, {
      method: "POST",
      headers: { Origin: "https://maneman.test" },
    });
    expect(answer.status).toBe(404);
    expect(await auditRows()).toEqual([]);
  });

  it("opens nothing when the view cannot be logged", async () => {
    await record();
    const answer = await request(
      ops,
      `/api/clients/${PERSON}/photos/view`,
      { method: "POST", headers: { Origin: "https://maneman.test" } },
      { DB: auditFailsFor(env.DB, "photo.view") },
    );
    expect(answer.status).toBe(503);
    expect(await auditRows()).toEqual([]);
  });
});

describe("GET /api/clients/{id}/photos/{photo_id}", () => {
  // The console always opens a view first; a photograph asked for outside one still never leaves unlogged.
  it("logs a view itself, before the image, when none by this member of staff is open", async () => {
    await record();
    const answer = await request(ops, `/api/clients/${PERSON}/photos/${FRONT}`);

    expect(answer.status).toBe(200);
    expect(answer.headers.get("Content-Type")).toBe("image/jpeg");
    expect(answer.headers.get("Cache-Control")).toBe("private, no-store");
    expect(new Uint8Array(await answer.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
    expect(await auditRows()).toEqual([
      { action: "photo.view", actor: "ops@localhost", subject_kind: "person", subject_id: PERSON, detail: null },
    ]);

    // Within the view, the next one adds nothing; once the view has closed, it is logged again.
    await request(ops, `/api/clients/${PERSON}/photos/${TOP}`);
    expect(await auditRows()).toHaveLength(1);
    const later = appFor(
      "local",
      fakeDependencies({ now: () => new Date(NOW.getTime() + (PHOTO_VIEW_MINUTES + 1) * 60_000) }),
      {},
      "ops",
    );
    await request(later, `/api/clients/${PERSON}/photos/${TOP}`);
    expect(await auditRows()).toHaveLength(2);
  });

  it("serves no photograph when the view cannot be audited", async () => {
    await record();
    const answer = await request(
      ops,
      `/api/clients/${PERSON}/photos/${FRONT}`,
      {},
      { DB: auditFailsFor(env.DB, "photo.view") },
    );

    expect(answer.status).toBe(503);
    expect(await answer.json()).toMatchObject({ error: { code: "unavailable" } });
    expect(await auditRows()).toEqual([]);
  });

  it("answers 404, unaudited, for another client's photograph", async () => {
    await record();
    await person(OTHER, "Vikram Sethi", "+919810000002");
    const answer = await request(ops, `/api/clients/${OTHER}/photos/${FRONT}`);

    expect(answer.status).toBe(404);
    expect(await auditRows()).toEqual([]);
  });
});

describe("GET /api/clients/{id}/consents", () => {
  it("gives every purpose its state, notice version and date, with any deletion request", async () => {
    await consent("photos_own_record", 1, "photos-own-record-v1", "2026-08-02T06:00:00.000Z");
    await consent("whatsapp_visits", 1, "whatsapp-visits-v1", "2026-08-02T06:00:00.000Z");
    await consent("whatsapp_visits", 0, "whatsapp-visits-v1", "2026-09-01T06:00:00.000Z");
    await env.DB.prepare(
      "INSERT INTO deletion_requests (id, person_id, created_at, state) VALUES (?1, ?2, ?3, 'requested')",
    )
      .bind("66666666-6666-4666-8666-666666666666", PERSON, NOW.toISOString())
      .run();

    const body = await (await request(ops, `/api/clients/${PERSON}/consents`)).json();
    expect(body).toEqual({
      consents: [
        {
          purpose: "photos_own_record",
          state: "given",
          notice_version: "photos-own-record-v1",
          at: "2026-08-02T06:00:00.000Z",
        },
        { purpose: "photos_referral_cards", state: "not_given", notice_version: null, at: null },
        { purpose: "photos_marketing", state: "not_given", notice_version: null, at: null },
        {
          purpose: "whatsapp_visits",
          state: "withdrawn",
          notice_version: "whatsapp-visits-v1",
          at: "2026-09-01T06:00:00.000Z",
        },
        { purpose: "whatsapp_launches", state: "not_given", notice_version: null, at: null },
      ],
      deletion: {
        id: "66666666-6666-4666-8666-666666666666",
        state: "requested",
        requested_at: NOW.toISOString(),
        decided_at: null,
      },
    });
  });
});

describe("POST /api/clients/search", () => {
  const search = (mobile: string) =>
    request(ops, "/api/clients/search", {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "https://maneman.test" },
      body: JSON.stringify({ mobile }),
    });

  it("finds the client from a number typed any of the usual ways, and never puts it in the URL", async () => {
    const answer = await search("98100 00001");
    expect(await answer.json()).toEqual({ id: PERSON, name: "Rohit Malhotra", mobile: MOBILE });
  });

  it("answers 404 for a number we do not have, and 400 for one that is not a mobile number", async () => {
    expect((await search("9810000009")).status).toBe(404);
    const bad = await search("12345");
    expect(bad.status).toBe(400);
    expect(await bad.json()).toMatchObject({ error: { code: "invalid_request", fields: ["mobile"] } });
  });
});

// A client could be found only by typing their whole number exactly (OPS-04).
describe("POST /api/clients/find", () => {
  const find = (text: string) =>
    request(ops, "/api/clients/find", {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "https://maneman.test" },
      body: JSON.stringify({ text }),
    });
  const found = async (text: string) =>
    (await (await find(text)).json<{ clients: { name: string }[]; more: boolean }>()).clients.map((each) => each.name);

  beforeEach(async () => {
    await person(OTHER, "Vikram Sethi", "+919810000002");
    await person("11111111-1111-4111-8111-111111111113", "Rohini Sethi", "+919820000003");
  });

  it("finds clients by any part of their name, whatever its case", async () => {
    expect(await found("sethi")).toEqual(["Rohini Sethi", "Vikram Sethi"]);
    expect(await found("ROH")).toEqual(["Rohini Sethi", "Rohit Malhotra"]);
    expect(await (await find("vikram")).json()).toEqual({
      clients: [{ id: OTHER, name: "Vikram Sethi", mobile: "+919810000002" }],
      more: false,
    });
  });

  it("finds clients by any four or more digits of their number, typed any of the usual ways", async () => {
    expect(await found("98100")).toEqual(["Rohit Malhotra", "Vikram Sethi"]);
    expect(await found("+91 98200-00003")).toEqual(["Rohini Sethi"]);
  });

  it("treats a percent sign or an underscore as itself, not as a wildcard", async () => {
    expect(await found("%%")).toEqual([]);
    expect(await found("R_hit")).toEqual([]);
  });

  it("leaves out an erased client", async () => {
    await env.DB.prepare("UPDATE people SET erased_at = ?1 WHERE id = ?2").bind(NOW.toISOString(), OTHER).run();
    expect(await found("sethi")).toEqual(["Rohini Sethi"]);
  });

  it("lists a page at most, and says there are more", async () => {
    await env.DB.batch(
      Array.from({ length: CLIENTS_FOUND + 1 }, (_, n) =>
        env.DB.prepare("INSERT INTO people (id, created_at, mobile_e164, name) VALUES (?1, ?2, ?3, ?4)").bind(
          `77777777-7777-4777-8777-${String(n).padStart(12, "0")}`,
          NOW.toISOString(),
          `+9197000${String(n).padStart(5, "0")}`,
          `Kumar ${String(n).padStart(2, "0")}`,
        ),
      ),
    );
    const body = await (await find("kumar")).json<{ clients: unknown[]; more: boolean }>();
    expect(body.clients).toHaveLength(CLIENTS_FOUND);
    expect(body.more).toBe(true);
  });

  it("asks for two letters or four digits at least", async () => {
    for (const text of ["r", "981", "  "]) {
      const answer = await find(text);
      expect(answer.status, text).toBe(400);
      expect(await answer.json()).toMatchObject({ error: { code: "invalid_request", fields: ["text"] } });
    }
  });
});

/** A database whose audit writes for one action fail, to prove nothing audited happens unaudited. */
function auditFailsFor(db: D1Database, action: string): D1Database {
  return new Proxy(db, {
    get(target, property, receiver) {
      if (property !== "prepare") return Reflect.get(target, property, receiver) as unknown;
      return (sql: string): D1PreparedStatement => {
        const statement = target.prepare(sql);
        if (!/INSERT INTO audit_log/i.test(sql)) return statement;
        return new Proxy(statement, {
          get(inner, key, self) {
            if (key !== "bind") return Reflect.get(inner, key, self) as unknown;
            return (...values: unknown[]): D1PreparedStatement =>
              values.includes(action)
                ? ({ run: () => Promise.reject(new Error("D1_ERROR: simulated write failure")) } as D1PreparedStatement)
                : inner.bind(...values);
          },
        });
      };
    },
  });
}
