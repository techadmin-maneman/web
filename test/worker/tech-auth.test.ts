// Logging in to the technician app (src/routes/tech-auth.ts). NOW is Monday
// 21 September 2026, 12 noon in India. Every name and number here is made up.
//
// "A technician is recognised only if FSM lists him as an active field
// technician", and a number FSM does not list gets the same answer as one it
// does, so the screen never says which is which.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import type { App } from "../../src/http/context.ts";
import { takeFromCeiling } from "../../src/domain/ceilings.ts";
import { syncTechnicians } from "../../src/domain/fsm-mirror.ts";
import { buildOpenApiDocument } from "../../src/openapi.ts";
import { createStubFsm, EMPTY_FSM, type FsmTechnician } from "../../src/providers/fsm.ts";
import {
  appFor,
  captureLogs,
  fakeDependencies,
  LOCAL_SETTINGS,
  markDatabase,
  NOW,
  request,
  type TestDependencies,
} from "./helpers.ts";

const IMRAN = "33333333-3333-4333-8333-333333333331";
const RETIRED = "33333333-3333-4333-8333-333333333333";
const TESTER = "33333333-3333-4333-8333-333333333334";
const DEVICE = "phone-abc-123";

let tech: App;
let deps: TestDependencies;

const technician = (overrides: Partial<FsmTechnician> = {}): FsmTechnician => ({
  id: "resource-9",
  userId: "user-9",
  name: "Naveen Rao",
  active: true,
  mobile: "+919810000007",
  zone: "Gurgaon",
  ...overrides,
});

beforeEach(async () => {
  await markDatabase();
  deps = fakeDependencies({ fsm: createStubFsm({ ...EMPTY_FSM, technicians: [technician()] }) });
  tech = appFor("local", deps, {}, "tech");
  await env.DB.prepare(
    `INSERT INTO technicians (id, fsm_id, name, initials, active, zone, mobile_e164, updated_at)
     VALUES (?1, 'resource-1', 'Imran Qureshi', 'IQ', 1, 'Gurgaon', '+919810000009', ?3),
            (?2, 'resource-3', 'Vikram Sethi', 'VS', 0, 'Gurgaon', '+919810000006', ?3)`,
  )
    .bind(IMRAN, RETIRED, NOW.toISOString())
    .run();
});

