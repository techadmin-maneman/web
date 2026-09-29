// A client's rights over their data (docs/decisions/0049-dpdp.md): erasure reaching Phase 2's data and FSM, the
// data export, grievances, and the deletion window's alert. NOW is Monday 21 September 2026, 12 noon in India.
// Every name and number here is made up.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { alertAgedDeletions } from "../../src/domain/deletion.ts";
import { logPhotoView } from "../../src/domain/photo-views.ts";
import { openSession } from "../../src/domain/sessions.ts";
import { createCallBudget } from "../../src/lib/call-budget.ts";
import { createLogger } from "../../src/log.ts";
import { createStubFsm } from "../../src/providers/fsm.ts";
import { MAX_SYNC_ATTEMPTS } from "../../src/queues/crm-sync.ts";
import { handleFsmSyncBatch } from "../../src/queues/fsm-sync.ts";
import { sweep } from "../../src/scheduled/sweeper.ts";
import {
  appFor,
  captureLogs,
  eraseByMobile,
  fakeDependencies,
  fakeQueue,
  markDatabase,
  NOW,
  request,
} from "./helpers.ts";

const PERSON = "11111111-1111-4111-8111-111111111111";
const VISIT = "22222222-2222-4222-8222-222222222222";
const MOBILE = "+919810000001";

let cookie: string;

beforeEach(async () => {
  await markDatabase();
  captureLogs();
  await env.DB.prepare(
    "INSERT INTO people (id, created_at, mobile_e164, name, fsm_contact_id) VALUES (?1, ?2, ?3, 'Rohit Malhotra', 'contact-1')",
  )
    .bind(PERSON, NOW.toISOString(), MOBILE)
    .run();
  cookie = `mm_app=${await openSession(env.DB, { kind: "client", subjectId: PERSON, deviceLabel: null, now: NOW })}`;
});

/** A visit with a photograph in the client-photos bucket, an address, and a grievance. */
async function phase2Data() {
  await env.DB.prepare(
    `INSERT INTO appointments (id, fsm_id, person_id, type, status, fsm_status, window_start, fsm_modified_at, synced_at)
     VALUES (?1, 'fsm-1', ?2, 'service', 'completed', 'Completed', '2026-09-01T06:30:00.000Z', ?3, ?3)`,
  )
    .bind(VISIT, PERSON, NOW.toISOString())
    .run();
  await env.DB.prepare(
    "INSERT INTO photo_sets (id, appointment_id, phase, created_at) VALUES ('set-1', ?1, 'after', ?2)",
  )
    .bind(VISIT, NOW.toISOString())
    .run();
  await env.DB.prepare(
    `INSERT INTO photos (id, photo_set_id, angle, r2_key, content_type, bytes, width, height, taken_at, created_at)
     VALUES ('photo-1', 'set-1', 'front', 'visits/p/front.jpg', 'image/jpeg', 3, 600, 800, ?1, ?1)`,
  )
    .bind(NOW.toISOString())
    .run();
  await env.CLIENT_PHOTOS.put("visits/p/front.jpg", new Uint8Array([1, 2, 3]));
  await env.DB.prepare(
    `INSERT INTO addresses (id, person_id, created_at, line1, locality, city, pincode)
     VALUES ('addr-1', ?1, ?2, 'House 7', 'Sector 65', 'Gurgaon', '122018')`,
  )
    .bind(PERSON, NOW.toISOString())
    .run();
  await env.DB.prepare(
    "INSERT INTO grievances (id, person_id, text, state, created_at) VALUES ('g-1', ?1, 'Please stop calling me.', 'open', ?2)",
  )
    .bind(PERSON, NOW.toISOString())
    .run();
}

