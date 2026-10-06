// A client's rights over their data (docs/decisions/0049-dpdp.md): erasure reaching the apps' data and Books, the
// data export, grievances, and the deletion window's alert. NOW is Monday 21 September 2026, 12 noon in India.
// Every name and number here is made up.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { eraseBooksCustomers } from "../../../src/domain/books/books-erasure.ts";
import { alertAgedDeletions } from "../../../src/domain/privacy/deletion.ts";
import { logPhotoView } from "../../../src/domain/field/photo-views.ts";
import { openSession } from "../../../src/domain/sign-in/sessions.ts";
import { createCallBudget } from "../../../src/lib/call-budget.ts";
import { createLogger } from "../../../src/log.ts";
import { createStubBooks } from "../../../src/providers/books/stub.ts";
import {
  appFor,
  captureLogs,
  eraseByMobile,
  fakeDependencies,
  fakeQueue,
  markDatabase,
  NOW,
  request,
} from "../helpers.ts";
import { PERSON, MOBILE } from "./dpdp-fixtures.ts";

const VISIT = "22222222-2222-4222-8222-222222222222";

let cookie: string;

beforeEach(async () => {
  await markDatabase();
  captureLogs();
  await env.DB.prepare("INSERT INTO people (id, created_at, mobile_e164, name) VALUES (?1, ?2, ?3, 'Rohit Malhotra')")
    .bind(PERSON, NOW.toISOString(), MOBILE)
    .run();
  cookie = `mm_app=${await openSession(env.DB, { kind: "client", subjectId: PERSON, deviceLabel: null, now: NOW })}`;
});

/** A visit with a photograph in the client-photos bucket, an address, and a grievance. */
async function appData() {
  await env.DB.prepare(
    `INSERT INTO appointments (id, fsm_id, person_id, type, status, window_start, synced_at)
     VALUES (?1, ?1, ?2, 'service', 'completed', '2026-09-01T06:30:00.000Z', ?3)`,
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

/** A row in each table the export once missed, beside appData's. */
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

describe("erasure reaches the apps' data", () => {
  it("deletes the visit photographs, addresses and grievance words, and keeps the visits", async () => {
    await appData();
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
    await appData();
    await everythingElseHeld();

    await eraseByMobile(MOBILE, NOW);

    const lead = await env.DB.prepare("SELECT source, loss_extent, gclid, landing_path FROM leads WHERE person_id = ?1")
      .bind(PERSON)
      .first();
    expect(lead).toEqual({ source: "form", loss_extent: null, gclid: null, landing_path: null });
  });

  // The Books customer kept the client's name, mobile and addresses.
  it("erases the client's Books customer through the Books pass", async () => {
    await env.DB.prepare("UPDATE people SET books_customer_id = 'books-1' WHERE id = ?1").bind(PERSON).run();
    await eraseByMobile(MOBILE, NOW);
    const books = createStubBooks();
    const erased = await eraseBooksCustomers(
      env.DB,
      { ...fakeDependencies({ books }), log: createLogger(), budget: createCallBudget(40) },
      NOW,
    );

    expect(erased).toBe(1);
    expect(books.made.erased).toEqual([{ customerId: "books-1", outcome: "deleted" }]);
  });
});

describe("GET /api/me/export", () => {
  it("gives the client everything held about them as a file, and audits it", async () => {
    await appData();
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
      // Who in ops opened their photographs, and when.
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

  // What the export left out.
  it("gives the door, the client's note, how they reached us, their hair system, invite, sign-ins and requests", async () => {
    await appData();
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
    await appData();
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
  it("queues the CRM itself, rather than waiting for the sweeper", async () => {
    const id = await requested();
    const crm = fakeQueue();
    const answer = await decide(id, { decision: "delete", reason: null }, { CRM_QUEUE: crm });

    expect(await answer.json()).toEqual({ state: "done" });
    expect(crm.sent).toMatchObject([{ erase_person_id: PERSON }]);
  });

  it("queues nothing when the request is rejected, since nobody has been erased", async () => {
    const id = await requested();
    const crm = fakeQueue();
    const answer = await decide(id, { decision: "reject", reason: "Not the number's owner" }, { CRM_QUEUE: crm });

    expect(await answer.json()).toEqual({ state: "rejected" });
    expect(crm.sent).toEqual([]);
  });
});

describe("the deletion window", () => {
  const AGED = "33333333-3333-4333-8333-333333333331";
  const RECENT = "33333333-3333-4333-8333-333333333332";

  beforeEach(async () => {
    const at = (days: number) => new Date(NOW.getTime() - days * 86_400_000).toISOString();
    for (const [id, days] of [
      [AGED, 26],
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

  it("tells ops once of a request that has waited 25 days, keeps the alert, and names the day it is due", async () => {
    const deps = fakeDependencies();
    expect(await alertAgedDeletions(env.DB, NOW, deps.alertOnce)).toBe(1);
    expect(await alertAgedDeletions(env.DB, NOW, deps.alertOnce)).toBe(0);

    expect(deps.alerts).toEqual([
      `Deletion request ${AGED} has waited 25 days. Decide it by 2026-09-25, within 30 days of the request. ` +
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
