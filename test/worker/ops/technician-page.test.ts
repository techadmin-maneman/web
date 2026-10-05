// What a technician's own page in the console reads: his leave still to end, each with the jobs still booked on it,
// and whether each of his phones is still signed in. NOW is Monday 21 September 2026, 12 noon in India. Every name
// and number here is made up.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { openTechnicianSession } from "../../../src/domain/technicians.ts";
import { revokeSession } from "../../../src/domain/sessions.ts";
import type { App } from "../../../src/http/context.ts";
import { sha256Hex } from "../../../src/lib/hash.ts";
import { appFor, captureLogs, fakeDependencies, markDatabase, NOW, request } from "../helpers.ts";
import { enforce, listStaff, opsAs, person } from "./staff-fixtures.ts";

const IMRAN = "33333333-3333-4333-8333-333333333331";
const SAMEER = "33333333-3333-4333-8333-333333333332";
const NOBODY = "33333333-3333-4333-8333-333333333339";
const PERSON = "11111111-1111-4111-8111-111111111111";
const AT = NOW.toISOString();

/** Imran's visits on the days ahead, at 10 am in India, and one from last Saturday never closed. */
const TUESDAY_JOB = "44444444-4444-4444-8444-444444444441";
const WEDNESDAY_JOB = "44444444-4444-4444-8444-444444444442";
const THURSDAY_JOB = "44444444-4444-4444-8444-444444444443";
const SATURDAY_JOB = "44444444-4444-4444-8444-444444444444";

interface JobOnLeave {
  readonly appointment_id: string;
  readonly starts_at: string;
  readonly client: string | null;
}

interface StandingLeave {
  readonly leave: { id: string; from: string; to: string; note: string | null; jobs: JobOnLeave[] }[];
}

interface Roster {
  readonly technicians: { id: string; devices: { device_id: string; signed_in: boolean }[] }[];
}

let ops: App;