const post = (path: string, body: unknown) =>
  request(tech, path, {
    method: "POST",
    headers: { Origin: "https://maneman.test", "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

async function challengeFor(mobile: string): Promise<{ id: string; code: string | undefined }> {
  const answer = await post("/api/tech/auth/otp", { mobile, device_id: DEVICE });
  const { challenge_id: id } = await answer.json<{ challenge_id: string }>();
  return { id, code: deps.sentCodes.at(-1)?.code };
}

describe("POST /api/tech/auth/otp", () => {
  it("sends a code to a technician FSM lists as active", async () => {
    const { code } = await challengeFor("98100 00009");

    expect(deps.sentCodes).toHaveLength(1);
    expect(deps.sentCodes[0]).toMatchObject({ channel: "whatsapp", to: "+919810000009" });
    expect(code).toMatch(/^\d{6}$/);
  });

  it("answers the same for a number FSM does not list, and sends nothing", async () => {
    const known = await post("/api/tech/auth/otp", { mobile: "98100 00009", device_id: DEVICE });
    const unknown = await post("/api/tech/auth/otp", { mobile: "98100 00004", device_id: DEVICE });

    expect(unknown.status).toBe(known.status);
    expect(Object.keys(await unknown.json<object>())).toEqual(Object.keys(await known.json<object>()));
    expect(deps.sentCodes.map((sent) => sent.to)).toEqual(["+919810000009"]);
  });

  it("sends nothing to a technician FSM no longer lists as active", async () => {
    await challengeFor("98100 00006");
    expect(deps.sentCodes).toEqual([]);
  });

  // The answer is the same whether or not a code went, so the log is the one place that says which.
  it("says in the log why a number FSM does not list was sent nothing, and never the number", async () => {
    const logs = captureLogs();
    const answer = await post("/api/tech/auth/otp", { mobile: "98100 00004", device_id: DEVICE });

    expect(answer.status).toBe(202);
    expect(deps.sentCodes).toEqual([]);
    expect(logs.lines()).toContainEqual(
      expect.objectContaining({
        event: "login_code_not_sent",
        surface: "tech",
        channel: "whatsapp",
        reason: "no account holds the number",
      }),
    );
    expect(JSON.stringify(logs.lines())).not.toContain("9810000004");
  });

  // Owner ruling, 30 September 2026 ("logins open, reminders fenced", ADR 0025 item 84; ADR 0097): a technician's
  // code answers the phone that just asked for it, so it is never held to staging's allowlist.
  it("sends a code to a technician's number off staging's allowlist", async () => {
    tech = appFor("local", deps, { messaging: { ...LOCAL_SETTINGS.messaging, allowlist: ["+919810000099"] } }, "tech");
    const { code } = await challengeFor("98100 00009");

    expect(deps.sentCodes).toHaveLength(1);
    expect(code).toMatch(/^\d{6}$/);
  });

  // A record one of our own scripts made stays fenced, whatever the ruling above frees (isStagingTestRecord,
  // src/policy/staging-test-records.ts): e2e/tech-staging/seed.ts's invented technician is one of these.
  it("holds back a code to a 'Staging test technician' record off the allowlist", async () => {
    await env.DB.prepare(
      `INSERT INTO technicians (id, fsm_id, name, initials, active, zone, mobile_e164, updated_at, hand_written)
       VALUES ('t-script', 'tech-proof-1', 'Staging test technician', 'ST', 1, 'Gurgaon', '+919810000050', ?1, 1)`,
    )
      .bind(NOW.toISOString())
      .run();
    tech = appFor("local", deps, { messaging: { ...LOCAL_SETTINGS.messaging, allowlist: ["+919810000099"] } }, "tech");
    const logs = captureLogs();

    const answer = await post("/api/tech/auth/otp", { mobile: "98100 00050", device_id: DEVICE });

    expect(answer.status).toBe(202);
    expect(deps.sentCodes).toEqual([]);
    expect(logs.lines()).toContainEqual(
      expect.objectContaining({ event: "login_code_not_sent", reason: "number not on the allowlist" }),
    );
  });

  it("reads FSM again for a number the mirror does not know, so a new technician need not wait", async () => {
    await challengeFor("98100 00007");

    expect(deps.sentCodes).toHaveLength(1);
    const added = await env.DB.prepare("SELECT name, zone FROM technicians WHERE mobile_e164 = '+919810000007'").first<{
      name: string;
      zone: string;
    }>();
    expect(added).toEqual({ name: "Naveen Rao", zone: "Gurgaon" });
  });
});

describe("POST /api/tech/auth/verify", () => {
  it("opens a session bound to the phone", async () => {
    const { id, code } = await challengeFor("98100 00009");

    const answer = await post("/api/tech/auth/verify", { challenge_id: id, code, device_id: DEVICE });

    expect(answer.status).toBe(200);
    expect(await answer.json()).toEqual({ verified: true, first_name: "Imran", device_id: DEVICE });
    expect(answer.headers.get("Set-Cookie")).toMatch(/^mm_tech=[A-Za-z0-9_-]{43}; Max-Age=7776000; Path=\/;/);
    const device = await env.DB.prepare(
      "SELECT technician_id, device_id, label, session_id FROM technician_devices",
    ).first<{ technician_id: string; device_id: string; label: string; session_id: string }>();
    expect(device).toMatchObject({ technician_id: IMRAN, device_id: DEVICE });
    expect(device?.session_id).not.toBeNull();
  });

  it("counts a wrong code, and the fifth voids the challenge", async () => {
    const { id } = await challengeFor("98100 00009");

    for (const left of [4, 3, 2, 1, 0]) {
      const answer = await post("/api/tech/auth/verify", { challenge_id: id, code: "000000", device_id: DEVICE });
      expect(await answer.json()).toEqual({ verified: false, attempts_left: left });
    }
    const dead = await post("/api/tech/auth/verify", { challenge_id: id, code: "000000", device_id: DEVICE });
    expect(dead.status).toBe(410);
  });

  it("opens nothing for a challenge whose number FSM does not list", async () => {
    const { id } = await challengeFor("98100 00004");

    const answer = await post("/api/tech/auth/verify", { challenge_id: id, code: "123456", device_id: DEVICE });

    expect(answer.status).toBe(200);
    expect(await answer.json()).toMatchObject({ verified: false });
    expect(answer.headers.get("Set-Cookie")).toBeNull();
  });

  it("lets a fresh login on the same phone take over, and drops the session it replaces", async () => {
    const first = await challengeFor("98100 00009");
    await post("/api/tech/auth/verify", { challenge_id: first.id, code: first.code, device_id: DEVICE });
    const second = await challengeFor("98100 00009");
    await post("/api/tech/auth/verify", { challenge_id: second.id, code: second.code, device_id: DEVICE });

    const rows = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM sessions WHERE subject_kind = 'technician' AND revoked_at IS NULL",
    ).first<{ n: number }>();
    expect(rows?.n).toBe(1);
    const devices = await env.DB.prepare("SELECT COUNT(*) AS n FROM technician_devices").first<{ n: number }>();
    expect(devices?.n).toBe(1);
  });
});

describe("POST /api/tech/auth/otp, its limits", () => {
  it("refuses a sixth code to one number in a day", async () => {
    for (let sent = 0; sent < 5; sent += 1) {
      expect((await post("/api/tech/auth/otp", { mobile: "98100 00009", device_id: DEVICE })).status).toBe(202);
    }
    const refused = await post("/api/tech/auth/otp", { mobile: "98100 00009", device_id: DEVICE });

    expect(refused.status).toBe(429);
    expect(await refused.json()).toMatchObject({ error: { code: "rate_limited" } });
    expect(deps.sentCodes).toHaveLength(5);
  });

  it("answers busy, and sends nothing, once the technicians' day's ceiling on codes is reached", async () => {
    tech = appFor("local", deps, { login: { ...LOCAL_SETTINGS.login, techCodeDailyCeiling: 1 } }, "tech");
    await post("/api/tech/auth/otp", { mobile: "98100 00009", device_id: DEVICE });

    const refused = await post("/api/tech/auth/otp", { mobile: "98100 00009", device_id: DEVICE });

    expect(refused.status).toBe(503);
    expect(await refused.json()).toMatchObject({ error: { code: "busy" } });
    expect(deps.sentCodes).toHaveLength(1);
    expect(deps.alerts).toEqual([
      'The daily tech_code ceiling (1) is reached; the technician app\'s login codes answer "busy" until midnight IST.',
      `Technician ${IMRAN} was refused a login code: today's 1 technician login codes are spent, so no technician ` +
        "can sign in on a new phone until midnight IST. http://ops.localhost:4323/technicians",
    ]);
  });

  // FLD-27: clients' logins and number changes spent the one ceiling technicians shared, so a technician on a new
  // phone could not start his day.
  it("still sends a technician his code once the client app's ceiling is spent", async () => {
    await takeFromCeiling(env.DB, "login_code", 1, NOW);
    tech = appFor("local", deps, { login: { ...LOCAL_SETTINGS.login, codeDailyCeiling: 1 } }, "tech");

    const answer = await post("/api/tech/auth/otp", { mobile: "98100 00009", device_id: DEVICE });

    expect(answer.status).toBe(202);
    expect(deps.sentCodes.map((sent) => sent.to)).toEqual(["+919810000009"]);
  });

  it("tells ops when an active technician is refused a code, and closes the alert once he is given one", async () => {
    let clock = NOW;
    deps = fakeDependencies({ now: () => clock });
    tech = appFor("local", deps, {}, "tech");
    for (let sent = 0; sent < 6; sent += 1)
      await post("/api/tech/auth/otp", { mobile: "98100 00009", device_id: DEVICE });

    expect(deps.alerts).toEqual([
      `Technician ${IMRAN} was refused a login code: his number has had its 5 codes for today, so he can sign in ` +
        "again after midnight IST. If he did not ask for them all, someone else is asking for codes for his number. " +
        "http://ops.localhost:4323/technicians",
    ]);

    clock = new Date(NOW.getTime() + 24 * 60 * 60_000);
    expect((await post("/api/tech/auth/otp", { mobile: "98100 00009", device_id: DEVICE })).status).toBe(202);
    const open = await env.DB.prepare("SELECT COUNT(*) AS n FROM alerts WHERE resolved_at IS NULL").first();
    expect(open).toEqual({ n: 0 });
  });

  it("tells ops when a technician's network has asked for its codes this hour", async () => {
    // Without FSM, so the numbers nobody knows do not read a list that leaves Imran out.
    tech = appFor("local", deps, {}, "tech", { FSM_PROVIDER: "none" });
    for (let other = 0; other < 10; other += 1) {
      await post("/api/tech/auth/otp", { mobile: `98200 0000${String(other)}`, device_id: DEVICE });
    }

    const refused = await post("/api/tech/auth/otp", { mobile: "98100 00009", device_id: DEVICE });

    expect(refused.status).toBe(429);
    expect(deps.alerts).toEqual([
      `Technician ${IMRAN} was refused a login code: his network has asked for 10 codes this hour. He can sign in ` +
        "on mobile data now, or on this network from the next hour. http://ops.localhost:4323/technicians",
    ]);
  });

  it("tells ops nothing when a number FSM does not list is refused", async () => {
    for (let sent = 0; sent < 6; sent += 1)
      await post("/api/tech/auth/otp", { mobile: "98100 00004", device_id: DEVICE });
    expect(deps.alerts).toEqual([]);
  });

  it("spends none of the day's ceiling on a number FSM does not list", async () => {
    tech = appFor("local", deps, { login: { ...LOCAL_SETTINGS.login, techCodeDailyCeiling: 1 } }, "tech");
    expect((await post("/api/tech/auth/otp", { mobile: "98100 00004", device_id: DEVICE })).status).toBe(202);
    expect((await post("/api/tech/auth/otp", { mobile: "98100 00007", device_id: DEVICE })).status).toBe(202);
    expect(deps.sentCodes.map((sent) => sent.to)).toEqual(["+919810000007"]);
  });

  it("reads FSM's technicians for numbers the mirror does not know at most once in ten minutes", async () => {
    let clock = NOW;
    const listed: FsmTechnician[] = [];
    const fsm = createStubFsm({ ...EMPTY_FSM, technicians: listed });
    let reads = 0;
    deps = fakeDependencies({
      now: () => clock,
      fsm: {
        ...fsm,
        technicians: () => {
          reads += 1;
          return fsm.technicians();
        },
      },
    });
    tech = appFor("local", deps, {}, "tech");

    // Naveen tries before ops have added him in FSM, and again straight after.
    await post("/api/tech/auth/otp", { mobile: "98100 00007", device_id: DEVICE });
    listed.push(technician());
    clock = new Date(NOW.getTime() + 60_000);
    await post("/api/tech/auth/otp", { mobile: "98100 00007", device_id: DEVICE });
    await post("/api/tech/auth/otp", { mobile: "98100 00004", device_id: DEVICE });
    expect(reads).toBe(1);
    expect(deps.sentCodes).toEqual([]);

    clock = new Date(NOW.getTime() + 10 * 60_000);
    await post("/api/tech/auth/otp", { mobile: "98100 00007", device_id: DEVICE });
    expect(reads).toBe(2);
    expect(deps.sentCodes.map((sent) => sent.to)).toEqual(["+919810000007"]);
  });
});

describe("a signed-in phone", () => {
  /** Signs Imran in on the phone and answers the cookie the verify set. */
  async function signIn(): Promise<string> {
    const { id, code } = await challengeFor("98100 00009");
    const answer = await post("/api/tech/auth/verify", { challenge_id: id, code, device_id: DEVICE });
    return (answer.headers.get("Set-Cookie") ?? "").split(";")[0] ?? "";
  }

  const withCookie = (cookie: string, path: string, method = "GET") =>
    request(tech, path, { method, headers: { Cookie: cookie, Origin: "https://maneman.test" } });

  it("names who is signed in, and the phone the session is bound to", async () => {
    const cookie = await signIn();

    const answer = await withCookie(cookie, "/api/tech/me");

    expect(answer.status).toBe(200);
    expect(await answer.json()).toEqual({
      id: IMRAN,
      name: "Imran Qureshi",
      first_name: "Imran",
      initials: "IQ",
      device: { device_id: DEVICE, label: null, enrolled_at: NOW.toISOString() },
    });
  });

  it("ends the session on logout, and the cookie with it", async () => {
    const cookie = await signIn();

    const out = await withCookie(cookie, "/api/tech/auth/logout", "POST");

    expect(out.status).toBe(204);
    expect(out.headers.get("Set-Cookie")).toMatch(/^mm_tech=;/);
    const after = await withCookie(cookie, "/api/tech/me");
    expect(after.status).toBe(401);
    expect(await after.json()).toMatchObject({ error: { code: "session_required" } });
  });

  // TCD-01: the app's browser tests answer as the document says, so the document must say this too.
  it("refuses a logout from a phone with no session, as its documentation says", async () => {
    const answer = await withCookie("", "/api/tech/auth/logout", "POST");

    expect(answer.status).toBe(401);
    expect(await answer.json()).toMatchObject({ error: { code: "session_required" } });
    const documented = buildOpenApiDocument("tech").paths?.["/api/tech/auth/logout"]?.post?.responses ?? {};
    expect(Object.keys(documented)).toContain("401");
  });

  // A technician who has left keeps his phone, and on it the cards of the day:
  // clients' addresses and mobiles. Being inactive in FSM ends his session at once,
  // and says why, so the phone sets aside what it has not sent rather than wipe it.
  it("is signed out on its next call once FSM no longer lists him as active", async () => {
    const cookie = await signIn();
    await env.DB.prepare("UPDATE technicians SET active = 0 WHERE id = ?1").bind(IMRAN).run();

    for (const path of ["/api/tech/me", "/api/tech/jobs"]) {
      const answer = await withCookie(cookie, path);
      expect(answer.status).toBe(401);
      expect(await answer.json()).toMatchObject({ error: { code: "technician_inactive" } });
    }
    const session = await env.DB.prepare("SELECT revoked_at FROM sessions WHERE subject_id = ?1")
      .bind(IMRAN)
      .first<{ revoked_at: string | null }>();
    expect(session?.revoked_at).toBe(NOW.toISOString());
  });
});

describe("the technician list", () => {
  // ADR 0052: "A technician is recognised only if FSM lists him as an active field
  // technician." FSM's list leaves out a user whose service resource was removed.
  it("stops a technician FSM no longer lists at all, once the list is read again, and names him", async () => {
    expect(await syncTechnicians(env.DB, deps.fsm, NOW.toISOString())).toEqual(["resource-1"]);

    const rows = await env.DB.prepare("SELECT fsm_id, active FROM technicians ORDER BY fsm_id").all();
    expect(rows.results).toEqual([
      { fsm_id: "resource-1", active: 0 },
      { fsm_id: "resource-3", active: 0 },
      { fsm_id: "resource-9", active: 1 },
    ]);
    await challengeFor("98100 00009");
    expect(deps.sentCodes).toEqual([]);
  });

  it("logs whom it stopped when a code request for a number it does not know reads the list again", async () => {
    const logs = captureLogs();
    expect((await post("/api/tech/auth/otp", { mobile: "98100 00004", device_id: DEVICE })).status).toBe(202);

    expect(logs.lines()).toContainEqual(
      expect.objectContaining({ event: "technicians_deactivated", count: 1, fsm_ids: ["resource-1"] }),
    );
    const imran = await env.DB.prepare("SELECT active FROM technicians WHERE id = ?1").bind(IMRAN).first();
    expect(imran).toEqual({ active: 0 });
  });

  // The tester's row on staging (scripts/seed-technician-tester.ts) and the staging proof's are written by hand,
  // and FSM's list never names them. Until migration 0046 the list switched each off, and the tester's code
  // request answered 202 and sent nothing.
  it("leaves a technician written by hand alone, and his code still goes", async () => {
    await env.DB.prepare(
      `INSERT INTO technicians (id, fsm_id, name, initials, active, zone, mobile_e164, updated_at, hand_written)
       VALUES (?1, 'tech-tester-1a2b3c4d', 'Test Technician', 'TT', 1, 'Gurgaon', '+919810000008', ?2, 1)`,
    )
      .bind(TESTER, NOW.toISOString())
      .run();

    // A number the mirror does not know reads FSM's list again, which names neither Imran nor the tester.
    await post("/api/tech/auth/otp", { mobile: "98100 00004", device_id: DEVICE });
    const { code } = await challengeFor("98100 00008");

    const tester = await env.DB.prepare("SELECT active FROM technicians WHERE id = ?1").bind(TESTER).first();
    expect(tester).toEqual({ active: 1 });
    expect(deps.sentCodes.map((sent) => sent.to)).toEqual(["+919810000008"]);
    expect(code).toMatch(/^\d{6}$/);
  });

  // The owner signs in on their own FSM user from 27 September 2026 (docs/owner-answers-2026-09-27.md). A test row
  // left behind on the same number must not take the sign-in, whichever was written first.
  it("prefers the technician FSM lists to one written by hand on the same number", async () => {
    await env.DB.batch([
      env.DB.prepare("DELETE FROM technicians WHERE id = ?1").bind(IMRAN),
      env.DB.prepare(
        `INSERT INTO technicians (id, fsm_id, name, initials, active, zone, mobile_e164, updated_at, hand_written)
         VALUES (?1, 'tech-tester-1a2b3c4d', 'Test Technician', 'TT', 1, 'Gurgaon', '+919810000009', ?2, 1)`,
      ).bind(TESTER, NOW.toISOString()),
      env.DB.prepare(
        `INSERT INTO technicians (id, fsm_id, name, initials, active, zone, mobile_e164, updated_at)
         VALUES (?1, 'resource-1', 'Imran Qureshi', 'IQ', 1, 'Gurgaon', '+919810000009', ?2)`,
      ).bind(IMRAN, NOW.toISOString()),
    ]);

    const { id } = await challengeFor("98100 00009");

    const challenge = await env.DB.prepare("SELECT technician_id FROM otp_challenges WHERE id = ?1").bind(id).first();
    expect(challenge).toEqual({ technician_id: IMRAN });
  });

  // FSM writes a user's mobile as "91-9810000007"; the mirror read that as no number, so he could never sign in.
  it("reads a number FSM writes in its own 91- form, and his code goes to it", async () => {
    deps = fakeDependencies({
      fsm: createStubFsm({ ...EMPTY_FSM, technicians: [technician({ mobile: "91-9810000007" })] }),
    });
    tech = appFor("local", deps, {}, "tech");

    await syncTechnicians(env.DB, deps.fsm, NOW.toISOString());
    const naveen = await env.DB.prepare("SELECT mobile_e164 FROM technicians WHERE fsm_id = 'resource-9'").first();
    expect(naveen).toEqual({ mobile_e164: "+919810000007" });

    await challengeFor("+91 98100 00007");
    expect(deps.sentCodes.map((sent) => sent.to)).toEqual(["+919810000007"]);
  });

  it("stops no one when FSM lists no one, which is a failed read rather than an empty org", async () => {
    expect(await syncTechnicians(env.DB, createStubFsm(EMPTY_FSM), NOW.toISOString())).toEqual([]);

    const active = await env.DB.prepare("SELECT COUNT(*) AS n FROM technicians WHERE active = 1").first<{
      n: number;
    }>();
    expect(active?.n).toBe(1);
  });
});

describe("the two logins", () => {
  it("do not read each other's challenges", async () => {
    const { id, code } = await challengeFor("98100 00009");
    const client = appFor("local", deps, {}, "client");

    const answer = await request(client, "/api/auth/verify", {
      method: "POST",
      headers: { Origin: "https://maneman.test", "Content-Type": "application/json" },
      body: JSON.stringify({ challenge_id: id, code }),
    });

    expect(answer.status).toBe(410);
    expect(answer.headers.get("Set-Cookie")).toBeNull();
  });
});
