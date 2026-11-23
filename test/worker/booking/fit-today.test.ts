// Fit today (src/domain/booking/fit-today.ts, src/routes/tech/jobs.fit-today.ts, ADR 0299): a plain consultation the
// technician has just closed as done becomes the client's fit on the spot, as a consultation and fit in one visit with
// them, where their kit holds a piece made exactly to the client's profile and their day has room to begin now. NOW in
// these tests is Monday 21 September 2026, 2 pm in India: the consultation was 1 to 2:30. Every name and number is made
// up.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { markDatabase } from "../helpers.ts";
import { aPackage, aVisit } from "../fixtures/index.ts";
import { IMRAN, JOB, PERSON, SAMEER, working, type Working } from "../job-fixtures.ts";

/** 2 pm in India, the consultation closed half an hour early. */
const TWO_PM = new Date("2026-09-21T08:30:00.000Z");

/** Mane Man Natural, its first fit two hours, its hair system 8 by 10 in, 1B, no grey, full density. */
const NATURAL = { code: "natural", name: "Mane Man Natural", firstFit: 4_500_000, firstFitMinutes: 120 };

let job: Working;
let stockCode: string;

/** The consultation closed as done from the phone, at 2 pm. */
const closedDone = () =>
  env.DB.prepare(
    `INSERT INTO job_events (id, appointment_id, event_id, technician_id, kind, body, occurred_at, received_at,
       superseded, updated_at) VALUES ('ev-out', ?1, 'ev-out', ?2, 'outcome', '{"outcome":"done"}', ?3, ?3, 0, ?3)`,
  )
    .bind(JOB, IMRAN, TWO_PM.toISOString())
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

beforeEach(async () => {
  await markDatabase();
  job = await working("consultation", { now: () => TWO_PM });
  // Both in Gurgaon, where the client's pincode is served, and trained to fit (ADR 0117).
  await env.DB.prepare("UPDATE technicians SET city = 'Gurgaon', fits_trained = 1").run();
  await env.DB.prepare(
    `INSERT OR IGNORE INTO serviceable_pincodes (pincode, area, city, served, centre_lat, centre_lng)
     VALUES ('122018', 'Sector 65', 'Gurgaon', 1, 28.398, 77.07)`,
  ).run();
  stockCode = (await aPackage({ ...NATURAL, validFrom: "2026-09-01" })).hairSystem;
});

const offered = async () =>
  (await job.get(`/api/tech/jobs/${JOB}/fit-today`)).json<{ offer: Record<string, unknown> | null; refusal: string }>();
const booked = () => job.post(`/api/tech/jobs/${JOB}/fit-today`, undefined, "event-fit-today-01");

describe("Fit today", () => {
  it("is offered with the piece in the kit and a start to begin now, and books a fixed one visit with this technician", async () => {
    await closedDone();
    await profiled();
    await inKitOf(IMRAN);
    const offer = await offered();
    expect(offer).toMatchObject({
      refusal: null,
      offer: { product: NATURAL.name, stock_code: stockCode, minutes: 120 },
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

  it("books it once: the client's fit to come refuses a second", async () => {
    await closedDone();
    await profiled();
    await inKitOf(IMRAN);
    expect((await booked()).status).toBe(201);
    expect(await offered()).toEqual({ offer: null, refusal: "fit_booked" });
    expect((await job.post(`/api/tech/jobs/${JOB}/fit-today`, undefined, "event-fit-today-02")).status).toBe(409);
  });

  it("is not offered before the consultation is closed as done, nor on another technician's", async () => {
    await profiled();
    await inKitOf(IMRAN);
    expect(await offered()).toEqual({ offer: null, refusal: "not_offered" });
    expect((await booked()).status).toBe(404);
    await closedDone();
    await env.DB.prepare("UPDATE appointments SET technician_id = ?2 WHERE id = ?1").bind(JOB, SAMEER).run();
    expect(await offered()).toEqual({ offer: null, refusal: "not_offered" });
  });

  it("is not offered where no piece in this technician's kit is made exactly to the profile", async () => {
    await closedDone();
    await profiled("2");
    await inKitOf(IMRAN);
    expect(await offered()).toEqual({ offer: null, refusal: "not_in_kit" });
    // Measured again, to the piece's colour; the piece then given to Sameer's kit.
    await profiled("1B", new Date(TWO_PM.getTime() + 60_000));
    await env.DB.prepare("UPDATE stock_units SET place = ?1 WHERE consumable_code = ?2").bind(SAMEER, stockCode).run();
    expect(await offered()).toEqual({ offer: null, refusal: "not_in_kit" });
    expect((await booked()).status).toBe(422);
  });

  it("is not offered where the technician's day has no room to begin now", async () => {
    await closedDone();
    await profiled();
    await inKitOf(IMRAN);
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
});
