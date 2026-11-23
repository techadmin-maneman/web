// Fit today (src/domain/booking/fit-today.ts, src/routes/tech/jobs.fit-today.ts, ADR 0299): a plain consultation the
// technician has just closed as done, the client going ahead, becomes the client's fit on the spot, as a consultation
// and fit in one visit with them, where their kit holds a piece made exactly to the client's profile and their day has
// room to begin now. NOW in these tests is Monday 21 September 2026, 2 pm in India, unless a test says: the consultation
// was 1 to 2:30. Every name and number is made up.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { LEGAL_VERSIONS } from "../../../src/config/legal-versions.ts";
import type { Dependencies } from "../../../src/dependencies.ts";
import { createLogger } from "../../../src/log.ts";
import { createPaymentsProvider } from "../../../src/providers/payments/index.ts";
import { markDatabase } from "../helpers.ts";
import { aHold, aPackage, aVisit } from "../fixtures/index.ts";
import { IMRAN, JOB, PERSON, SAMEER, working, type Working } from "../job-fixtures.ts";

/** 2 pm in India, the consultation closed half an hour early. */
const TWO_PM = new Date("2026-09-21T08:30:00.000Z");

/** Mane Man Natural, its first fit two hours, its hair system 8 by 10 in, 1B, no grey, full density. */
const NATURAL = { code: "natural", name: "Mane Man Natural", firstFit: 4_500_000, firstFitMinutes: 120 };

let job: Working;
let stockCode: string;
let now: Date;

/**
 * The consultation closed as done on the phone at `made`, reaching us at `at`, the client going ahead unless `close`
 * says otherwise.
 */
async function closedDone(close: object = { going_ahead: true }, at = now, made = at) {
  await env.DB.prepare(
    `INSERT INTO job_events (id, appointment_id, event_id, technician_id, kind, body, occurred_at, received_at,
       superseded, updated_at) VALUES (?4, ?1, ?4, ?2, 'outcome', ?5, ?6, ?3, 0, ?3)`,
  )
    .bind(
      JOB,
      IMRAN,
      at.toISOString(),
      crypto.randomUUID(),
      JSON.stringify({ outcome: "done", ...close }),
      made.toISOString(),
    )
    .run();
  // As the close moves it (src/domain/field/job-record.ts).
  await env.DB.prepare("UPDATE appointments SET status = 'completed' WHERE id = ?1").bind(JOB).run();
}

/** The client agreed to today's terms as they booked the consultation on the site. */
const agreed = () =>
  env.DB.prepare(
    `INSERT INTO terms_acceptances (id, person_id, terms_version, privacy_version, source, ip_hash, created_at)
     VALUES ('ta-1', ?1, ?2, ?3, 'site_booking', 'hash', ?4)`,
  )
    .bind(PERSON, LEGAL_VERSIONS.terms, LEGAL_VERSIONS.privacy, TWO_PM.toISOString())
    .run();

/** The client's latest profile, made to Natural's hair system unless `colour` says otherwise. */
const profiled = (colour = "1B", at = TWO_PM) =>
  env.DB.prepare(
    `INSERT INTO hair_profiles (id, person_id, staff, created_at, product, base_width_in, base_length_in, colour,
       grey_percent, density_percent)
     VALUES (?4, ?1, 'ops@localhost', ?2, 'natural', 8, 10, ?3, 0, 100)`,
  )
    .bind(PERSON, at.toISOString(), colour, crypto.randomUUID())
    .run();

/** A piece of the hair system delivered and handed to `technician`'s kit. */
async function inKitOf(technician: string) {
  await job.opsPost("/api/stock/deliveries", { consumable_code: stockCode, quantity: 1 });
  await job.opsPost("/api/stock/transfers", {
    consumable_code: stockCode,
    quantity: 1,
    from: "central",
    to: technician,
  });
}

/** All that Fit today asks of the client and the kit: closed as done going ahead, agreed, profiled, the piece held. */
async function ready() {
  await closedDone();
  await agreed();
  await profiled();
  await inKitOf(IMRAN);
}

/** Imran's consultation today, with the vendors a test gives: the client's pincode served, Natural on sale. */
async function setUp(vendors: Partial<Dependencies> = {}) {
  await markDatabase();
  now = TWO_PM;
  job = await working("consultation", { now: () => now, ...vendors });
  // Both in Gurgaon, where the client's pincode is served, and trained to fit (ADR 0117).
  await env.DB.prepare("UPDATE technicians SET city = 'Gurgaon', fits_trained = 1").run();
  await env.DB.prepare(
    `INSERT OR IGNORE INTO serviceable_pincodes (pincode, area, city, served, centre_lat, centre_lng)
     VALUES ('122018', 'Sector 65', 'Gurgaon', 1, 28.398, 77.07)`,
  ).run();
  stockCode = (await aPackage({ ...NATURAL, validFrom: "2026-09-01" })).hairSystem;
}

