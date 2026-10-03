// What a technician's card carries beyond the job itself (boards A1, A3, B3 and
// B5): the slots a visit takes, the client's pieces, the last visit's after
// photograph, the no-show wait, and whether the day-before WhatsApp reached the
// client. NOW is Monday 21 September 2026, 12 noon in India. Everyone here is
// made up.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import type { App } from "../../src/http/context.ts";
import { openTechnicianSession } from "../../src/domain/technicians.ts";
import { appFor, fakeDependencies, markDatabase, NOW, request } from "./helpers.ts";
import { syntheticJpeg } from "./tryon-fixtures.ts";

const PERSON = "11111111-1111-4111-8111-111111111111";
const TODAY_JOB = "22222222-2222-4222-8222-222222222221";
const LATER_JOB = "22222222-2222-4222-8222-222222222222";
const LAST_VISIT = "22222222-2222-4222-8222-222222222223";
const OLDER_VISIT = "22222222-2222-4222-8222-222222222224";
/** Imran has today's job; Sameer did the last visit. */
const IMRAN = "33333333-3333-4333-8333-333333333331";
const SAMEER = "33333333-3333-4333-8333-333333333332";

let tech: App;
let cookie: string;

async function insertJob(
  id: string,
  options: { start: string; technician?: string; type?: string; status?: string },
): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO appointments (id, fsm_id, fsm_work_order_id, person_id, type, status, fsm_status, window_start,
       window_end, technician_id, service_city, service_pincode, fsm_modified_at, synced_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'Scheduled', ?7, ?8, ?9, 'Gurgaon', '122018', ?10, ?10)`,
  )
    .bind(
      id,
      `ap-${id}`,
      `wo-${id}`,
      PERSON,
      options.type ?? "service",
      options.status ?? "scheduled",
      options.start,
      new Date(Date.parse(options.start) + 90 * 60_000).toISOString(),
      options.technician ?? IMRAN,
      NOW.toISOString(),
    )
    .run();
}

/** One after photograph of a visit, in the bucket and in the rows that name it. */
async function afterPhoto(appointmentId: string, angle: string, marker: string): Promise<void> {
  const set = `set-${appointmentId}`;
  const key = `visits/${appointmentId}/after-${angle}.jpg`;
  const bytes = syntheticJpeg(30, 40, marker);
  await env.CLIENT_PHOTOS.put(key, bytes, { httpMetadata: { contentType: "image/jpeg" } });
  await env.DB.prepare(
    `INSERT INTO photo_sets (id, appointment_id, phase, created_at) VALUES (?1, ?2, 'after', ?3)
     ON CONFLICT (appointment_id, phase) DO NOTHING`,
  )
    .bind(set, appointmentId, NOW.toISOString())
    .run();
  await env.DB.prepare(
    `INSERT INTO photos (id, photo_set_id, angle, r2_key, content_type, bytes, width, height, taken_at, created_at)
     VALUES (?1, ?2, ?3, ?4, 'image/jpeg', ?5, 30, 40, ?6, ?6)`,
  )
    .bind(`photo-${appointmentId}-${angle}`, set, angle, key, bytes.byteLength, NOW.toISOString())
    .run();
}

beforeEach(async () => {
  await markDatabase();
  tech = appFor("local", fakeDependencies(), {}, "tech");

  await env.DB.prepare(
    `INSERT INTO technicians (id, fsm_id, name, initials, active, zone, mobile_e164, updated_at)
     VALUES (?1, 'resource-1', 'Imran Qureshi', 'IQ', 1, 'Gurgaon', '+919810000009', ?3),
            (?2, 'resource-2', 'Sameer Bhatt', 'SB', 1, 'Gurgaon', '+919810000008', ?3)`,
  )
    .bind(IMRAN, SAMEER, NOW.toISOString())
    .run();
  await env.DB.prepare(
    `INSERT INTO people (id, created_at, mobile_e164, name, fsm_contact_id)
     VALUES (?1, ?2, '+919810000001', 'Rohit Malhotra', 'contact-1')`,
  )
    .bind(PERSON, NOW.toISOString())
    .run();
  await env.DB.prepare(
    `INSERT INTO addresses (id, person_id, created_at, line1, line2, locality, city, pincode, access_notes, lat, lng,
       geocoded_at)
     VALUES ('addr-1', ?1, ?2, 'House 7', NULL, 'Sector 65', 'Gurgaon', '122018', NULL, 28.398, 77.07, ?2)`,
  )
    .bind(PERSON, NOW.toISOString())
    .run();

  // Today at 13:00 in India, and a replacement four days out.
  await insertJob(TODAY_JOB, { start: "2026-09-21T07:30:00.000Z" });
  await insertJob(LATER_JOB, { start: "2026-09-25T04:30:00.000Z", type: "replacement" });

  cookie = `mm_tech=${await openTechnicianSession(env.DB, {
    technicianId: IMRAN,
    deviceId: "phone-abc-123",
    label: "Chrome on Android",
    now: NOW,
  })}`;
});

const get = (path: string, as: string = cookie) => request(tech, path, { headers: { Cookie: as } });

async function card(id: string): Promise<Record<string, unknown>> {
  return (await get(`/api/tech/jobs/${id}`)).json<Record<string, unknown>>();
}

describe("the day's list", () => {
  it("says how many slots each visit takes, as board A1 writes beneath the time", async () => {
    await insertJob(LAST_VISIT, { start: "2026-09-21T09:30:00.000Z", type: "first_fit" });
    await insertJob(OLDER_VISIT, { start: "2026-09-21T11:30:00.000Z", type: "replacement" });

    const { jobs } = await (await get("/api/tech/jobs?date=2026-09-21")).json<{ jobs: { slots: number }[] }>();

    // A service one slot, a first fit two, a replacement one and a half (src/config/scheduling.ts).
    expect(jobs.map((job) => job.slots)).toEqual([1, 2, 1.5]);
  });

  // The owner's decision of 2 October 2026: a first fit is one of the hair systems ops offer, and the card names it.
  it("names the hair system a first fit was sold as, and none for any other visit or a one visit still to choose", async () => {
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO services (kind, tier, name, minutes, sort, updated_by, updated_at)
         VALUES ('first_fit', 'essential', 'Mane Man Essential', 90, 1, 'ops@localhost', ?1)`,
      ).bind(NOW.toISOString()),
      env.DB.prepare(
        `INSERT INTO price_book (item, tier, amount_ex_gst, gst_percent, valid_from)
         VALUES ('first_fit', 'essential', 3200000, 0, '2026-01-01')`,
      ),
    ]);
    await insertJob(LAST_VISIT, { start: "2026-09-21T09:30:00.000Z", type: "first_fit" });
    await insertJob(OLDER_VISIT, { start: "2026-09-21T11:30:00.000Z", type: "first_fit" });
    await env.DB.prepare("UPDATE appointments SET tier = 'essential' WHERE id IN (?1, ?2)")
      .bind(LAST_VISIT, OLDER_VISIT)
      .run();
    await env.DB.prepare("UPDATE appointments SET one_visit = 'booked' WHERE id = ?1").bind(OLDER_VISIT).run();

    const { jobs } = await (await get("/api/tech/jobs?date=2026-09-21")).json<{ jobs: { product: string | null }[] }>();

    expect(jobs.map((job) => job.product)).toEqual([null, "Mane Man Essential", null]);
    expect(await card(LAST_VISIT)).toMatchObject({ product: "Mane Man Essential" });
  });
});

