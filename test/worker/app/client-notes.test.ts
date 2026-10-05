// A client's note on a visit to come (docs/prompts/phase2-backend.md, "Booking": POST /appointments/:id/note).
// With self-serve booking on, the app's "Add a note" opened WhatsApp and the note reached neither the record nor
// the technician. NOW is Monday 21 September 2026, 12 noon in India. Every name and number is made up.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { erasePerson } from "../../../src/domain/erasure.ts";
import { openSession } from "../../../src/domain/sessions.ts";
import { jobDetail } from "../../../src/domain/tech-jobs.ts";
import { createLogger } from "../../../src/log.ts";
import { NO_SHOW_WAIT_MIN } from "../../../src/policy/no-show.ts";
import { PHONE_CLOCK } from "../../../src/policy/phone-clock.ts";
import { appFor, fakeDependencies, markDatabase, NOW, request } from "../helpers.ts";

const PERSON = "11111111-1111-4111-8111-111111111111";
const OTHER = "11111111-1111-4111-8111-111111111112";
const VISIT = "22222222-2222-4222-8222-222222222222";
const TECHNICIAN = "33333333-3333-4333-8333-333333333333";

let cookie: string;

const note = (body: unknown, settings = {}, visit = VISIT) =>
  request(appFor("local", fakeDependencies(), settings, "client"), `/api/appointments/${visit}/note`, {
    method: "POST",
    headers: { Cookie: cookie, Origin: "https://maneman.test", "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

beforeEach(async () => {
  await markDatabase();
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO people (id, created_at, mobile_e164, name) VALUES (?1, ?2, '+919810000001', 'Rohit Malhotra'), (?3, ?2, '+919810000002', 'Karan Bhatia')",
    ).bind(PERSON, NOW.toISOString(), OTHER),
    env.DB.prepare(
      "INSERT INTO technicians (id, fsm_id, name, initials, active, updated_at) VALUES (?1, ?1, 'Imran Qureshi', 'IQ', 1, ?2)",
    ).bind(TECHNICIAN, NOW.toISOString()),
    // Tomorrow at 10 am in India, so its card is open to the technician from 6 pm today.
    env.DB.prepare(
      `INSERT INTO appointments (id, fsm_id, person_id, type, status, window_start, window_end, technician_id,
         synced_at)
       VALUES (?1, ?1, ?2, 'service', 'scheduled', '2026-09-22T04:30:00.000Z', '2026-09-22T06:00:00.000Z', ?3, ?4)`,
    ).bind(VISIT, PERSON, TECHNICIAN, NOW.toISOString()),
  ]);
  cookie = `mm_app=${await openSession(env.DB, { kind: "client", subjectId: PERSON, deviceLabel: null, now: NOW })}`;
});

describe("POST /api/appointments/:id/note", () => {
  it("keeps the note on the visit, the latest in place of any before it", async () => {
    expect(await (await note({ note: "Ring twice" })).json()).toEqual({
      note: "Ring twice",
      noted_at: NOW.toISOString(),
    });
    const answer = await note({ note: "  The lift is out; take the stairs at the back  " });
    expect(answer.status).toBe(200);

    const kept = await env.DB.prepare("SELECT client_note, client_note_at FROM appointments").first();
    expect(kept).toEqual({
      client_note: "The lift is out; take the stairs at the back",
      client_note_at: NOW.toISOString(),
    });
  });

  it("reaches the technician on the client's card, from when the card opens", async () => {
    await note({ note: "Ring twice" });
    const card = (at: Date) =>
      jobDetail(env.DB, {
        technicianId: TECHNICIAN,
        jobId: VISIT,
        now: at,
        unlockHour: 18,
        waits: NO_SHOW_WAIT_MIN,
        phoneClock: PHONE_CLOCK,
      });

    expect((await card(NOW))?.client).toBeNull();
    const evening = new Date("2026-09-21T13:00:00.000Z");
    expect((await card(evening))?.client).toMatchObject({ name: "Rohit Malhotra", note: "Ring twice" });
  });

  // ADR 0043 sanctions WhatsApp for the note only while self-serve booking is off.
  // The note went on the visit and nobody could read it back, the client nor ops.
  it("is shown back to the client on their visit, and to ops on the client's page and the dispatch board", async () => {
    await note({ note: "Ring twice" });

    const visits = await request(appFor("local", fakeDependencies(), {}, "client"), "/api/visits", {
      headers: { Cookie: cookie },
    });
    const mine = await visits.json<{ upcoming: { id: string; client_note: string | null }[] }>();
    expect(mine.upcoming).toEqual([expect.objectContaining({ id: VISIT, client_note: "Ring twice" })]);

    const ops = appFor("local", fakeDependencies(), {}, "ops");
    const record = await (await request(ops, `/api/clients/${PERSON}`)).json<{ visits: { upcoming: unknown[] } }>();
    expect(record.visits.upcoming).toEqual([expect.objectContaining({ client_note: "Ring twice" })]);
    const board = await (
      await request(ops, "/api/dispatch?from=2026-09-21")
    ).json<{
      technicians: { days: { blocks: { appointment_id: string; client_note: string | null }[] }[] }[];
    }>();
    const blocks = board.technicians.flatMap((row) => row.days.flatMap((day) => day.blocks));
    expect(blocks).toEqual([expect.objectContaining({ appointment_id: VISIT, client_note: "Ring twice" })]);
  });

  it("sends the client to WhatsApp while self-serve booking is off", async () => {
    const answer = await note({ note: "Ring twice" }, { selfServeBooking: false });
    expect(answer.status).toBe(409);
    expect(await answer.json()).toMatchObject({ error: { code: "ops_assisted" } });
  });

  it("refuses another client's visit, one already closed, an empty note and a long one", async () => {
    await env.DB.prepare("UPDATE appointments SET person_id = ?1").bind(OTHER).run();
    expect((await note({ note: "Ring twice" })).status).toBe(404);

    await env.DB.prepare("UPDATE appointments SET person_id = ?1, status = 'completed'").bind(PERSON).run();
    expect((await note({ note: "Ring twice" })).status).toBe(409);

    await env.DB.prepare("UPDATE appointments SET status = 'scheduled'").run();
    expect((await note({ note: "   " })).status).toBe(400);
    expect((await note({ note: "x".repeat(501) })).status).toBe(400);
    expect(await env.DB.prepare("SELECT client_note FROM appointments").first()).toEqual({ client_note: null });
  });

  it("is blanked when the client is erased, as the rest of what they wrote is", async () => {
    await note({ note: "Ring twice" });
    await env.DB.prepare("UPDATE appointments SET status = 'completed'").run();

    await erasePerson(env, PERSON, NOW, createLogger());

    expect(await env.DB.prepare("SELECT client_note FROM appointments").first()).toEqual({ client_note: null });
  });
});