describe("erasure reaches Phase 2's data", () => {
  it("deletes the visit photographs, addresses and grievance words, and keeps the visits", async () => {
    await phase2Data();
    const summary = await eraseByMobile(MOBILE, NOW);
    expect(summary).toMatchObject({ visitPhotosDeleted: 1 });
    expect(await env.CLIENT_PHOTOS.get("visits/p/front.jpg")).toBeNull();
    const left = await env.DB.prepare(
      `SELECT (SELECT COUNT(*) FROM photos) AS photos, (SELECT COUNT(*) FROM photo_sets) AS sets,
         (SELECT COUNT(*) FROM addresses) AS addresses, (SELECT text FROM grievances) AS grievance,
         (SELECT COUNT(*) FROM appointments) AS visits`,
    ).first();
    // The sets go with the photographs: an empty one is a record of pictures that no longer exist.
    expect(left).toEqual({ photos: 0, sets: 0, addresses: 0, grievance: "Erased", visits: 1 });
  });

  it("anonymises the FSM contact afterwards, through the sweeper and the fsm-sync queue, once", async () => {
    await eraseByMobile(MOBILE, NOW);
    const later = new Date(NOW.getTime() + 10 * 60_000);
    const fsmQueue = fakeQueue();
    const bindings = {
      ...env,
      CRM_QUEUE: fakeQueue(),
      RENDER_QUEUE: fakeQueue(),
      MESSAGE_QUEUE: fakeQueue(),
      FSM_QUEUE: fsmQueue,
    };
    await sweep(bindings, fakeDependencies({ now: () => later }), createLogger(), {
      creditFloor: 0,
      fsmConnected: true,
      budget: createCallBudget(Infinity),
    });
    expect(fsmQueue.sent).toEqual([{ erase_person_id: PERSON, request_id: "sweeper" }]);

    const fsm = createStubFsm();
    const message = { id: "m1", body: fsmQueue.sent[0], attempts: 1, ack: vi.fn(), retry: vi.fn() };
    const batch = { queue: "mm-fsm-sync-local", messages: [message], ackAll: vi.fn(), retryAll: vi.fn() };
    await handleFsmSyncBatch(batch as unknown as MessageBatch, env, fakeDependencies({ fsm }), createLogger());
    expect(fsm.made.erased).toEqual(["contact-1"]);
    expect(message.ack).toHaveBeenCalled();

    const again = fakeQueue();
    await sweep({ ...bindings, FSM_QUEUE: again }, fakeDependencies({ now: () => later }), createLogger(), {
      creditFloor: 0,
      budget: createCallBudget(Infinity),
      fsmConnected: true,
    });
    expect(again.sent).toEqual([]);
  });

  it("tells ops once when FSM will not anonymise the contact and the sweeper stops asking", async () => {
    await eraseByMobile(MOBILE, NOW);
    const fsm = createStubFsm();
    const deps = fakeDependencies({
      fsm: { ...fsm, eraseContact: () => Promise.reject(new Error("FSM answered 500")) },
    });
    const attempt = async (attempts: number) => {
      await env.DB.prepare("UPDATE people SET fsm_erasure_attempts = ?1 WHERE id = ?2").bind(attempts, PERSON).run();
      const message = { id: "m1", body: { erase_person_id: PERSON, request_id: "sweeper" }, attempts: 1, ack: vi.fn() };
      const batch = { queue: "mm-fsm-sync-local", messages: [message], ackAll: vi.fn(), retryAll: vi.fn() };
      await handleFsmSyncBatch(batch as unknown as MessageBatch, env, deps, createLogger());
    };

    await attempt(MAX_SYNC_ATTEMPTS - 2);
    expect(deps.alerts).toEqual([]);

    await attempt(MAX_SYNC_ATTEMPTS - 1);
    expect(deps.alerts).toEqual([
      `FSM would not anonymise contact contact-1 of erased person ${PERSON} after ${String(MAX_SYNC_ATTEMPTS)} ` +
        "attempts (FSM answered 500), and nothing will ask again. Anonymise it in FSM by hand, then record it " +
        '(runbook, "Erasure within the day"). http://ops.localhost:4323/tasks',
    ]);
  });

  it("leaves FSM alone where it is not connected", async () => {
    await eraseByMobile(MOBILE, NOW);
    const fsmQueue = fakeQueue();
    await sweep(
      { ...env, CRM_QUEUE: fakeQueue(), RENDER_QUEUE: fakeQueue(), MESSAGE_QUEUE: fakeQueue(), FSM_QUEUE: fsmQueue },
      fakeDependencies({ now: () => new Date(NOW.getTime() + 10 * 60_000) }),
      createLogger(),
      { creditFloor: 0, budget: createCallBudget(Infinity) },
    );
    expect(fsmQueue.sent).toEqual([]);
  });
});

