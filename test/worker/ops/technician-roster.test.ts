// Ops add, change, switch off and switch back on the technicians themselves (src/routes/ops/technicians.ts).
// NOW is Monday 21 September 2026, 12 noon in India. Every name and number here is made up.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import type { Surface } from "../../../src/config/environments.ts";
import type { App } from "../../../src/http/context.ts";
import { openTechnicianSession } from "../../../src/domain/dispatch/technicians.ts";
import { appFor, captureLogs, fakeDependencies, markDatabase, NOW, request } from "../helpers.ts";
import type { TestDependencies } from "../helpers.ts";

const IMRAN = "33333333-3333-4333-8333-333333333331";
const SAMEER = "33333333-3333-4333-8333-333333333332";
const PERSON = "11111111-1111-4111-8111-111111111111";
const DEVICE = "phone-abc-123";
const AT = NOW.toISOString();

/** Imran's visits: two still to come, one begun, one from last week, and one of Sameer's. */
const THIS_AFTERNOON = "44444444-4444-4444-8444-444444444441";
const NEXT_WEEK = "44444444-4444-4444-8444-444444444442";
const BEGUN = "44444444-4444-4444-8444-444444444443";
const LAST_WEEK = "44444444-4444-4444-8444-444444444444";
const SAMEERS = "44444444-4444-4444-8444-444444444445";

let deps: TestDependencies;

function appIn(surface: Surface): App {
  return appFor("local", deps, {}, surface);
}

