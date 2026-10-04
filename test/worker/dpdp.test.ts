// A client's rights over their data (docs/decisions/0049-dpdp.md): erasure reaching Phase 2's data, FSM and Books, the
// data export, grievances, and the deletion window's alert. NOW is Monday 21 September 2026, 12 noon in India.
// Every name and number here is made up.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { eraseBooksCustomers } from "../../src/domain/books-erasure.ts";
import { alertAgedDeletions } from "../../src/domain/deletion.ts";
import { tellOfNewGrievances } from "../../src/domain/grievances.ts";
import { logPhotoView } from "../../src/domain/photo-views.ts";
import { openSession } from "../../src/domain/sessions.ts";
import { createCallBudget } from "../../src/lib/call-budget.ts";
import { createLogger } from "../../src/log.ts";
import { createStubBooks } from "../../src/providers/books.ts";
import { createStubFsm, EMPTY_FSM } from "../../src/providers/fsm.ts";
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

  it("blanks how the client reached us and how much hair they had lost, and keeps the lead", async () => {
    await phase2Data();
    await everythingElseHeld();

    await eraseByMobile(MOBILE, NOW);

    const lead = await env.DB.prepare("SELECT source, loss_extent, gclid, landing_path FROM leads WHERE person_id = ?1")
      .bind(PERSON)
      .first();
    expect(lead).toEqual({ source: "form", loss_extent: null, gclid: null, landing_path: null });
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

  // The Books customer FSM's own integration made for the client kept their name, mobile and addresses (PS-02).
  it("keeps the Books customer FSM made for the contact, and the Books pass then erases it", async () => {
    await eraseByMobile(MOBILE, NOW);
    const fsm = createStubFsm({
      ...EMPTY_FSM,
      contacts: [
        { id: "contact-1", name: "Rohit Malhotra", mobile: "+919810000001", email: null, booksCustomerId: "books-1" },
      ],
    });
    const message = { id: "m1", body: { erase_person_id: PERSON, request_id: "sweeper" }, attempts: 1, ack: vi.fn() };
    const batch = { queue: "mm-fsm-sync-local", messages: [message], ackAll: vi.fn(), retryAll: vi.fn() };

    await handleFsmSyncBatch(batch as unknown as MessageBatch, env, fakeDependencies({ fsm }), createLogger());
    const books = createStubBooks();
    const erased = await eraseBooksCustomers(
      env.DB,
      { ...fakeDependencies({ books }), log: createLogger(), budget: createCallBudget(40) },
      NOW,
    );

    expect(fsm.made.erased).toEqual(["contact-1"]);
    expect(erased).toBe(1);
    expect(books.made.erased).toEqual([{ customerId: "books-1", outcome: "deleted" }]);
  });

  it("leaves FSM alone where it is not connected", async () => {
    await eraseByMobile(MOBILE, NOW);
    const fsmQueue = fakeQueue();
    await sweep(
      { ...env, CRM_QUEUE: fakeQueue(), RENDER_QUEUE: fakeQueue(), MESSAGE_QUEUE: fakeQueue(), FSM_QUEUE: fsmQueue },
      fakeDependencies({ now: () => new Date(NOW.getTime() + 10 * 60_000) }),
      createLogger(),
      { budget: createCallBudget(Infinity) },
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
      // A discount code ops entered on one of their visits (ADR 0108); the member of staff is not theirs to see.
      env.DB.prepare(
        `INSERT INTO discount_codes (id, code, kind, value, covers_first_fit, covers_service, covers_replacement,
           once_per_client, created_by, created_at)
         VALUES ('code-a', 'TENPC', 'percent', 10, 0, 1, 0, 1, 'ops@maneman.in', ?1)`,
      ).bind(NOW.toISOString()),
      env.DB.prepare(
        `INSERT INTO discount_code_uses (id, code_id, person_id, appointment_id, amount_off, given_by, given_by_id,
           created_at)
         VALUES ('use-a', 'code-a', ?1, (SELECT id FROM appointments WHERE person_id = ?1 LIMIT 1), 20000, 'ops',
           'ops@maneman.in', ?2)`,
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
      discount_codes: [
        { code: "TENPC", amount_off: 20_000, given_by: "ops", created_at: NOW.toISOString(), removed_at: null },
      ],
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

  // PS-21 of the audit, 2 October 2026: what the export left out.
  it("gives the door, the client's note, how they reached us, their hair system, invite, sign-ins and requests", async () => {
    await phase2Data();
    await everythingElseHeld();
    const answer = await request(appFor("local", fakeDependencies(), {}, "client"), "/api/me/export", {
      headers: { Cookie: cookie },
    });
    const data = await answer.json<Record<string, unknown>>();
    expect(data).toMatchObject({
      addresses: [{ flat: "7B", floor: "3", tower: "C", landmark: "Opposite the park", given_on_the_phone: 1 }],
      visits: [{ client_note: "Ring twice", technician: null }],
      leads: [{ source: "form", loss_extent: "crown", gclid: "click-1", landing_path: "/book" }],
      hair_systems: [{ piece_code: "MM-CLASSIC-01", base: "lace", fitted_at: "2026-09-01" }],
      referred_by: [{ code: "ARJUN1", via: "consultation", friend_first_name: "Rohit", grant_state: "pending" }],
      number_changes: [{ new_mobile_e164: "+919810000009", state: "verifying" }],
      deletion_requests: [{ state: "rejected", reason: "A visit is still booked" }],
      try_ons: [{ stage: "crown", preset: "classic_short", state: "expired" }],
      sessions: [{ created_at: NOW.toISOString(), revoked_at: null }],
    });
    // Which member of staff took the address down stays ours.
    expect(JSON.stringify(data.addresses)).not.toContain("ops@maneman.in");
  });

  it("gives the same as a page to read, labelled and in India's time, and audits it", async () => {
    await phase2Data();
    const answer = await request(appFor("local", fakeDependencies(), {}, "client"), "/api/me/export.html", {
      headers: { Cookie: cookie },
    });
    expect(answer.status).toBe(200);
    expect(answer.headers.get("Content-Type")).toBe("text/html; charset=utf-8");
    expect(answer.headers.get("Content-Disposition")).toBe('attachment; filename="maneman-my-data.html"');
    expect(answer.headers.get("Content-Security-Policy")).toBe("default-src 'none'; style-src 'unsafe-inline'");
    const page = await answer.text();
    expect(page).toContain("<dt>Name</dt><dd>Rohit Malhotra</dd>");
    expect(page).toContain("<dt>With us since</dt><dd>21 Sep 2026, 12 pm</dd>");
    expect(page).toContain("<dt>Your words</dt><dd>Please stop calling me.</dd>");
    const audit = await env.DB.prepare(
      "SELECT COUNT(*) AS exports FROM audit_log WHERE action = 'data.export'",
    ).first();
    expect(audit).toEqual({ exports: 1 });
  });

  it("gives no page without a session", async () => {
    const answer = await request(appFor("local", fakeDependencies(), {}, "client"), "/api/me/export.html");
    expect(answer.status).toBe(401);
  });
});

/** A row in each table PS-21 found missing from the export, beside phase2Data's. */
async function everythingElseHeld(): Promise<void> {
  const at = NOW.toISOString();
  await env.DB.batch([
    env.DB.prepare(
      `UPDATE addresses SET flat = '7B', floor = '3', tower = 'C', landmark = 'Opposite the park',
         given_to_staff = 'ops@maneman.in'`,
    ),
    env.DB.prepare("UPDATE appointments SET client_note = 'Ring twice', client_note_at = ?1").bind(at),
    env.DB.prepare(
      `INSERT INTO leads (id, person_id, created_at, source, request_id, loss_extent, gclid, landing_path)
       VALUES ('lead-1', ?1, ?2, 'form', 'request-1', 'crown', 'click-1', '/book')`,
    ).bind(PERSON, at),
    env.DB.prepare(
      `INSERT INTO pieces (id, fsm_id, person_id, piece_code, base, fitted_at, synced_at)
       VALUES ('piece-1', 'piece-1', ?1, 'MM-CLASSIC-01', 'lace', '2026-09-01', ?2)`,
    ).bind(PERSON, at),
    env.DB.prepare(
      "INSERT INTO people (id, created_at, mobile_e164, name) VALUES ('referrer-1', ?1, '+919810000002', 'Arjun')",
    ).bind(at),
    env.DB.prepare(
      "INSERT INTO referral_codes (code, person_id, created_at, updated_at) VALUES ('ARJUN1', 'referrer-1', ?1, ?1)",
    ).bind(at),
    env.DB.prepare(
      `INSERT INTO referral_attributions (id, code, referred_person_id, first_touch_at, via, friend_first_name,
         created_at, updated_at)
       VALUES ('attribution-1', 'ARJUN1', ?1, ?2, 'consultation', 'Rohit', ?2, ?2)`,
    ).bind(PERSON, at),
    env.DB.prepare(
      `INSERT INTO number_change_requests (id, person_id, created_at, new_mobile_e164, state)
       VALUES ('change-1', ?1, ?2, '+919810000009', 'verifying')`,
    ).bind(PERSON, at),
    env.DB.prepare(
      `INSERT INTO deletion_requests (id, person_id, created_at, state, decided_at, reason)
       VALUES ('deletion-1', ?1, ?2, 'rejected', ?2, 'A visit is still booked')`,
    ).bind(PERSON, at),
    env.DB.prepare(
      `INSERT INTO tryon_jobs (id, person_id, created_at, upload_key, state, stage, preset, photo_consent_version,
         photo_consent_at, ip_hash, request_id)
       VALUES ('job-1', ?1, ?2, 'uploads/job-1', 'expired', 'crown', 'classic_short', 'photo-v3', ?2, 'an-ip-hash',
         'request-2')`,
    ).bind(PERSON, at),
  ]);
}

describe("grievances", () => {
  /** The signed-in client's concern, as their app's Send raises it. */
  function raiseAs(client: ReturnType<typeof appFor>, text: string) {
    return request(client, "/api/grievances", {
      method: "POST",
      headers: { Cookie: cookie, "Content-Type": "application/json", Origin: "https://maneman.test" },
      body: JSON.stringify({ text }),
    });
  }

  /** The concerns the signed-in client's profile lists. */
  async function shownTo(client: ReturnType<typeof appFor>): Promise<unknown> {
    const profile = await request(client, "/api/profile", { headers: { Cookie: cookie } });
    return (await profile.json<{ grievances: unknown }>()).grievances;
  }

  it("are raised by the client, alert nobody at once, and are answered by ops", async () => {
    const deps = fakeDependencies();
    const raised = await raiseAs(appFor("local", deps, {}, "client"), "My photographs were shown to someone else.");
    expect(raised.status).toBe(201);
    const { id } = await raised.json<{ id: string }>();
    // The team chat hears of it in the hour's one message, not one message a concern.
    expect(deps.alerts).toEqual([]);

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

  // PS-22: once the app reloaded, a client saw nothing of the concern they raised, nor ops' answer.
  it("are listed on the client's profile, open and then with ops' answer", async () => {
    const deps = fakeDependencies();
    const client = appFor("local", deps, {}, "client");
    const { id } = await (await raiseAs(client, "Who sees my photographs?")).json<{ id: string }>();
    expect(await shownTo(client)).toEqual([
      {
        id,
        text: "Who sees my photographs?",
        state: "open",
        raised_at: NOW.toISOString(),
        response: null,
        answered_at: null,
      },
    ]);

    await request(appFor("local", deps, {}, "ops"), `/api/grievances/${id}/resolve`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "https://maneman.test" },
      body: JSON.stringify({ response: "Only your technician and our care team." }),
    });
    expect(await shownTo(client)).toEqual([
      {
        id,
        text: "Who sees my photographs?",
        state: "resolved",
        raised_at: NOW.toISOString(),
        response: "Only your technician and our care team.",
        answered_at: NOW.toISOString(),
      },
    ]);
  });

  it("list the newest five: every open one, and those answered in the last 30 days", async () => {
    const daysAgo = (days: number) => new Date(NOW.getTime() - days * 86_400_000).toISOString();
    const raised = (id: string, createdDaysAgo: number, resolvedDaysAgo: number | null = null) =>
      env.DB.prepare(
        "INSERT INTO grievances (id, person_id, text, state, resolved_at, created_at) VALUES (?1, ?2, ?1, ?3, ?4, ?5)",
      ).bind(
        id,
        PERSON,
        resolvedDaysAgo === null ? "open" : "resolved",
        resolvedDaysAgo === null ? null : daysAgo(resolvedDaysAgo),
        daysAgo(createdDaysAgo),
      );
    const texts = async () => {
      const shown = (await shownTo(appFor("local", fakeDependencies(), {}, "client"))) as { text: string }[];
      return shown.map((grievance) => grievance.text);
    };

    await env.DB.batch([
      raised("open-long-ago", 90),
      raised("answered-long-ago", 45, 40),
      raised("answered-lately", 12, 10),
      raised("open-1", 1),
      raised("open-2", 2),
    ]);
    expect(await texts()).toEqual(["open-1", "open-2", "answered-lately", "open-long-ago"]);

    await env.DB.batch([raised("open-3", 3), raised("open-4", 4), raised("open-5", 5)]);
    expect(await texts()).toEqual(["open-1", "open-2", "open-3", "open-4", "open-5"]);
  });

  // PS-65: one client could raise concerns without end, each a message in the team chat.
  it("take five new ones a day from a client, where the same words still open are not a new one", async () => {
    const client = appFor("local", fakeDependencies(), {}, "client");
    for (const n of [1, 2, 3, 4, 5]) {
      expect((await raiseAs(client, `Concern ${String(n)}`)).status).toBe(201);
    }
    const sixth = await raiseAs(client, "Concern 6");
    expect(sixth.status).toBe(429);
    expect((await sixth.json<{ error: { code: string } }>()).error.code).toBe("rate_limited");
    // Sent again, an open concern is the one already raised, and costs nothing.
    expect((await raiseAs(client, "Concern 1")).status).toBe(201);
    expect(await env.DB.prepare("SELECT COUNT(*) AS rows FROM grievances").first()).toEqual({ rows: 5 });

    // India's next day is a new allowance.
    const tomorrow = fakeDependencies({ now: () => new Date(NOW.getTime() + 86_400_000) });
    expect((await raiseAs(appFor("local", tomorrow, {}, "client"), "Concern 6")).status).toBe(201);
  });

  it("are told to the team chat in one message an hour, without the client's words", async () => {
    // NOW is 06:30 UTC, so its run tells of the hour from 05:00 to 06:00.
    const at = (time: string) => `2026-09-21T${time}:00.000Z`;
    const rows = [
      { id: "in-the-hour", state: "open", createdAt: at("05:00") },
      { id: "also-in-the-hour", state: "open", createdAt: at("05:59") },
      { id: "answered-already", state: "resolved", createdAt: at("05:30") },
      { id: "told-an-hour-ago", state: "open", createdAt: at("04:59") },
      { id: "told-in-an-hour", state: "open", createdAt: at("06:10") },
    ];
    await env.DB.batch(
      rows.map((row) =>
        env.DB.prepare(
          "INSERT INTO grievances (id, person_id, text, state, created_at) VALUES (?1, ?2, 'Private words', ?3, ?4)",
        ).bind(row.id, PERSON, row.state, row.createdAt),
      ),
    );
    const told: string[] = [];
    const tell = (message: string) => {
      told.push(message);
      return Promise.resolve();
    };
    const queue = "https://ops.test/grievances";

    expect(await tellOfNewGrievances(env.DB, tell, queue, NOW)).toBe(2);
    expect(told).toEqual([`2 grievances were raised in the last hour. Answer them in Grievances: ${queue}`]);

    // An hour on, the one raised since; and an hour after that, with nothing new, nobody is told.
    expect(await tellOfNewGrievances(env.DB, tell, queue, new Date(NOW.getTime() + 3_600_000))).toBe(1);
    expect(await tellOfNewGrievances(env.DB, tell, queue, new Date(NOW.getTime() + 7_200_000))).toBe(0);
    expect(told).toEqual([
      `2 grievances were raised in the last hour. Answer them in Grievances: ${queue}`,
      `A client raised a grievance in the last hour. Answer it in Grievances: ${queue}`,
    ]);
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

  // The sweeper would find them only minutes later.
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
  const AGED = "33333333-3333-4333-8333-333333333331";
  const RECENT = "33333333-3333-4333-8333-333333333332";

  beforeEach(async () => {
    const at = (days: number) => new Date(NOW.getTime() - days * 86_400_000).toISOString();
    for (const [id, days] of [
      [AGED, 6],
      [RECENT, 2],
    ] as const) {
      await env.DB.prepare(
        "INSERT INTO deletion_requests (id, person_id, created_at, state) VALUES (?1, ?2, ?3, 'requested')",
      )
        .bind(id, PERSON, at(days))
        .run();
    }
  });

  const openAlerts = () =>
    env.DB.prepare("SELECT key, link, told_at FROM alerts WHERE resolved_at IS NULL")
      .all()
      .then((answer) => answer.results);

  it("tells ops once of a request that has waited 5 days, keeps the alert, and names the day it is due", async () => {
    const deps = fakeDependencies();
    expect(await alertAgedDeletions(env.DB, NOW, deps.alertOnce)).toBe(1);
    expect(await alertAgedDeletions(env.DB, NOW, deps.alertOnce)).toBe(0);

    expect(deps.alerts).toEqual([
      `Deletion request ${AGED} has waited 5 days. Decide it by 2026-09-22, within 7 days of the request. ` +
        "http://ops.localhost:4323/deletion-requests",
    ]);
    expect(await openAlerts()).toEqual([
      { key: `deletion_waiting:${AGED}`, link: "/deletion-requests", told_at: NOW.toISOString() },
    ]);
  });

  it("marks a request alerted only once its alert is kept or told, so a failed one is tried on the next run", async () => {
    const failing = () => Promise.reject(new Error("D1 is down"));
    await expect(alertAgedDeletions(env.DB, NOW, failing)).rejects.toThrow("D1 is down");
    expect(
      await env.DB.prepare("SELECT alerted_at FROM deletion_requests WHERE id = ?1").bind(AGED).first("alerted_at"),
    ).toBeNull();

    expect(await alertAgedDeletions(env.DB, NOW, fakeDependencies().alertOnce)).toBe(1);
  });

  it("closes the alert when ops decide the request", async () => {
    await alertAgedDeletions(env.DB, NOW, fakeDependencies().alertOnce);
    const decided = await request(
      appFor("local", fakeDependencies(), {}, "ops"),
      `/api/deletion-requests/${AGED}/decision`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: "https://maneman.test" },
        body: JSON.stringify({ decision: "reject", reason: "Not the number's owner" }),
      },
    );

    expect(decided.status).toBe(200);
    expect(await openAlerts()).toEqual([]);
  });
});