describe("GET /api/me/export", () => {
  it("gives the client everything held about them as a file, and audits it", async () => {
    await phase2Data();
    await logPhotoView(env.DB, {
      personId: PERSON,
      actor: { kind: "staff", id: "ops@maneman.in" },
      requestId: "request-1",
      now: new Date(NOW.getTime() - 60_000),
    });
    // What they asked for on the site's form before a visit was booked (ADR 0086).
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO consultation_requests (id, person_id, pincode, requested_date, requested_window, created_at)
         VALUES ('request-a', ?1, '122018', '2026-10-02', 'morning', ?2)`,
      ).bind(PERSON, NOW.toISOString()),
      env.DB.prepare(
        `INSERT INTO first_fit_requests (id, person_id, preferred_window, created_at)
         VALUES ('request-b', ?1, 'afternoon', ?2)`,
      ).bind(PERSON, NOW.toISOString()),
      // A consent given by booking in the app, and one from before a consent recorded where (ADR 0094).
      env.DB.prepare(
        `INSERT INTO consents (id, person_id, purpose, notice_version, granted, created_at, source)
         VALUES ('consent-a', ?1, 'photos_own_record', 'photos-own-record-booking-v1', 1, ?2, 'app_booking'),
                ('consent-b', ?1, 'whatsapp_visits', 'whatsapp-visits-v1', 1, ?2, NULL)`,
      ).bind(PERSON, NOW.toISOString()),
    ]);
    const answer = await request(appFor("local", fakeDependencies(), {}, "client"), "/api/me/export", {
      headers: { Cookie: cookie },
    });
    expect(answer.headers.get("Content-Disposition")).toBe('attachment; filename="maneman-my-data.json"');
    const data = await answer.json<Record<string, unknown>>();
    expect(data).toMatchObject({
      person: { name: "Rohit Malhotra", mobile: MOBILE },
      addresses: [{ line1: "House 7", pincode: "122018" }],
      visits: [{ type: "service", status: "completed" }],
      grievances: [{ text: "Please stop calling me.", state: "open" }],
      // Who in ops opened their photographs, and when: the owner's ruling of 27 September 2026.
      photo_views: [{ by: "ops@maneman.in", at: new Date(NOW.getTime() - 60_000).toISOString() }],
      consultation_requests: [{ pincode: "122018", requested_date: "2026-10-02", requested_window: "morning" }],
      first_fit_requests: [{ preferred_window: "afternoon" }],
      consents: [
        {
          purpose: "photos_own_record",
          granted: 1,
          notice_version: "photos-own-record-booking-v1",
          source: "app_booking",
          created_at: NOW.toISOString(),
        },
        {
          purpose: "whatsapp_visits",
          granted: 1,
          notice_version: "whatsapp-visits-v1",
          source: null,
          created_at: NOW.toISOString(),
        },
      ],
    });
    const audit = await env.DB.prepare("SELECT action FROM audit_log WHERE action = 'data.export'").first();
    expect(audit).toEqual({ action: "data.export" });
  });
});

describe("grievances", () => {
  it("are raised by the client, alert ops without their words, and are answered by ops", async () => {
    const deps = fakeDependencies();
    const raised = await request(appFor("local", deps, {}, "client"), "/api/grievances", {
      method: "POST",
      headers: { Cookie: cookie, "Content-Type": "application/json", Origin: "https://maneman.test" },
      body: JSON.stringify({ text: "My photographs were shown to someone else." }),
    });
    expect(raised.status).toBe(201);
    const { id } = await raised.json<{ id: string }>();
    expect(deps.alerts).toEqual([`A client raised grievance ${id}; answer it in the ops console.`]);

    const ops = appFor("local", fakeDependencies(), {}, "ops");
    const open = await (await request(ops, "/api/grievances")).json();
    expect(open).toEqual({
      grievances: [
        {
          id,
          person_id: PERSON,
          name: "Rohit Malhotra",
          mobile: MOBILE,
          text: "My photographs were shown to someone else.",
          raised_at: NOW.toISOString(),
          // The thirty days the app promises (src/policy/tasks.ts).
          due: new Date(NOW.getTime() + 30 * 86_400_000).toISOString(),
        },
      ],
    });
    const resolve = (response: string) =>
      request(ops, `/api/grievances/${id}/resolve`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: "https://maneman.test" },
        body: JSON.stringify({ response }),
      });
    expect(await (await resolve("Called and explained; no photograph was shared.")).json()).toEqual({
      state: "resolved",
    });
    expect((await resolve("again")).status).toBe(404);
  });

  it("are one grievance when the same words arrive twice at the same moment", async () => {
    const deps = fakeDependencies();
    const client = appFor("local", deps, {}, "client");
    const raise = () =>
      request(client, "/api/grievances", {
        method: "POST",
        headers: { Cookie: cookie, "Content-Type": "application/json", Origin: "https://maneman.test" },
        body: JSON.stringify({ text: "Please explain who sees my photographs." }),
      });

    // Both taps are in flight together, as they are when a client taps Send twice on board G2.
    const both = await Promise.all([raise(), raise()]);
    expect(both.map((answer) => answer.status)).toEqual([201, 201]);
    const ids = await Promise.all(both.map(async (answer) => (await answer.json<{ id: string }>()).id));
    // One row, so one answer-time clock; and the tap that wrote nothing is answered with the
    // grievance the other raised, so both taps name the same concern (ADR 0058).
    expect(ids[0]).toBe(ids[1]);
    expect(await env.DB.prepare("SELECT COUNT(*) AS rows FROM grievances").first()).toEqual({ rows: 1 });
    expect(deps.alerts).toEqual([`A client raised grievance ${ids[0]}; answer it in the ops console.`]);

    // The same words again, once ops have answered, are a second concern and a second clock.
    const ops = appFor("local", fakeDependencies(), {}, "ops");
    await request(ops, `/api/grievances/${ids[0]}/resolve`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "https://maneman.test" },
      body: JSON.stringify({ response: "Explained on WhatsApp." }),
    });
    expect((await (await raise()).json<{ id: string }>()).id).not.toBe(ids[0]);
    expect(await env.DB.prepare("SELECT COUNT(*) AS rows FROM grievances").first()).toEqual({ rows: 2 });
  });
});

describe("ops deciding a deletion request", () => {
  /** A request from the client, as their own app makes one. */
  async function requested(): Promise<string> {
    const made = await request(appFor("local", fakeDependencies(), {}, "client"), "/api/deletion-request", {
      method: "POST",
      headers: { Cookie: cookie, Origin: "https://maneman.test" },
    });
    expect(made.status).toBe(202);
    return (await env.DB.prepare("SELECT id FROM deletion_requests").first<string>("id")) ?? "";
  }

  function decide(id: string, body: unknown, bindings: Partial<Env>) {
    return request(
      appFor("local", fakeDependencies(), {}, "ops"),
      `/api/deletion-requests/${id}/decision`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: "https://maneman.test" },
        body: JSON.stringify(body),
      },
      bindings,
    );
  }

  // Open point 136: the sweeper would find them minutes later, where POST /api/erasure
  // queues the CRM within seconds. Both doors are now as quick as each other.
  it("queues the CRM and the FSM contact itself, rather than waiting for the sweeper", async () => {
    const id = await requested();
    const crm = fakeQueue();
    const fsm = fakeQueue();
    const answer = await decide(id, { decision: "delete", reason: null }, { CRM_QUEUE: crm, FSM_QUEUE: fsm });

    expect(await answer.json()).toEqual({ state: "done" });
    expect(crm.sent).toMatchObject([{ erase_person_id: PERSON }]);
    expect(fsm.sent).toMatchObject([{ erase_person_id: PERSON }]);
  });

  it("queues neither when the request is rejected, since nobody has been erased", async () => {
    const id = await requested();
    const crm = fakeQueue();
    const fsm = fakeQueue();
    const answer = await decide(
      id,
      { decision: "reject", reason: "Not the number's owner" },
      {
        CRM_QUEUE: crm,
        FSM_QUEUE: fsm,
      },
    );

    expect(await answer.json()).toEqual({ state: "rejected" });
    expect(crm.sent).toEqual([]);
    expect(fsm.sent).toEqual([]);
  });
});

describe("the deletion window", () => {
  it("alerts ops once about requests that have waited 5 days", async () => {
    const at = (days: number) => new Date(NOW.getTime() - days * 86_400_000).toISOString();
    for (const [id, days] of [
      ["d1", 6],
      ["d2", 2],
    ] as const) {
      await env.DB.prepare(
        "INSERT INTO deletion_requests (id, person_id, created_at, state) VALUES (?1, ?2, ?3, 'requested')",
      )
        .bind(id, PERSON, at(days))
        .run();
    }
    const alerts: string[] = [];
    const alert = (message: string) => {
      alerts.push(message);
      return Promise.resolve();
    };
    expect(await alertAgedDeletions(env.DB, NOW, alert)).toBe(1);
    expect(await alertAgedDeletions(env.DB, NOW, alert)).toBe(0);
    expect(alerts).toEqual([
      "1 account deletion request(s) have waited 5 days. Each must be processed within 7 (ops console, deletion requests).",
    ]);
  });
});