function send(app: App, method: string, path: string, body?: unknown, cookie = "") {
  return request(app, path, {
    method,
    headers: { Origin: "https://maneman.test", "Content-Type": "application/json", Cookie: cookie },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

const one = (sql: string, ...values: unknown[]) =>
  env.DB.prepare(sql)
    .bind(...values)
    .first();

async function visit(id: string, options: { start: string; technician?: string; status?: string }) {
  await env.DB.prepare(
    `INSERT INTO appointments (id, fsm_id, person_id, type, status, window_start, window_end, technician_id,
       service_city, service_pincode, synced_at)
     VALUES (?1, ?1, ?2, 'service', ?3, ?4, ?5, ?6, 'Gurgaon', '122018', ?7)`,
  )
    .bind(
      id,
      PERSON,
      options.status ?? "scheduled",
      options.start,
      new Date(Date.parse(options.start) + 90 * 60_000).toISOString(),
      options.technician ?? IMRAN,
      AT,
    )
    .run();
}

/** The phone's check-in for a visit, landed: the visit has begun, whatever its status says. */
async function checkedIn(appointmentId: string) {
  await env.DB.prepare(
    `INSERT INTO job_events (id, appointment_id, event_id, technician_id, kind, body, occurred_at, received_at,
       fsm_write_state, superseded, updated_at)
     VALUES (?1, ?2, 'event-check-in-01', ?3, 'check_in', '{}', ?4, ?4, 'written', 0, ?4)`,
  )
    .bind(crypto.randomUUID(), appointmentId, IMRAN, AT)
    .run();
}

async function signedIn(technicianId: string): Promise<string> {
  const token = await openTechnicianSession(env.DB, { technicianId, deviceId: DEVICE, label: null, now: NOW });
  return `mm_tech=${token}`;
}

/** Signs in on the technician app by number, as a phone does: a code, then the code back. */
async function signInBy(tech: App, mobile: string): Promise<Response> {
  const asked = await send(tech, "POST", "/api/tech/auth/otp", { mobile, device_id: DEVICE });
  const { challenge_id: challengeId } = await asked.json<{ challenge_id: string }>();
  const code = deps.sentCodes.at(-1)?.code ?? "000000";
  return send(tech, "POST", "/api/tech/auth/verify", { challenge_id: challengeId, code, device_id: DEVICE });
}

const cookieOf = (answer: Response) => (answer.headers.get("Set-Cookie") ?? "").split(";")[0] ?? "";

const auditOf = (action: string) =>
  env.DB.prepare("SELECT subject_kind, subject_id, detail FROM audit_log WHERE action = ?1").bind(action).all();

beforeEach(async () => {
  await markDatabase();
  captureLogs();
  deps = fakeDependencies();
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO technicians (id, fsm_id, name, initials, active, zone, mobile_e164, updated_at)
       VALUES (?1, ?1, 'Imran Qureshi', 'IQ', 1, 'Sec 40–65', '+919810000009', ?3),
              (?2, ?2, 'Sameer Bhatt', 'SB', 1, 'Sec 1–39', '+919810000008', ?3)`,
    ).bind(IMRAN, SAMEER, AT),
    env.DB.prepare(
      "INSERT INTO people (id, created_at, mobile_e164, name) VALUES (?1, ?2, '+919810000001', 'Rohit Malhotra')",
    ).bind(PERSON, AT),
  ]);
});

describe("adding a technician", () => {
  let ops: App;
  beforeEach(() => {
    ops = appIn("ops");
  });

  it("adds him under an ID of our own, and his number signs in at once", async () => {
    const answer = await send(ops, "POST", "/api/technicians", {
      name: "Naveen Rao",
      mobile: "98100 00007",
      zone: "Sec 66–80",
    });

    expect(answer.status).toBe(201);
    const { id } = await answer.json<{ id: string }>();
    expect(await one("SELECT * FROM technicians WHERE id = ?1", id)).toMatchObject({
      fsm_id: id,
      name: "Naveen Rao",
      initials: "NR",
      active: 1,
      zone: "Sec 66–80",
      mobile_e164: "+919810000007",
      hand_written: 1,
    });
    const audit = await auditOf("technician.add");
    expect(audit.results).toEqual([{ subject_kind: "technician", subject_id: id, detail: null }]);

    const tech = appIn("tech");
    const verified = await signInBy(tech, "9810000007");
    expect(await verified.json()).toMatchObject({ verified: true, first_name: "Naveen" });
    const me = await send(tech, "GET", "/api/tech/me", undefined, cookieOf(verified));
    expect(await me.json()).toMatchObject({ id, name: "Naveen Rao" });
  });

  it("refuses a number another active technician signs in with, and adds no one", async () => {
    const answer = await send(ops, "POST", "/api/technicians", { name: "Naveen Rao", mobile: "+91 98100 00009" });

    expect(answer.status).toBe(409);
    expect(await answer.json()).toMatchObject({ error: { code: "number_in_use" } });
    expect(await one("SELECT COUNT(*) AS technicians FROM technicians")).toEqual({ technicians: 2 });
  });

  it("gives the number of a technician who was switched off to the one added", async () => {
    await env.DB.prepare("UPDATE technicians SET active = 0 WHERE id = ?1").bind(SAMEER).run();

    const answer = await send(ops, "POST", "/api/technicians", { name: "Naveen Rao", mobile: "9810000008" });

    expect(answer.status).toBe(201);
  });

  it("gives him one of our cities, and refuses a city that is not one", async () => {
    const answer = await send(ops, "POST", "/api/technicians", {
      name: "Naveen Rao",
      mobile: "9810000007",
      city: "Gurgaon",
    });
    const unknown = await send(ops, "POST", "/api/technicians", {
      name: "Vikram Seth",
      mobile: "9810000006",
      city: "Atlantis",
    });

    const { id } = await answer.json<{ id: string }>();
    expect(await one("SELECT city FROM technicians WHERE id = ?1", id)).toEqual({ city: "Gurgaon" });
    expect(unknown.status).toBe(400);
    expect(await unknown.json()).toMatchObject({ error: { code: "invalid_request", fields: ["city"] } });
    expect(await one("SELECT COUNT(*) AS technicians FROM technicians")).toEqual({ technicians: 3 });
  });

  it("refuses a number that is not an Indian mobile, and a name of nothing but spaces", async () => {
    const badNumber = await send(ops, "POST", "/api/technicians", { name: "Naveen Rao", mobile: "12345" });
    const noName = await send(ops, "POST", "/api/technicians", { name: "   ", mobile: "9810000007" });

    expect(badNumber.status).toBe(400);
    expect(noName.status).toBe(400);
  });
});

describe("changing a technician", () => {
  it("changes his name, number and zone, and his initials with his name", async () => {
    const ops = appIn("ops");

    const answer = await send(ops, "PATCH", `/api/technicians/${IMRAN}`, {
      name: "Imran Ali Qureshi",
      mobile: "9810000006",
      zone: null,
    });

    expect(answer.status).toBe(200);
    expect(await one("SELECT name, initials, mobile_e164, zone FROM technicians WHERE id = ?1", IMRAN)).toEqual({
      name: "Imran Ali Qureshi",
      initials: "IQ",
      mobile_e164: "+919810000006",
      zone: null,
    });
    const audit = await auditOf("technician.change");
    expect(audit.results).toEqual([
      { subject_kind: "technician", subject_id: IMRAN, detail: JSON.stringify({ fields: "name,mobile,zone" }) },
    ]);
  });

  it("changes only what was sent", async () => {
    const ops = appIn("ops");

    expect((await send(ops, "PATCH", `/api/technicians/${IMRAN}`, { zone: "Sec 1–39" })).status).toBe(200);

    expect(await one("SELECT name, mobile_e164, zone FROM technicians WHERE id = ?1", IMRAN)).toEqual({
      name: "Imran Qureshi",
      mobile_e164: "+919810000009",
      zone: "Sec 1–39",
    });
  });

  it("refuses the number another active technician holds, and changes nothing", async () => {
    const ops = appIn("ops");

    const answer = await send(ops, "PATCH", `/api/technicians/${IMRAN}`, { name: "Imran Ali", mobile: "9810000008" });

    expect(answer.status).toBe(409);
    expect(await answer.json()).toMatchObject({ error: { code: "number_in_use" } });
    expect(await one("SELECT name, mobile_e164 FROM technicians WHERE id = ?1", IMRAN)).toEqual({
      name: "Imran Qureshi",
      mobile_e164: "+919810000009",
    });
  });

  it("sets his city, takes it away, and refuses a city that is not one of ours", async () => {
    const ops = appIn("ops");

    const set = await send(ops, "PATCH", `/api/technicians/${IMRAN}`, { city: "Noida" });
    const cityOf = () => one("SELECT city, zone FROM technicians WHERE id = ?1", IMRAN);
    expect(set.status).toBe(200);
    expect(await cityOf()).toEqual({ city: "Noida", zone: "Sec 40–65" });

    const unknown = await send(ops, "PATCH", `/api/technicians/${IMRAN}`, { city: "Atlantis" });
    expect(unknown.status).toBe(400);
    expect(await cityOf()).toEqual({ city: "Noida", zone: "Sec 40–65" });

    expect((await send(ops, "PATCH", `/api/technicians/${IMRAN}`, { city: null })).status).toBe(200);
    expect(await cityOf()).toEqual({ city: null, zone: "Sec 40–65" });
    const audit = await auditOf("technician.change");
    expect(audit.results.map((entry) => entry.detail)).toEqual([
      JSON.stringify({ fields: "city" }),
      JSON.stringify({ fields: "city" }),
    ]);
  });

  it("answers not found for a technician there is no record of, and refuses an empty change", async () => {
    const ops = appIn("ops");

    const unknown = await send(ops, "PATCH", "/api/technicians/33333333-3333-4333-8333-333333333399", { zone: "X" });
    const empty = await send(ops, "PATCH", `/api/technicians/${IMRAN}`, {});

    expect(unknown.status).toBe(404);
    expect(empty.status).toBe(400);
  });

  // FSM's sync writes over a technician FSM made, so a change made here would not last the night.
});

describe("switching a technician off", () => {
  beforeEach(async () => {
    await visit(THIS_AFTERNOON, { start: "2026-09-21T09:30:00.000Z" });
    await visit(NEXT_WEEK, { start: "2026-09-28T04:30:00.000Z" });
    await visit(BEGUN, { start: "2026-09-21T04:30:00.000Z" });
    await checkedIn(BEGUN);
    await visit(LAST_WEEK, { start: "2026-09-14T04:30:00.000Z" });
    await visit(SAMEERS, { start: "2026-09-22T04:30:00.000Z", technician: SAMEER });
  });

  it("signs him out at once, and his phone hears that he was switched off, not that its session ran out", async () => {
    const ops = appIn("ops");
    const tech = appIn("tech");
    const cookie = await signedIn(IMRAN);

    const answer = await send(ops, "POST", `/api/technicians/${IMRAN}/deactivate`);

    expect(answer.status).toBe(200);
    expect(await one("SELECT active FROM technicians WHERE id = ?1", IMRAN)).toEqual({ active: 0 });
    expect(await one("SELECT revoked_at FROM sessions WHERE subject_id = ?1", IMRAN)).toEqual({ revoked_at: AT });
    // The phone is not revoked: what it has not sent is kept for him, should he be switched back on.
    expect(await one("SELECT revoked_at FROM technician_devices WHERE technician_id = ?1", IMRAN)).toEqual({
      revoked_at: null,
    });
    const me = await send(tech, "GET", "/api/tech/me", undefined, cookie);
    expect(me.status).toBe(401);
    expect(await me.json()).toMatchObject({ error: { code: "technician_inactive" } });
    expect(me.headers.get("Set-Cookie")).toMatch(/^__Host-mm_tech=;/);

    await signInBy(tech, "9810000009");
    expect(deps.sentCodes).toEqual([]);
  });

  it("gives his visits still to come back as unassigned, and leaves begun, past and others' visits", async () => {
    const ops = appIn("ops");

    const answer = await send(ops, "POST", `/api/technicians/${IMRAN}/deactivate`);

    expect(await answer.json()).toEqual({
      visits: [
        {
          appointment_id: THIS_AFTERNOON,
          starts_at: "2026-09-21T09:30:00.000Z",
          type: "service",
          client: "Rohit Malhotra",
        },
        { appointment_id: NEXT_WEEK, starts_at: "2026-09-28T04:30:00.000Z", type: "service", client: "Rohit Malhotra" },
      ],
    });
    const technicians = await env.DB.prepare("SELECT id, technician_id FROM appointments ORDER BY window_start").all();
    expect(technicians.results).toEqual([
      { id: LAST_WEEK, technician_id: IMRAN },
      { id: BEGUN, technician_id: IMRAN },
      { id: THIS_AFTERNOON, technician_id: null },
      { id: SAMEERS, technician_id: SAMEER },
      { id: NEXT_WEEK, technician_id: null },
    ]);
    const audit = await auditOf("technician.deactivate");
    expect(audit.results).toEqual([
      { subject_kind: "technician", subject_id: IMRAN, detail: JSON.stringify({ visits_unassigned: 2 }) },
    ]);
  });

  it("puts those visits in the dispatch board's tray, and takes his row off the board", async () => {
    const ops = appIn("ops");
    await send(ops, "POST", `/api/technicians/${IMRAN}/deactivate`);

    const board = await (
      await send(ops, "GET", "/api/dispatch?from=2026-09-21")
    ).json<{
      technicians: { technician_id: string }[];
      unassigned: { appointment_id: string; was_technician: unknown }[];
    }>();

    expect(board.technicians.map((row) => row.technician_id)).toEqual([SAMEER]);
    expect(board.unassigned).toContainEqual(expect.objectContaining({ appointment_id: THIS_AFTERNOON }));
  });

  it("answers the same, and changes nothing more, when he is switched off twice", async () => {
    const ops = appIn("ops");
    await send(ops, "POST", `/api/technicians/${IMRAN}/deactivate`);

    const again = await send(ops, "POST", `/api/technicians/${IMRAN}/deactivate`);

    expect(again.status).toBe(200);
    expect(await again.json()).toEqual({ visits: [] });
    expect((await auditOf("technician.deactivate")).results).toHaveLength(1);
  });

  it("answers not found for a technician there is no record of", async () => {
    const ops = appIn("ops");
    const answer = await send(ops, "POST", "/api/technicians/33333333-3333-4333-8333-333333333399/deactivate");
    expect(answer.status).toBe(404);
  });
});

describe("switching a technician back on", () => {
  it("lets him sign in again on his number", async () => {
    const ops = appIn("ops");
    const tech = appIn("tech");
    await send(ops, "POST", `/api/technicians/${IMRAN}/deactivate`);

    const answer = await send(ops, "POST", `/api/technicians/${IMRAN}/reactivate`);

    expect(answer.status).toBe(200);
    expect(await one("SELECT active FROM technicians WHERE id = ?1", IMRAN)).toEqual({ active: 1 });
    expect(await (await signInBy(tech, "9810000009")).json()).toMatchObject({ verified: true });
    expect((await auditOf("technician.reactivate")).results).toHaveLength(1);
  });

  it("refuses while another active technician has his number", async () => {
    const ops = appIn("ops");
    await send(ops, "POST", `/api/technicians/${IMRAN}/deactivate`);
    await send(ops, "POST", "/api/technicians", { name: "Naveen Rao", mobile: "9810000009" });

    const answer = await send(ops, "POST", `/api/technicians/${IMRAN}/reactivate`);

    expect(answer.status).toBe(409);
    expect(await answer.json()).toMatchObject({ error: { code: "number_in_use" } });
    expect(await one("SELECT active FROM technicians WHERE id = ?1", IMRAN)).toEqual({ active: 0 });
  });
});

describe("the roster", () => {
  interface Technician {
    id: string;
    name: string;
    zone: string | null;
    city: string | null;
    mobile: string | null;
  }
  interface Roster {
    technicians: Technician[];
    switched_off: Technician[];
    cities: string[];
  }

  const roster = async () => (await send(appIn("ops"), "GET", "/api/technicians")).json<Roster>();

  it("lists the switched-off technicians apart, with each one's number", async () => {
    await env.DB.prepare("UPDATE technicians SET active = 0 WHERE id = ?1").bind(SAMEER).run();

    const body = await roster();

    expect(body.technicians).toEqual([expect.objectContaining({ id: IMRAN, mobile: "+919810000009" })]);
    expect(body.switched_off).toEqual([
      { id: SAMEER, name: "Sameer Bhatt", zone: "Sec 1–39", city: null, mobile: "+919810000008" },
    ]);
  });

  it("says each technician's city, and the cities one may be given", async () => {
    await env.DB.prepare("UPDATE technicians SET city = 'Gurgaon' WHERE id = ?1").bind(IMRAN).run();

    const body = await roster();

    expect(body.technicians.map(({ id, city }) => ({ id, city }))).toEqual([
      { id: IMRAN, city: "Gurgaon" },
      { id: SAMEER, city: null },
    ]);
    expect(body.cities).toEqual(["Gurgaon", "Delhi", "Noida", "Faridabad", "Ghaziabad", "Mumbai", "Bengaluru"]);
  });
});

describe("the dispatch board", () => {
  // A visit can still be on a technician who was switched off: one booked onto him a moment before. It is nobody's job, so it waits in the tray, saying whose it was.
  it("puts a visit still on a switched-off technician in the tray, and lets ops give it to another", async () => {
    await visit(NEXT_WEEK, { start: "2026-09-22T04:30:00.000Z" });
    await env.DB.prepare("UPDATE technicians SET active = 0 WHERE id = ?1").bind(IMRAN).run();
    const ops = appIn("ops");

    const board = await (
      await send(ops, "GET", "/api/dispatch?from=2026-09-21")
    ).json<{
      unassigned: { appointment_id: string; was_technician: unknown }[];
    }>();
    expect(board.unassigned).toEqual([
      expect.objectContaining({
        appointment_id: NEXT_WEEK,
        was_technician: { id: IMRAN, name: "Imran Qureshi" },
      }),
    ]);

    const assigned = await send(ops, "POST", "/api/dispatch/assign", {
      appointment_id: NEXT_WEEK,
      technician_id: SAMEER,
      date: "2026-09-22",
      window: "morning",
      reason: "technician_unavailable",
      expected_technician_id: IMRAN,
      expected_starts_at: "2026-09-22T04:30:00.000Z",
    });
    expect(assigned.status).toBe(200);
    expect(await one("SELECT technician_id FROM appointments WHERE id = ?1", NEXT_WEEK)).toEqual({
      technician_id: SAMEER,
    });
  });
});