const send = (method: string, path: string, body?: unknown) =>
  request(ops, path, {
    method,
    headers: { Origin: "https://maneman.test", "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

const leaveOf = async (technicianId: string): Promise<StandingLeave> =>
  (await send("GET", `/api/technicians/${technicianId}/leave`)).json<StandingLeave>();

const recordLeave = async (from: string, to: string, note?: string): Promise<string> => {
  const answer = await send("POST", `/api/technicians/${IMRAN}/leave`, {
    from,
    to,
    ...(note === undefined ? {} : { note }),
  });
  return (await answer.json<{ id: string }>()).id;
};

async function visit(id: string, start: string) {
  await env.DB.prepare(
    `INSERT INTO appointments (id, fsm_id, person_id, type, status, fsm_status, window_start, window_end,
       technician_id, service_city, service_pincode, fsm_modified_at, synced_at)
     VALUES (?1, ?1, ?2, 'service', 'scheduled', 'Scheduled', ?3, ?4, ?5, 'Gurgaon', '122018', ?6, ?6)`,
  )
    .bind(id, PERSON, start, new Date(Date.parse(start) + 90 * 60_000).toISOString(), IMRAN, AT)
    .run();
}

beforeEach(async () => {
  await markDatabase();
  captureLogs();
  ops = appFor("local", fakeDependencies(), {}, "ops");
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO technicians (id, fsm_id, name, initials, active, zone, city, mobile_e164, updated_at)
       VALUES (?1, 'resource-1', 'Imran Qureshi', 'IQ', 1, 'Sec 40–65', 'Gurgaon', '+919810000009', ?3),
              (?2, 'resource-2', 'Sameer Bhatt', 'SB', 1, 'Sec 1–39', 'Gurgaon', '+919810000008', ?3)`,
    ).bind(IMRAN, SAMEER, AT),
    env.DB.prepare(
      "INSERT INTO people (id, created_at, mobile_e164, name) VALUES (?1, ?2, '+919810000001', 'Rohit Malhotra')",
    ).bind(PERSON, AT),
  ]);
  await visit(TUESDAY_JOB, "2026-09-22T04:30:00.000Z");
  await visit(WEDNESDAY_JOB, "2026-09-23T04:30:00.000Z");
  await visit(THURSDAY_JOB, "2026-09-24T04:30:00.000Z");
  await visit(SATURDAY_JOB, "2026-09-19T04:30:00.000Z");
});

describe("a technician's leave, as his page reads it", () => {
  // Reopened after one of three jobs had been moved, the panel showed the leave and not the two jobs still on it.
  it("lists the jobs still booked on a leave each time it is read, not only when it was recorded", async () => {
    const id = await recordLeave("2026-09-22", "2026-09-24", "Family wedding");
    await env.DB.prepare("UPDATE appointments SET technician_id = ?2 WHERE id = ?1").bind(WEDNESDAY_JOB, SAMEER).run();

    const { leave } = await leaveOf(IMRAN);

    expect(leave).toEqual([
      {
        id,
        from: "2026-09-22",
        to: "2026-09-24",
        note: "Family wedding",
        jobs: [
          expect.objectContaining({ appointment_id: TUESDAY_JOB, client: "Rohit Malhotra" }),
          expect.objectContaining({ appointment_id: THURSDAY_JOB, client: "Rohit Malhotra" }),
        ],
      },
    ]);
  });

  it("lists only leave still to end, soonest first, and none that was taken back", async () => {
    await recordLeave("2026-09-15", "2026-09-18");
    const later = await recordLeave("2026-10-05", "2026-10-06");
    const sooner = await recordLeave("2026-09-28", "2026-09-28");
    const takenBack = await recordLeave("2026-09-30", "2026-09-30");
    await send("POST", `/api/technicians/${IMRAN}/leave/${takenBack}/cancel`);

    const { leave } = await leaveOf(IMRAN);

    expect(leave.map((period) => period.id)).toEqual([sooner, later]);
    expect(leave.every((period) => period.jobs.length === 0)).toBe(true);
  });

  it("counts a leave under way from today, leaving out a job on a day already gone", async () => {
    await recordLeave("2026-09-19", "2026-09-22");

    const { leave } = await leaveOf(IMRAN);

    expect(leave[0]?.jobs.map((job) => job.appointment_id)).toEqual([TUESDAY_JOB]);
  });

  it("answers not found for a technician nobody has added", async () => {
    const answer = await send("GET", `/api/technicians/${NOBODY}/leave`);
    expect(answer.status).toBe(404);
  });

  it("keeps to the caller's cities once the Staff list is enforced", async () => {
    await recordLeave("2026-09-22", "2026-09-22");
    await enforce();
    await listStaff("delhi@maneman.in", ["operations:view:city:Delhi"]);
    await listStaff("gurgaon@maneman.in", ["operations:view:city:Gurgaon"]);

    const delhi = await request(opsAs(person("delhi@maneman.in")), `/api/technicians/${IMRAN}/leave`);
    const gurgaon = await request(opsAs(person("gurgaon@maneman.in")), `/api/technicians/${IMRAN}/leave`);

    expect(delhi.status).toBe(404);
    expect(gurgaon.status).toBe(200);
    expect((await gurgaon.json<StandingLeave>()).leave).toHaveLength(1);
  });
});

describe("a technician's phones, as the roster reads them", () => {
  const DAY_MS = 86_400_000;

  async function signIn(deviceId: string, at: Date = NOW): Promise<string> {
    return openTechnicianSession(env.DB, { technicianId: IMRAN, deviceId, label: null, now: at });
  }

  it("says which phone is still signed in, and reads one signed out, run out or revoked as not", async () => {
    await signIn("phone-live");
    const signedOut = await signIn("phone-signed-out");
    await revokeSession(env.DB, await sha256Hex(signedOut), NOW);
    await signIn("phone-run-out", new Date(NOW.getTime() - 91 * DAY_MS));
    await signIn("phone-revoked");
    await send("POST", `/api/technicians/${IMRAN}/devices/phone-revoked/revoke`);

    const roster = await (await send("GET", "/api/technicians")).json<Roster>();
    const phones = roster.technicians.find((technician) => technician.id === IMRAN)?.devices ?? [];
    const signedIn = Object.fromEntries(phones.map((phone) => [phone.device_id, phone.signed_in]));

    expect(signedIn).toEqual({
      "phone-live": true,
      "phone-signed-out": false,
      "phone-run-out": false,
      "phone-revoked": false,
    });
  });
});
