// The client app's visits and photographs, read from D1. Every name and number here is made up.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import type { App } from "../../../src/http/context.ts";
import { openSession } from "../../../src/domain/sign-in/sessions.ts";
import { appFor, fakeDependencies, markDatabase, NOW, request } from "../helpers.ts";
import { syntheticJpeg } from "../tryon-fixtures.ts";
import { NAMES, type Visit, booked, done, PHOTOS, utc, cookie, useCookie, signIn } from "./client-visits-fixtures.ts";

/** Our IDs for the visits written so far in this test, by name. */
let ids: Record<string, string>;

/** Writes each visit not written yet, with its client, technician and photographs, and returns our IDs by name. */
async function seed(visits: Visit[]): Promise<Record<string, string>> {
  const at = NOW.toISOString();
  await env.DB.prepare(
    `INSERT OR IGNORE INTO technicians (id, fsm_id, name, initials, active, updated_at)
     VALUES ('t-imran', 't-imran', 'Imran Khan', 'IK', 1, ?1)`,
  )
    .bind(at)
    .run();
  for (const visit of visits) {
    if (ids[visit.name] !== undefined) continue;
    const id = crypto.randomUUID();
    ids[visit.name] = id;
    const closed = visit.status === "completed" || visit.status === "terminated";
    const minutes =
      visit.startedAt !== null && visit.endedAt !== null
        ? (Date.parse(visit.endedAt) - Date.parse(visit.startedAt)) / 60_000
        : null;
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO people (id, created_at, mobile_e164, name) SELECT ?1, ?2, ?3, ?4
         WHERE NOT EXISTS (SELECT 1 FROM people WHERE mobile_e164 = ?3)`,
      ).bind(crypto.randomUUID(), at, visit.mobile, NAMES[visit.mobile] ?? null),
      env.DB.prepare(
        `INSERT INTO appointments (id, fsm_id, person_id, type, tier, window_start, window_end, technician_id, status,
           service_city, service_pincode, synced_at, first_seen_at)
         SELECT ?1, ?1, id, ?2, ?3, ?4, ?5, 't-imran', ?6, 'Gurgaon', '122018', ?7, ?7 FROM people
         WHERE mobile_e164 = ?8`,
      ).bind(
        id,
        visit.type,
        visit.type === "consultation" ? null : "standard",
        utc(visit.start),
        utc(visit.end),
        visit.status,
        at,
        visit.mobile,
      ),
      ...(closed
        ? [
            env.DB.prepare(
              `INSERT INTO visits (id, appointment_id, started_at, ended_at, duration_minutes, outcome, updated_at)
               VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`,
            ).bind(
              crypto.randomUUID(),
              id,
              utc(visit.startedAt),
              utc(visit.endedAt),
              minutes,
              visit.status === "completed" ? "done" : "partial",
              at,
            ),
          ]
        : []),
    ]);
    for (const [phase, angle, width, height] of PHOTOS[visit.name] ?? []) {
      const key = `visits/${id}/${phase}-${angle}.jpg`;
      const bytes = syntheticJpeg(width, height);
      await env.CLIENT_PHOTOS.put(key, bytes);
      const set = crypto.randomUUID();
      await env.DB.batch([
        env.DB.prepare("INSERT INTO photo_sets (id, appointment_id, phase, created_at) VALUES (?1, ?2, ?3, ?4)").bind(
          set,
          id,
          phase,
          at,
        ),
        env.DB.prepare(
          `INSERT INTO photos (id, photo_set_id, angle, r2_key, content_type, bytes, width, height, taken_at, created_at)
           VALUES (?1, ?2, ?3, ?4, 'image/jpeg', ?5, ?6, ?7, ?8, ?9)`,
        ).bind(crypto.randomUUID(), set, angle, key, bytes.byteLength, width, height, utc(visit.startedAt) ?? at, at),
      ]);
    }
  }
  return ids;
}

let client: App;

const get = (path: string, withCookie = true) =>
  request(client, path, { headers: withCookie ? { Cookie: cookie } : {} });

beforeEach(async () => {
  client = appFor("local", fakeDependencies(), {}, "client");
  ids = {};
  await markDatabase();
});

describe("GET /api/visits/:id and the photographs", () => {
  it("gives a done visit's duration, outcome and photographs, whose links open only for the client", async () => {
    const ids = await seed([done("ap-done", "2026-09-10")]);
    await signIn();
    const visit = await (
      await get(`/api/visits/${ids["ap-done"] ?? ""}`)
    ).json<{
      duration_minutes: number;
      outcome: string;
      photos: { before: { angle: string; url: string }[]; after: { angle: string; url: string }[] };
    }>();
    expect(visit).toMatchObject({ duration_minutes: 70, outcome: "done", what_was_done: null });
    expect(visit.photos.before.map((photo) => photo.angle)).toEqual(["front"]);

    const url = visit.photos.after[0]?.url ?? "";
    const image = await get(url);
    expect(image.status).toBe(200);
    expect(image.headers.get("Content-Type")).toBe("image/jpeg");
    expect(new Uint8Array(await image.arrayBuffer()).slice(0, 3)).toEqual(new Uint8Array([0xff, 0xd8, 0xff]));
    expect((await get(url, false)).status).toBe(401);
  });

  it("does not show another client's visit or photograph", async () => {
    const ids = await seed([done("ap-done", "2026-09-10")]);
    await signIn();
    await env.DB.prepare("UPDATE photos SET thumbnail_key = r2_key").run();
    const [photo] = (
      await (
        await get(`/api/visits/${ids["ap-done"] ?? ""}`)
      ).json<{
        photos: { after: { url: string; thumbnail_url: string }[] };
      }>()
    ).photos.after;
    const url = photo?.url ?? "";

    const other = crypto.randomUUID();
    await env.DB.prepare(
      "INSERT INTO people (id, created_at, mobile_e164, name) VALUES (?1, ?2, '+919810000005', 'Other')",
    )
      .bind(other, NOW.toISOString())
      .run();
    useCookie(`mm_app=${await openSession(env.DB, { kind: "client", subjectId: other, deviceLabel: null, now: NOW })}`);
    expect((await get(`/api/visits/${ids["ap-done"] ?? ""}`)).status).toBe(404);
    expect((await get(url)).status).toBe(404);
    expect((await get(photo?.thumbnail_url ?? "")).status).toBe(404);
  });

  /*
   * The app tells three states apart from these two fields (ADR 0056): the invoice is
   * here, it is still to come, or the visit is free and none will ever exist. The app
   * must never have to guess the third from a price it happens to be showing.
   */
  it("says the invoice is still to come for a billed visit, and never coming for a free one", async () => {
    const ids = await seed([done("ap-done", "2026-09-10"), done("ap-consult", "2026-09-08", { type: "consultation" })]);
    await signIn();
    const detail = async (name: string) =>
      (await get(`/api/visits/${ids[name] ?? ""}`)).json<{ document_id: string | null; invoice_expected: boolean }>();

    expect(await detail("ap-done")).toMatchObject({ document_id: null, invoice_expected: true });
    expect(await detail("ap-consult")).toMatchObject({ document_id: null, invoice_expected: false });

    // Once the pass has issued it, the same visit hands the app the document to open.
    await env.DB.prepare("UPDATE appointments SET fsm_invoice_id = 'stub-41', invoice_issued_at = ?1 WHERE id = ?2")
      .bind(NOW.toISOString(), ids["ap-done"] ?? "")
      .run();
    expect(await detail("ap-done")).toMatchObject({ document_id: ids["ap-done"], invoice_expected: true });
  });

  it("offers no document while the invoice Books holds is still a draft", async () => {
    const ids = await seed([done("ap-done", "2026-09-10")]);
    await signIn();
    await env.DB.prepare("UPDATE appointments SET fsm_invoice_id = 'stub-41' WHERE id = ?1")
      .bind(ids["ap-done"] ?? "")
      .run();
    expect(await (await get(`/api/visits/${ids["ap-done"] ?? ""}`)).json()).toMatchObject({ document_id: null });
  });

  // The visit screen said "The invoice is still generating" of a visit whose invoice was held back as a draft on
  // purpose: a credit paid for it, or its total was not what the visit was sold for (ADR 0070).
  it("says an invoice held back is being checked, and one for a credit visit waits on a ruling", async () => {
    const ids = await seed([done("ap-done", "2026-09-10"), done("ap-credit", "2026-09-12")]);
    await signIn();
    const held = async (name: string) =>
      (await (await get(`/api/visits/${ids[name] ?? ""}`)).json<{ invoice_held: unknown }>()).invoice_held;

    expect(await held("ap-done")).toBeNull();
    await env.DB.prepare("UPDATE appointments SET fsm_invoice_id = 'stub-41' WHERE id = ?1")
      .bind(ids["ap-done"] ?? "")
      .run();
    expect(await held("ap-done")).toBe("checking");
    await env.DB.prepare("UPDATE appointments SET invoice_issued_at = ?1 WHERE id = ?2")
      .bind(NOW.toISOString(), ids["ap-done"] ?? "")
      .run();
    expect(await held("ap-done")).toBeNull();

    // A credit paid for it: never sent until the CA rules how such a visit is invoiced (open point 14).
    const person = await env.DB.prepare("SELECT person_id FROM appointments WHERE id = ?1")
      .bind(ids["ap-credit"] ?? "")
      .first<string>("person_id");
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO credit_ledger (id, person_id, kind, visits, source_kind, source_id, expires_at, created_at)
         VALUES ('grant-1', ?1, 'grant', 3, 'referral', 'referral-1', '2027-09-21T06:30:00.000Z', ?2)`,
      ).bind(person, NOW.toISOString()),
      env.DB.prepare(
        `INSERT INTO credit_ledger (id, person_id, kind, visits, grant_id, source_kind, source_id, created_at)
         VALUES ('redeem-1', ?1, 'redeem', -1, 'grant-1', 'appointment', ?2, ?3)`,
      ).bind(person, ids["ap-credit"] ?? "", NOW.toISOString()),
    ]);
    expect(await held("ap-credit")).toBe("credit");
  });

  // A no-show read as an ordinary past visit, with no outcome, no charge and no word.
  it("says the client was not home, how long we waited, and what ops ruled", async () => {
    const ids = await seed([
      booked("ap-missed", {
        status: "terminated",
        start: "2026-09-19T10:00:00+05:30",
        end: "2026-09-19T11:30:00+05:30",
      }),
    ]);
    await signIn();
    const visit = ids["ap-missed"] ?? "";
    await env.DB.batch([
      env.DB.prepare("UPDATE visits SET outcome = 'no_show', partial_reason = NULL"),
      env.DB.prepare(
        `INSERT INTO checkins (id, appointment_id, technician_id, at, lat, lng, radius_m, passed, created_at)
         SELECT 'checkin-1', ?1, id, '2026-09-19T04:32:00.000Z', 28.4, 77.0, 200, 1, '2026-09-19T04:32:00.000Z'
         FROM technicians LIMIT 1`,
      ).bind(visit),
      env.DB.prepare(
        `INSERT INTO no_show_cases (id, checkin_id, appointment_id, wait_started_at, wait_ends_at, closed_at,
           decision, created_at)
         VALUES ('case-1', 'checkin-1', ?1, '2026-09-19T04:32:00.000Z', '2026-09-19T04:47:00.000Z',
           '2026-09-19T04:48:00.000Z', 'undecided', '2026-09-19T04:48:00.000Z')`,
      ).bind(visit),
    ]);
    const detail = async () => (await get(`/api/visits/${visit}`)).json<{ outcome: string | null; no_show: unknown }>();

    expect(await detail()).toMatchObject({
      outcome: "no_show",
      no_show: { decision: "undecided", waited_minutes: 16 },
    });
    // The list says it too, so a missed visit does not read as one done.
    const listed = await (await get("/api/visits")).json<{ past: { id: string; not_home: boolean }[] }>();
    expect(listed.past).toEqual([expect.objectContaining({ id: visit, not_home: true })]);
    await env.DB.prepare(
      "UPDATE no_show_cases SET decision = 'charged', charge = 'visit', kept_amount = 200000, refund_amount = 0",
    ).run();
    expect((await detail()).no_show).toEqual({
      decision: "charged",
      waited_minutes: 16,
      charge: { kept: 200000, credit_spent: false },
      dispute: null,
      disputable: true,
      dispute_closed_at: null,
    });
  });

  interface Links {
    readonly url: string;
    readonly thumbnail_url: string | null;
  }
  const afterPhotos = async (visitId: string) =>
    (await (await get(`/api/visits/${visitId}`)).json<{ photos: { after: Links[] } }>()).photos.after;

  it("links a photograph's small copy for the rows, and none for one without", async () => {
    const ids = await seed([done("ap-done", "2026-09-10")]);
    await signIn();
    const [withoutOne] = await afterPhotos(ids["ap-done"] ?? "");
    expect(withoutOne?.thumbnail_url).toBeNull();

    const small = syntheticJpeg(300, 400, "small");
    await env.CLIENT_PHOTOS.put("visits/small-copy.jpg", small);
    await env.DB.prepare("UPDATE photos SET thumbnail_key = 'visits/small-copy.jpg'").run();
    const [withOne] = await afterPhotos(ids["ap-done"] ?? "");
    const image = await get(withOne?.thumbnail_url ?? "");
    expect(image.status).toBe(200);
    expect(image.headers.get("Content-Type")).toBe("image/jpeg");
    expect(new Uint8Array(await image.arrayBuffer())).toEqual(small);
    expect((await get(withOne?.thumbnail_url ?? "", false)).status).toBe(401);
    // The link to the photograph itself is still the whole photograph, which the sheet opens.
    expect((await (await get(withOne?.url ?? "")).arrayBuffer()).byteLength).not.toBe(small.byteLength);
  });

  it("serves the photograph itself through a small copy's link when the copy is missing from the bucket", async () => {
    const ids = await seed([done("ap-done", "2026-09-10")]);
    await signIn();
    await env.DB.prepare("UPDATE photos SET thumbnail_key = 'visits/never-stored-small.jpg'").run();
    const [photo] = await afterPhotos(ids["ap-done"] ?? "");
    const image = await get(photo?.thumbnail_url ?? "");
    expect(image.status).toBe(200);
    const whole = await get(photo?.url ?? "");
    expect(await image.arrayBuffer()).toEqual(await whole.arrayBuffer());
  });

  it("refuses a photograph link once its 15 minutes are up", async () => {
    const ids = await seed([done("ap-done", "2026-09-10")]);
    await signIn();
    const url =
      (await (await get(`/api/visits/${ids["ap-done"] ?? ""}`)).json<{ photos: { after: { url: string }[] } }>()).photos
        .after[0]?.url ?? "";
    const later = appFor("local", fakeDependencies({ now: () => new Date(NOW.getTime() + 16 * 60_000) }), {}, "client");
    expect((await request(later, url, { headers: { Cookie: cookie } })).status).toBe(404);
  });
});