const offered = async () =>
  (await job.get(`/api/tech/jobs/${JOB}/fit-today`)).json<{ offer: Record<string, unknown> | null; refusal: string }>();
const booked = (event = "event-fit-today-01") => job.post(`/api/tech/jobs/${JOB}/fit-today`, undefined, event);

describe("Fit today", () => {
  beforeEach(async () => {
    await setUp();
  });

  it("is offered with the piece in the kit and a start to begin now, and books a fixed one visit with this technician", async () => {
    await ready();
    const offer = await offered();
    expect(offer).toMatchObject({
      refusal: null,
      offer: { product: NATURAL.name, stock_code: stockCode, minutes: 120, pays_by: "link" },
    });
    const startsAt = String(offer.offer?.starts_at);
    // Within the hour a technician may check in ahead of a start, so they begin at once.
    expect(Date.parse(startsAt) - TWO_PM.getTime()).toBeLessThanOrEqual(60 * 60_000);
    expect(Date.parse(startsAt)).toBeGreaterThan(TWO_PM.getTime() - 1);

    const answer = await booked();
    expect(answer.status).toBe(201);
    const { visit_id: visitId } = await answer.json<{ visit_id: string }>();
    const visit = await env.DB.prepare(
      `SELECT type, tier, one_visit, technician_id, technician_draft, window_start, person_id FROM appointments
       WHERE id = ?1`,
    )
      .bind(visitId)
      .first();
    expect(visit).toEqual({
      type: "first_fit",
      tier: NATURAL.code,
      one_visit: "booked",
      technician_id: IMRAN,
      technician_draft: 0,
      window_start: startsAt,
      person_id: PERSON,
    });
    // Nothing paid now: the one visit's link comes when the client is fitted.
    expect(
      await env.DB.prepare("SELECT amount, one_visit, technician_chosen FROM slot_holds WHERE appointment_id = ?1")
        .bind(visitId)
        .first(),
    ).toEqual({ amount: 0, one_visit: 1, technician_chosen: 1 });
    // Its card pays at the visit, and opens at once: today, with this technician.
    expect(await (await job.get(`/api/tech/jobs/${visitId}`)).json()).toMatchObject({
      one_visit: true,
      badge: "at_visit",
      unlocked: true,
    });
  });

  it("books it once: asked again, it answers with the fit booked, and offers it no more", async () => {
    await ready();
    const first = await (await booked()).json<{ visit_id: string }>();
    const again = await booked("event-fit-today-02");
    expect(again.status).toBe(201);
    expect(await again.json()).toEqual({ visit_id: first.visit_id });
    expect(await offered()).toEqual({ offer: null, refusal: "fit_booked" });
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM appointments WHERE type = 'first_fit'").first("n")).toBe(1);
  });

  it("is not offered before the consultation is closed as done, nor on another technician's", async () => {
    await agreed();
    await profiled();
    await inKitOf(IMRAN);
    expect(await offered()).toEqual({ offer: null, refusal: "not_offered" });
    expect((await booked()).status).toBe(404);
    await closedDone();
    await env.DB.prepare("UPDATE appointments SET technician_id = ?2 WHERE id = ?1").bind(JOB, SAMEER).run();
    expect(await offered()).toEqual({ offer: null, refusal: "not_offered" });
  });

  it("is not offered where the client is not going ahead, or the close reached us over an hour ago", async () => {
    await agreed();
    await profiled();
    await inKitOf(IMRAN);
    await closedDone({ going_ahead: false, lost_reason: "price" });
    expect(await offered()).toEqual({ offer: null, refusal: "not_offered" });
    expect((await booked()).status).toBe(404);
    // Closed again, going ahead: offered, until the close is over an hour old and the technician has gone.
    await closedDone({ going_ahead: true }, new Date(TWO_PM.getTime() + 60_000));
    expect((await offered()).refusal).toBeNull();
    now = new Date(TWO_PM.getTime() + 66 * 60_000);
    expect(await offered()).toEqual({ offer: null, refusal: "not_offered" });
  });

  it("books it once more after the hour: a tap again is answered with the fit booked, not a refusal", async () => {
    await ready();
    const first = await (await booked()).json<{ visit_id: string }>();
    now = new Date(TWO_PM.getTime() + 66 * 60_000);
    expect(await (await booked("event-fit-today-03")).json()).toEqual({ visit_id: first.visit_id });
  });

  it("is not offered where the close was made over an hour ago and sent once signal came back", async () => {
    await agreed();
    await profiled();
    await inKitOf(IMRAN);
    // Closed at 12:55 with no signal, and sent at 2.
    await closedDone({ going_ahead: true }, TWO_PM, new Date(TWO_PM.getTime() - 65 * 60_000));
    expect(await offered()).toEqual({ offer: null, refusal: "not_offered" });
  });

  it("is not offered where the client picked another product on Options than the piece in the kit", async () => {
    await agreed();
    await profiled();
    await inKitOf(IMRAN);
    await closedDone({ going_ahead: true, product: "pro" });
    expect(await offered()).toEqual({ offer: null, refusal: "not_in_kit" });
    await closedDone({ going_ahead: true, product: NATURAL.code }, new Date(TWO_PM.getTime() + 1));
    expect((await offered()).refusal).toBeNull();
  });

  it("is not offered where the client has a consultation to come", async () => {
    await ready();
    await aVisit({
      person_id: PERSON,
      type: "consultation",
      status: "scheduled",
      window_start: "2026-09-24T05:30:00.000Z",
      window_end: "2026-09-24T06:30:00.000Z",
      technician_id: SAMEER,
      service_city: "Gurgaon",
      service_pincode: "122018",
    });
    expect(await offered()).toEqual({ offer: null, refusal: "fit_booked" });
  });

  it("is not offered to a client who has not agreed to today's terms", async () => {
    // Booked by phone, the client has agreed to nothing in their own app or on the site.
    await closedDone();
    await profiled();
    await inKitOf(IMRAN);
    expect(await offered()).toEqual({ offer: null, refusal: "terms_needed" });
    expect((await booked()).status).toBe(422);
  });

  it("is not offered where a first fit's payment link ops sent is still open", async () => {
    await ready();
    await aHold({
      person_id: PERSON,
      technician_id: SAMEER,
      type: "first_fit",
      pay_by_link: 1,
      expires_at: new Date(TWO_PM.getTime() + 60 * 60_000).toISOString(),
    });
    expect(await offered()).toEqual({ offer: null, refusal: "fit_booked" });
  });

  it("is not offered where no piece in this technician's kit is made exactly to the profile", async () => {
    await closedDone();
    await agreed();
    await profiled("2");
    await inKitOf(IMRAN);
    expect(await offered()).toEqual({ offer: null, refusal: "not_in_kit" });
    // Measured again, to the piece's colour; the piece then given to Sameer's kit.
    await profiled("1B", new Date(TWO_PM.getTime() + 60_000));
    await env.DB.prepare("UPDATE stock_units SET place = ?1 WHERE consumable_code = ?2").bind(SAMEER, stockCode).run();
    expect(await offered()).toEqual({ offer: null, refusal: "not_in_kit" });
    expect((await booked()).status).toBe(422);
  });

  it("is not offered where the technician's day has no room for the fit", async () => {
    await ready();
    // Imran's next visit, at 4 pm, leaves no two hours.
    await aVisit({
      person_id: PERSON,
      type: "service",
      status: "scheduled",
      window_start: "2026-09-21T10:30:00.000Z",
      window_end: "2026-09-21T11:30:00.000Z",
      technician_id: IMRAN,
      service_city: "Gurgaon",
      service_pincode: "122018",
    });
    expect(await offered()).toEqual({ offer: null, refusal: "no_room" });
    expect((await booked()).status).toBe(409);
  });

  it("is not offered where the first start is later than the technician may check in ahead of it", async () => {
    // At 2:05 the first start is 2:30; ops let a technician check in only ten minutes ahead of a start.
    now = new Date(TWO_PM.getTime() + 5 * 60_000);
    await ready();
    expect((await offered()).refusal).toBeNull();
    await env.DB.prepare(
      `INSERT INTO ops_settings (name, value, set_by, set_at)
       VALUES ('phone_clock', '{"before_start": 10, "held_offline": 24}', 'ops', ?1)`,
    )
      .bind(TWO_PM.toISOString())
      .run();
    expect(await offered()).toEqual({ offer: null, refusal: "no_room" });
  });

  it("is not offered where the fit would start in the evening, when no one visit is booked", async () => {
    // The consultation was 3 to 4, closed at 4:05: the first start, 4:30, is in the evening.
    now = new Date("2026-09-21T10:35:00.000Z");
    await env.DB.prepare("UPDATE appointments SET window_start = ?2, window_end = ?3 WHERE id = ?1")
      .bind(JOB, "2026-09-21T09:30:00.000Z", "2026-09-21T10:30:00.000Z")
      .run();
    await ready();
    expect(await offered()).toEqual({ offer: null, refusal: "no_room" });
  });
});

describe("Fit today, while online payment is off", () => {
  beforeEach(async () => {
    await setUp({ payments: createPaymentsProvider("none", null, { fetch, log: createLogger() }) });
  });

  it("says the client pays by UPI once fitted", async () => {
    await ready();
    expect(await offered()).toMatchObject({ offer: { pays_by: "at_visit" } });
  });
});
