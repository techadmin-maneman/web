// The client app's visits and photographs, read from D1. Every name and number here is made up.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import type { App } from "../../../src/http/context.ts";
import { grantCredits, redeemCredit } from "../../../src/domain/money/credits.ts";
import { findEligiblePerson } from "../../../src/domain/sign-in/login.ts";
import { appFor, fakeDependencies, markDatabase, NOW, request } from "../helpers.ts";
import { syntheticJpeg } from "../tryon-fixtures.ts";
import {
  MOBILE,
  OTHER_MOBILE,
  NAMES,
  type Visit,
  booked,
  done,
  PHOTOS,
  utc,
  cookie,
  signIn,
} from "./client-visits-fixtures.ts";

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

describe("GET /api/me", () => {
  it("is a lead with a consultation booked as the next visit", async () => {
    await seed([booked("ap-consult", { type: "consultation" })]);
    await signIn();
    const me = await (await get("/api/me")).json<Record<string, unknown>>();
    expect(me).toMatchObject({
      state: "lead",
      consultation: null,
      next_visit: {
        date: "2026-09-24",
        window_label: "morning",
        starts_at: "2026-09-24T04:30:00.000Z",
        length_minutes: 90,
        type: "consultation",
        status: "scheduled",
        technician: { name: "Imran Khan", initials: "IK" },
        place: "Gurgaon 122018",
      },
      credits: null,
      // Booked, and no address given yet: the technician has no door to go to.
      prompt: { kind: "address" },
    });
  });

  it("is fitted once a visit after the consultation is done, with the next one ahead", async () => {
    await seed([done("ap-done", "2026-09-10"), booked("ap-next")]);
    await signIn();
    const me = await (await get("/api/me")).json<Record<string, unknown>>();
    expect(me).toMatchObject({ state: "fitted", next_visit: { type: "service", date: "2026-09-24" } });
  });

  it("drops the first form's proposal once the person has had a visit, and offers the first fit", async () => {
    await env.DB.prepare(
      "INSERT INTO people (id, created_at, mobile_e164, name) VALUES ('p1', ?1, ?2, 'Rohit Malhotra')",
    )
      .bind(NOW.toISOString(), MOBILE)
      .run();
    await env.DB.prepare(
      `INSERT INTO leads (id, person_id, created_at, source, city, first_choice_window, loss_extent, proposed_visit_date,
         sync_state, request_id)
       VALUES ('l1', 'p1', ?1, 'form', 'Gurgaon', 'weekday_am', 'crown', '2026-09-10', 'synced', 'r1')`,
    )
      .bind(NOW.toISOString())
      .run();
    await seed([done("ap-done", "2026-09-10", { type: "consultation" })]);
    await signIn();
    const me = await (await get("/api/me")).json<Record<string, unknown>>();
    expect(me).toMatchObject({
      state: "lead",
      consultation: null,
      next_visit: null,
      booking: { self_serve: true, types: ["first_fit"] },
    });
  });

  it("lets a client who never filled the form log in once a visit is booked for them", async () => {
    await seed([booked("ap-next")]);
    expect(await findEligiblePerson(env.DB, MOBILE)).not.toBeNull();
    expect(await findEligiblePerson(env.DB, "+919810000009")).toBeNull();
  });
});