describe("GET /api/photos and /api/photos/compare", () => {
  it("lists the visits that have photographs, newest first, and compares one angle across two", async () => {
    const ids = await seed([done("ap-earlier", "2026-08-01"), done("ap-done", "2026-09-10"), booked("ap-next")]);
    await signIn();
    const timeline = await (await get("/api/photos")).json<{ visits: { date: string }[] }>();
    expect(timeline.visits.map((visit) => visit.date)).toEqual(["2026-09-10", "2026-08-01"]);

    const compared = await (
      await get(`/api/photos/compare?from=${ids["ap-earlier"] ?? ""}&to=${ids["ap-done"] ?? ""}&angle=front`)
    ).json<{
      phase: string;
      from: { date: string; photo: { width: number } };
      to: { date: string; photo: { width: number } };
    }>();
    expect(compared).toMatchObject({
      phase: "after",
      from: { date: "2026-08-01", photo: { width: 800 } },
      to: { date: "2026-09-10", photo: { width: 1200 } },
    });
  });

  it("will not compare a visit that is not the client's", async () => {
    const ids = await seed([done("ap-done", "2026-09-10")]);
    await signIn();
    const response = await get(
      `/api/photos/compare?from=${crypto.randomUUID()}&to=${ids["ap-done"] ?? ""}&angle=front`,
    );
    expect(response.status).toBe(404);
  });
});