describe("the card", () => {
  it("carries the no-show wait its type runs, so the phone can count it with no signal", async () => {
    expect(await card(TODAY_JOB)).toMatchObject({ no_show_wait_min: 15 });
  });

  it("carries the client's pieces, newest fit first, for the piece card and the piece step's list", async () => {
    await env.DB.prepare(
      `INSERT INTO pieces (id, fsm_id, person_id, piece_code, base, supplier_lot, fitted_at, replacement_due_at,
         failed_at, failure_reason, synced_at)
       VALUES ('piece-old', 'asset-1', ?1, 'MM-STD-1001-A', 'Mono', 'LOT-1', '2026-01-10T00:00:00.000Z',
               '2026-07-09', '2026-07-01T05:00:00.000Z', 'Lifted at the front', ?2),
              ('piece-now', 'asset-2', ?1, 'MM-STD-4417-B', 'Mono', 'LOT-4417', '2026-07-02T00:00:00.000Z',
               '2026-12-29', NULL, NULL, ?2)`,
    )
      .bind(PERSON, NOW.toISOString())
      .run();

    const pieces = (await card(TODAY_JOB)).pieces;

    expect(pieces).toEqual([
      {
        piece_code: "MM-STD-4417-B",
        base: "Mono",
        supplier_lot: "LOT-4417",
        fitted_at: "2026-07-02",
        replacement_due_at: "2026-12-29",
        failed_at: null,
        failure_reason: null,
      },
      {
        piece_code: "MM-STD-1001-A",
        base: "Mono",
        supplier_lot: "LOT-1",
        fitted_at: "2026-01-10",
        replacement_due_at: "2026-07-09",
        failed_at: "2026-07-01T05:00:00.000Z",
        failure_reason: "Lifted at the front",
      },
    ]);
    // A job further out has no client yet, and so no pieces.
    expect((await card(LATER_JOB)).pieces).toBeNull();
  });

  it("names the last visit, and serves its after photograph to this job's technician alone", async () => {
    await insertJob(OLDER_VISIT, { start: "2026-06-01T05:00:00.000Z", technician: IMRAN, status: "completed" });
    await afterPhoto(OLDER_VISIT, "front", "older");
    await insertJob(LAST_VISIT, { start: "2026-08-22T05:00:00.000Z", technician: SAMEER, status: "completed" });
    await afterPhoto(LAST_VISIT, "top", "last-top");
    await afterPhoto(LAST_VISIT, "front", "last-front");

    expect((await card(TODAY_JOB)).last_visit).toEqual({
      date: "2026-08-22",
      technician: "Sameer",
      photo_url: `/api/tech/jobs/${TODAY_JOB}/last-visit-photo`,
    });

    const photo = await get(`/api/tech/jobs/${TODAY_JOB}/last-visit-photo`);
    expect(photo.status).toBe(200);
    expect(photo.headers.get("Content-Type")).toBe("image/jpeg");
    // A client's photograph is never kept on a technician's phone, by the browser or the service worker.
    expect(photo.headers.get("Cache-Control")).toBe("private, no-store");
    // The front, as board A3 draws it.
    expect(new TextDecoder().decode(await photo.arrayBuffer())).toContain("last-front");

    // Not before the card unlocks, and not to another technician.
    expect((await get(`/api/tech/jobs/${LATER_JOB}/last-visit-photo`)).status).toBe(404);
    const sameer = `mm_tech=${await openTechnicianSession(env.DB, {
      technicianId: SAMEER,
      deviceId: "phone-def-456",
      label: "Chrome on Android",
      now: NOW,
    })}`;
    expect((await get(`/api/tech/jobs/${TODAY_JOB}/last-visit-photo`, sameer)).status).toBe(404);
  });

  it("has no last visit for a client seen for the first time", async () => {
    expect((await card(TODAY_JOB)).last_visit).toBeNull();
    expect((await get(`/api/tech/jobs/${TODAY_JOB}/last-visit-photo`)).status).toBe(404);
  });

  it("says whether the day-before WhatsApp reached the client, as board B5's wait shows", async () => {
    expect((await card(TODAY_JOB)).reminder).toBeNull();

    await env.DB.prepare(
      `INSERT INTO outbound_messages (id, created_at, person_id, kind, subject_kind, subject_id, state, sent_at,
         delivered_at)
       VALUES ('m1', '2026-09-20T12:30:00Z', ?1, 'visit_reminder', 'appointment', ?2, 'sent', '2026-09-20T12:30:05Z',
               '2026-09-20T12:31:00Z')`,
    )
      .bind(PERSON, TODAY_JOB)
      .run();

    expect((await card(TODAY_JOB)).reminder).toEqual({ delivered_at: "2026-09-20T12:31:00Z" });
    expect((await card(LATER_JOB)).reminder).toBeNull();
  });

  // FLD-35, UX-26: a reminder skipped for a test record read "messaged on WhatsApp, not delivered", with a tick.
  describe("counts only a WhatsApp that went to the client", () => {
    async function message(id: string, kind: string, state: string, createdAt: string): Promise<void> {
      await env.DB.prepare(
        `INSERT INTO outbound_messages (id, created_at, person_id, kind, subject_kind, subject_id, state, last_error)
         VALUES (?1, ?2, ?3, ?4, 'appointment', ?5, ?6, ?7)`,
      )
        .bind(id, createdAt, PERSON, kind, TODAY_JOB, state, state === "skipped" ? "test record" : null)
        .run();
    }

    it.each(["queued", "skipped", "failed"])("has none where the reminder was %s", async (state) => {
      await message("m1", "visit_reminder", state, "2026-09-20T12:30:00Z");
      expect((await card(TODAY_JOB)).reminder).toBeNull();
    });

    it("has one sent and never delivered", async () => {
      await message("m1", "visit_reminder", "sent", "2026-09-20T12:30:00Z");
      expect((await card(TODAY_JOB)).reminder).toEqual({ delivered_at: null });
    });

    it("keeps the reminder that went when a later arrival notice did not", async () => {
      await message("m1", "visit_reminder", "sent", "2026-09-20T12:30:00Z");
      await message("m2", "arrival_notice", "skipped", "2026-09-21T06:00:00Z");
      expect((await card(TODAY_JOB)).reminder).toEqual({ delivered_at: null });
    });
  });
});