describe("GET /api/visits", () => {
  it("lists upcoming visits soonest first and past ones newest first, and only the client's own", async () => {
    await seed([
      done("ap-earlier", "2026-08-01"),
      done("ap-done", "2026-09-10"),
      booked("ap-next"),
      booked("ap-someone-else", { mobile: OTHER_MOBILE }),
      booked("ap-cancelled", { status: "cancelled" }),
    ]);
    await signIn();
    const visits = await (
      await get("/api/visits")
    ).json<{ upcoming: { date: string }[]; past: { date: string; status: string }[] }>();
    expect(visits.upcoming.map((visit) => visit.date)).toEqual(["2026-09-24"]);
    // A cancelled visit stays on the list, under past, so the client keeps a record of it.
    expect(visits.past.map(({ date, status }) => ({ date, status }))).toEqual([
      { date: "2026-09-24", status: "cancelled" },
      { date: "2026-09-10", status: "completed" },
      { date: "2026-08-01", status: "completed" },
    ]);
  });

  it("leaves out a visit a charged move replaced, since the new visit stands in its place", async () => {
    const ids = await seed([
      booked("ap-replaced", { status: "cancelled" }),
      booked("ap-cancelled", { status: "cancelled", start: "2026-09-23T10:00:00+05:30" }),
    ]);
    const replaced = await env.DB.prepare("SELECT person_id, window_start FROM appointments WHERE id = ?1")
      .bind(ids["ap-replaced"])
      .first<{ person_id: string; window_start: string }>();
    await env.DB.prepare(
      `INSERT INTO visit_changes (id, appointment_id, person_id, kind, notice, was_start, created_at)
       VALUES ('change-1', ?1, ?2, 'replaced', 'late', ?3, ?4)`,
    )
      .bind(ids["ap-replaced"], replaced?.person_id, replaced?.window_start, NOW.toISOString())
      .run();
    await signIn();
    const visits = await (await get("/api/visits")).json<{ past: { date: string }[] }>();
    expect(visits.past.map((visit) => visit.date)).toEqual(["2026-09-23"]);
  });

  it("needs a session", async () => {
    expect((await get("/api/visits", false)).status).toBe(401);
  });

  // Home and Visits never said which hair system a first fit was for.
  it("names the hair system a first fit was sold as, and nothing for a kind's standard service", async () => {
    const id = (await seed([booked("ap-next")]))["ap-next"];
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO services (kind, tier, name, minutes, sort, updated_by, updated_at)
         VALUES ('first_fit', 'essential', 'Mane Man Essential', 180, 1, 'ops@localhost', ?1)`,
      ).bind(NOW.toISOString()),
      env.DB.prepare("UPDATE appointments SET type = 'first_fit', tier = 'essential' WHERE id = ?1").bind(id),
    ]);
    await signIn();
    const visits = await (await get("/api/visits")).json<{ upcoming: Record<string, unknown>[] }>();
    expect(visits.upcoming).toMatchObject([{ type: "first_fit", service: "Mane Man Essential" }]);
    const me = await (await get("/api/me")).json<Record<string, unknown>>();
    expect(me).toMatchObject({ next_visit: { service: "Mane Man Essential" } });

    // Booked as one visit, the client has not chosen their hair system yet.
    await env.DB.prepare("UPDATE appointments SET one_visit = 'booked' WHERE id = ?1").bind(id).run();
    const oneVisit = await (await get("/api/visits")).json<{ upcoming: Record<string, unknown>[] }>();
    expect(oneVisit.upcoming).toMatchObject([{ service: null }]);

    await env.DB.prepare("UPDATE appointments SET type = 'service', tier = 'standard', one_visit = NULL WHERE id = ?1")
      .bind(id)
      .run();
    const standard = await (await get("/api/visits")).json<{ upcoming: Record<string, unknown>[] }>();
    expect(standard.upcoming).toMatchObject([{ type: "service", service: null }]);
  });
});

// A visit stays the client's until it is closed. One that dropped out of both lists once its window
// ended left Home saying nothing was booked, and offering the booking again.
describe("a visit not yet closed", () => {
  // NOW is 12:00 on Monday 21 September in India.
  const yesterday = booked("ap-yesterday", {
    start: "2026-09-20T10:00:00+05:30",
    end: "2026-09-20T11:30:00+05:30",
  });
  const now = booked("ap-now", {
    status: "in_progress",
    start: "2026-09-21T11:00:00+05:30",
    end: "2026-09-21T12:30:00+05:30",
  });

  it("stays under upcoming once its window has passed, as being closed", async () => {
    await seed([yesterday, booked("ap-next")]);
    await signIn();
    const visits = await (await get("/api/visits")).json<{ upcoming: { date: string; stage: string }[] }>();
    expect(visits.upcoming.map(({ date, stage }) => ({ date, stage }))).toEqual([
      { date: "2026-09-20", stage: "closing" },
      { date: "2026-09-24", stage: "booked" },
    ]);
  });

  it("is in progress while the technician works in its window", async () => {
    await seed([now]);
    await signIn();
    const visits = await (await get("/api/visits")).json<{ upcoming: { stage: string }[] }>();
    expect(visits.upcoming.map((visit) => visit.stage)).toEqual(["in_progress"]);
  });

  it("keeps Home on the visit, rather than saying nothing is booked", async () => {
    await seed([yesterday]);
    await signIn();
    const me = await (await get("/api/me")).json<Record<string, unknown>>();
    expect(me).toMatchObject({ state: "lead", next_visit: { date: "2026-09-20", stage: "closing" } });
  });

  it("gives way on Home to a visit still to come", async () => {
    await seed([yesterday, booked("ap-next")]);
    await signIn();
    const me = await (await get("/api/me")).json<Record<string, unknown>>();
    expect(me).toMatchObject({ next_visit: { date: "2026-09-24", stage: "booked" } });
  });
});

describe("a visit paid for ahead (its Prepaid)", () => {
  it("is prepaid once a payment for it is captured, or a credit covers it, and not otherwise", async () => {
    const ids = await seed([
      booked("ap-paid"),
      booked("ap-credit", { start: "2026-09-25T10:00:00+05:30" }),
      booked("ap-unpaid", { start: "2026-09-26T10:00:00+05:30" }),
    ]);
    await signIn();
    const person = await env.DB.prepare("SELECT id FROM people WHERE mobile_e164 = ?1")
      .bind(MOBILE)
      .first<{ id: string }>();
    await env.DB.prepare(
      `INSERT INTO payments (id, person_id, appointment_id, razorpay_payment_id, amount, currency, status, captured_at,
         created_at, updated_at) VALUES ('pay-1', ?1, ?2, 'pay_1', 236000, 'INR', 'captured', ?3, ?3, ?3)`,
    )
      .bind(person?.id, ids["ap-paid"], NOW.toISOString())
      .run();
    await env.DB.prepare(
      "INSERT INTO technicians (id, fsm_id, name, initials, active, updated_at) VALUES ('t-held', 'sr-held', 'T', 'T', 1, ?1)",
    )
      .bind(NOW.toISOString())
      .run();
    await env.DB.prepare(
      `INSERT INTO slot_holds (id, person_id, type, date, window_label, technician_id, start_unit, amount, amount_ex_gst,
         gst_percent, state, appointment_id, expires_at, created_at, updated_at, use_credit)
       VALUES ('hold-1', ?1, 'service', '2026-09-25', 'morning', 't-held', 0, 0, 0, 0, 'booked', ?2, ?3, ?3, ?3, 1)`,
    )
      .bind(person?.id, ids["ap-credit"], NOW.toISOString())
      .run();
    // The credit it spent, as booking writes it in the batch that writes the visit.
    await grantCredits(env.DB, {
      personId: person?.id ?? "",
      visits: 1,
      source: "ops",
      sourceId: "o1",
      now: NOW,
    }).run();
    await redeemCredit(env.DB, person?.id ?? "", ids["ap-credit"] ?? "", NOW).run();

    const visits = await (await get("/api/visits")).json<{ upcoming: { id: string; prepaid: boolean }[] }>();
    const prepaid = Object.fromEntries(visits.upcoming.map((visit) => [visit.id, visit.prepaid]));
    expect(prepaid).toEqual({
      [ids["ap-paid"] ?? ""]: true,
      [ids["ap-credit"] ?? ""]: true,
      [ids["ap-unpaid"] ?? ""]: false,
    });
  });
});
