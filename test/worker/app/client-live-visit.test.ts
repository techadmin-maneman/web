// A visit as it happens reaches the client's app (docs/decisions/0255-client-alerts-and-push.md):
// the technician's latest word before they arrive, the wait at the door once checked in, and the step under way, by the
// plan the technician's app works (src/policy/visit-plan.ts). Nothing of where the technician is, nor their phone. NOW
// is Monday 21 September 2026, 12 noon in India. Every name and number here is made up.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import type { App } from "../../../src/http/context.ts";
import { appFor, fakeDependencies, markDatabase, request } from "../helpers.ts";
import { IMRAN, SANA, client, technician, visit } from "../booking/client-booking-fixtures.ts";

let app: App;

beforeEach(async () => {
  await markDatabase();
  app = appFor("local", fakeDependencies(), {}, "client");
  await technician(IMRAN, "Imran Qureshi", "IQ");
  await technician(SANA, "Sana Mirza", "SM");
});

/** 12:30 pm in India today, half an hour from NOW. */
const TODAY_AT = "2026-09-21T07:00:00.000Z";

type Live = { stage: string | null; latest_update: unknown; step: unknown; waits_until: string | null };

const nextVisit = async (who: { cookie: string }) =>
  (await (await request(app, "/api/me", { headers: { Cookie: who.cookie } })).json<{ next_visit: Live }>()).next_visit;

const said = (visitId: string, preset: string, minutes: number | null, at: string) =>
  env.DB.prepare(
    `INSERT INTO technician_updates (id, appointment_id, technician_id, preset, minutes, written_at, created_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6)`,
  )
    .bind(crypto.randomUUID(), visitId, IMRAN, preset, minutes, at)
    .run();

const landed = (visitId: string, kind: string, at: string) =>
  env.DB.prepare(
    `INSERT INTO job_events (id, appointment_id, event_id, technician_id, kind, body, occurred_at, received_at,
       superseded, updated_at) VALUES (?1, ?2, ?1, ?3, ?4, '{}', ?5, ?5, 0, ?5)`,
  )
    .bind(crypto.randomUUID(), visitId, IMRAN, kind, at)
    .run();

/** A visit today with Imran, booked for 12:30 pm and taking 90 minutes. */
async function today(personId: string, type: string): Promise<string> {
  const id = await visit(personId, type, "scheduled", TODAY_AT, IMRAN);
  await env.DB.prepare("UPDATE appointments SET window_end = ?2 WHERE id = ?1")
    .bind(id, "2026-09-21T08:30:00.000Z")
    .run();
  return id;
}

describe("a visit today", () => {
  it("says the technician's latest word before they arrive, and nothing of where they are", async () => {
    const rohit = await client();
    const id = await today(rohit.id, "service");
    expect(await nextVisit(rohit)).toMatchObject({ stage: "booked", latest_update: null });

    await said(id, "on_the_way", 20, "2026-09-21T06:20:00.000Z");
    expect((await nextVisit(rohit)).latest_update).toEqual({
      kind: "on_the_way",
      minutes: 20,
      at: "2026-09-21T06:20:00.000Z",
    });

    await said(id, "running_late", 15, "2026-09-21T06:25:00.000Z");
    expect((await nextVisit(rohit)).latest_update).toMatchObject({ kind: "running_late", minutes: 15 });

    await said(id, "at_gate", null, "2026-09-21T06:28:00.000Z");
    expect((await nextVisit(rohit)).latest_update).toMatchObject({ kind: "at_the_gate", minutes: null });
  });

  it("says how long the technician waits at the door once checked in: from the booked start, as ops set it", async () => {
    const rohit = await client();
    const id = await today(rohit.id, "service");
    await said(id, "on_the_way", 20, "2026-09-21T06:20:00.000Z");
    await landed(id, "check_in", "2026-09-21T06:55:00.000Z");

    // Early, so the wait runs from the booked 12:30 pm: to 12:45 pm.
    expect(await nextVisit(rohit)).toMatchObject({
      stage: "arrived",
      latest_update: null,
      waits_until: "2026-09-21T07:15:00.000Z",
    });
  });

  it("counts a service's steps as the client knows them, the count of what was used left out", async () => {
    const rohit = await client();
    const id = await today(rohit.id, "service");
    await landed(id, "check_in", "2026-09-21T06:55:00.000Z");
    await landed(id, "start", "2026-09-21T07:00:00.000Z");
    expect(await nextVisit(rohit)).toMatchObject({
      stage: "in_progress",
      waits_until: null,
      step: { index: 1, of: 3, name: "before_photos" },
    });

    await landed(id, "before_photos", "2026-09-21T07:05:00.000Z");
    expect((await nextVisit(rohit)).step).toEqual({ index: 2, of: 3, name: "service" });

    await landed(id, "checklist", "2026-09-21T07:40:00.000Z");
    await landed(id, "consumables", "2026-09-21T07:41:00.000Z");
    expect((await nextVisit(rohit)).step).toEqual({ index: 3, of: 3, name: "after_photos" });
  });

  it("counts a first fit's steps in the order the technician's app works them", async () => {
    const lead = await client(true);
    const id = await today(lead.id, "first_fit");
    await landed(id, "check_in", "2026-09-21T06:55:00.000Z");
    await landed(id, "start", "2026-09-21T07:00:00.000Z");
    await landed(id, "before_photos", "2026-09-21T07:05:00.000Z");
    expect((await nextVisit(lead)).step).toEqual({ index: 2, of: 6, name: "hair_profile" });

    await landed(id, "piece", "2026-09-21T07:20:00.000Z");
    expect((await nextVisit(lead)).step).toEqual({ index: 4, of: 6, name: "fitting" });
  });

  it("is told of on the visit's own page too", async () => {
    const rohit = await client();
    const id = await today(rohit.id, "service");
    await said(id, "on_the_way", 20, "2026-09-21T06:20:00.000Z");
    const detail = await (await request(app, `/api/visits/${id}`, { headers: { Cookie: rohit.cookie } })).json<Live>();
    expect(detail.latest_update).toMatchObject({ kind: "on_the_way" });
  });
});
