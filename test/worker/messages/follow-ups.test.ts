// What follows a visit on WhatsApp (src/domain/visits/follow-ups.ts). NOW is Monday 21 September 2026, 12 noon in
// India; the evening's messages go from 6 pm.
//
// What these hold: after a consultation the client is going ahead from, the technician's recommendation; after a fit
// or a replacement, the care guide; and the check-ins on the days ops set; each once a visit, from the reminder hour,
// and only with the client's consent to WhatsApp about visits.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { composeFollowUp, queueFollowUps, type FollowUpKind } from "../../../src/domain/visits/follow-ups.ts";
import { CHECK_IN_DAYS } from "../../../src/policy/follow-ups.ts";
import { markDatabase, NOW } from "../helpers.ts";

const PERSON = "11111111-1111-4111-8111-111111111111";
const ORIGIN = "https://maneman.in";
/** 6 pm in India on Monday 21 September. */
const EVENING = new Date("2026-09-21T12:30:00Z");
const HOUR = 18;

async function visit(type: string, start: string, lostReason: string | null = null): Promise<string> {
  const id = crypto.randomUUID();
  const end = new Date(Date.parse(start) + 90 * 60_000).toISOString();
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO appointments (id, fsm_id, person_id, type, status, window_start, window_end, technician_id, synced_at)
       VALUES (?1, ?1, ?2, ?3, 'completed', ?4, ?5, 't1', ?6)`,
    ).bind(id, PERSON, type, start, end, NOW.toISOString()),
    env.DB.prepare(
      `INSERT INTO visit_outcomes (id, appointment_id, started_at, ended_at, duration_minutes, outcome, lost_reason, updated_at)
       VALUES (?1, ?1, ?2, ?3, 90, 'done', ?4, ?3)`,
    ).bind(id, start, end, lostReason),
  ]);
  return id;
}

const queued = async () =>
  (
    await env.DB.prepare("SELECT kind, subject_id FROM outbound_messages ORDER BY kind").all<{
      kind: string;
      subject_id: string;
    }>()
  ).results;

const compose = (kind: FollowUpKind, visitId: string) =>
  composeFollowUp(env.DB, { kind, visitId, personId: PERSON, origin: ORIGIN });

beforeEach(async () => {
  await markDatabase();
  const at = NOW.toISOString();
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO technicians (id, fsm_id, name, initials, active, updated_at) VALUES ('t1', 't1', 'Imran Qureshi', 'IQ', 1, ?1)",
    ).bind(at),
    env.DB.prepare(
      "INSERT INTO people (id, created_at, mobile_e164, name) VALUES (?1, ?2, '+919810000001', 'Rohit Malhotra')",
    ).bind(PERSON, at),
    env.DB.prepare(
      `INSERT INTO consents (id, person_id, purpose, notice_version, granted, created_at)
       VALUES ('c1', ?1, 'whatsapp_visits', 'whatsapp-visits-v1', 1, ?2)`,
    ).bind(PERSON, at),
    env.DB.prepare(
      `INSERT INTO services (kind, tier, name, minutes, sort, updated_by, updated_at)
       VALUES ('first_fit', 'essential', 'Mane Man Essential', 120, 1, 'test', ?1)`,
    ).bind(at),
    env.DB.prepare(
      `INSERT INTO hair_profiles (id, person_id, staff, created_at, product, base_width_in, base_length_in, colour,
         grey_percent, density_percent)
       VALUES ('hp-1', ?1, 'ops@localhost', ?2, 'essential', 8, 10, '1B', 20, 100)`,
    ).bind(PERSON, at),
  ]);
});

describe("what follows a visit", () => {
  it("is the recommendation after a consultation, and the care guide after a fit or a replacement, once, from the evening", async () => {
    const consulted = await visit("consultation", "2026-09-21T04:30:00.000Z");
    // A replacement the same day: a first fit after the consultation would be one booked since.
    const fitted = await visit("replacement", "2026-09-21T05:30:00.000Z");
    expect(await queueFollowUps(env.DB, NOW, CHECK_IN_DAYS, HOUR)).toEqual([]);
    expect(await queueFollowUps(env.DB, EVENING, CHECK_IN_DAYS, HOUR)).toHaveLength(2);
    expect(await queueFollowUps(env.DB, EVENING, CHECK_IN_DAYS, HOUR)).toEqual([]);
    expect(await queued()).toEqual([
      { kind: "consultation_follow_up", subject_id: consulted },
      { kind: "fit_aftercare", subject_id: fitted },
    ]);
    expect(await compose("consultation_follow_up", consulted)).toEqual({
      template: "consultation_follow_up_v2",
      params: ["Rohit"],
    });
    expect(await compose("fit_aftercare", fitted)).toEqual({
      template: "fit_aftercare_v1",
      params: ["Rohit", `${ORIGIN}/guides/looking-after-a-hair-system`],
    });
  });

  it("asks how it is on the check-in days ops set after a fit or a replacement", async () => {
    const second = await visit("replacement", "2026-08-31T05:30:00.000Z"); // 21 days before
    const first = await visit("first_fit", "2026-09-19T05:30:00.000Z"); // 2 days before
    await visit("first_fit", "2026-09-18T05:30:00.000Z"); // 3 days before: neither
    await queueFollowUps(env.DB, EVENING, CHECK_IN_DAYS, HOUR);
    expect(await queued()).toEqual([
      { kind: "first_check_in", subject_id: first },
      { kind: "second_check_in", subject_id: second },
    ]);
  });

  it("follows no consultation the client is not going ahead from, nor one with a fit booked since", async () => {
    await visit("consultation", "2026-09-21T04:30:00.000Z", "price");
    await queueFollowUps(env.DB, EVENING, CHECK_IN_DAYS, HOUR);
    expect(await queued()).toEqual([]);
    await env.DB.prepare("DELETE FROM visit_outcomes").run();
    await env.DB.prepare("DELETE FROM appointments").run();
    await visit("consultation", "2026-09-21T04:30:00.000Z");
    await env.DB.prepare(
      `INSERT INTO appointments (id, fsm_id, person_id, type, status, window_start, window_end, technician_id, synced_at)
       VALUES ('fit-next', 'fit-next', ?1, 'first_fit', 'scheduled', '2026-09-25T04:30:00.000Z',
         '2026-09-25T08:30:00.000Z', 't1', ?2)`,
    )
      .bind(PERSON, NOW.toISOString())
      .run();
    await queueFollowUps(env.DB, EVENING, CHECK_IN_DAYS, HOUR);
    expect(await queued()).toEqual([]);
  });

  it("goes only with the client's consent to WhatsApp about visits", async () => {
    const fitted = await visit("first_fit", "2026-09-19T05:30:00.000Z");
    await env.DB.prepare(
      `INSERT INTO consents (id, person_id, purpose, notice_version, granted, created_at)
       VALUES ('c2', ?1, 'whatsapp_visits', 'whatsapp-visits-v1', 0, ?2)`,
    )
      .bind(PERSON, EVENING.toISOString())
      .run();
    expect(await compose("first_check_in", fitted)).toEqual({ skip: "no consent to WhatsApp about visits" });
  });
});
