// Logging in to the client app (docs/decisions/0029-sessions.md, 0030-one-time-codes.md),
// against the rules in src/policy/one-time-code.ts. Every number here is made up.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import type { App } from "../../src/app.ts";
import type { Settings } from "../../src/config/settings.ts";
import { erasePerson } from "../../src/domain/erasure.ts";
import { sha256Hex } from "../../src/lib/hash.ts";
import { RULES } from "../../src/policy/one-time-code.ts";
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

const ORIGIN = "https://maneman.test"; // the host helpers.request() uses
const BOOKED = "+919810000001";
const UNBOOKED = "+919810000002";

let clock: Date;
let deps: TestDependencies;
let app: App;
let logs: ReturnType<typeof captureLogs>;

function build(overrides: Partial<Settings> = {}, smsAvailable = true): void {
  deps = fakeDependencies({ now: () => clock });
  if (!smsAvailable) deps = { ...deps, codes: { ...deps.codes, smsAvailable: false } };
  app = appFor("local", deps, overrides, "client");
}

beforeEach(async () => {
  clock = NOW;
  logs = captureLogs();
  build();
  await markDatabase();
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO people (id, created_at, mobile_e164, name, contactable) VALUES ('p-booked', ?1, ?2, 'Arjun Mehta', 1)",
    ).bind(NOW.toISOString(), BOOKED),
    env.DB.prepare(
      `INSERT INTO leads (id, person_id, created_at, source, city, first_choice_window, loss_extent, proposed_visit_date, request_id)
       VALUES ('l-booked', 'p-booked', ?1, 'form', 'Gurgaon', 'weekday_pm', 'crown', '2026-09-24', 'r')`,
    ).bind(NOW.toISOString()),
    // A try-on claim is a lead, but not a booking.
    env.DB.prepare(
      "INSERT INTO people (id, created_at, mobile_e164, name, contactable) VALUES ('p-tryon', ?1, ?2, 'Vikram', 1)",
    ).bind(NOW.toISOString(), UNBOOKED),
    env.DB.prepare(
      `INSERT INTO leads (id, person_id, created_at, source, loss_extent, request_id)
       VALUES ('l-tryon', 'p-tryon', ?1, 'tryon', 'crown', 'r')`,
    ).bind(NOW.toISOString()),
  ]);
});

const later = (seconds: number) => {
  clock = new Date(clock.getTime() + seconds * 1000);
};

function post(path: string, body: unknown, headers: Record<string, string> = {}) {
  return request(app, path, {
    method: "POST",
    headers: { Origin: ORIGIN, "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

async function start(mobile: string) {
  const res = await post("/api/auth/otp", { mobile });
  return { res, body: await res.json<Record<string, unknown> & { challenge_id: string }>() };
}

const verify = (challengeId: string, code: string) => post("/api/auth/verify", { challenge_id: challengeId, code });
const lastCode = () => deps.sentCodes.at(-1)?.code ?? "";
const wrongCode = (right: string) => (right === "000000" ? "111111" : "000000");

/** Logs in, and returns the mm_app cookie as a Cookie header value. */
async function loggedIn(): Promise<string> {
  const { body } = await start("98100 00001");
  const res = await verify(body.challenge_id, lastCode());
  const cookie = /mm_app=([^;]+)/.exec(res.headers.get("Set-Cookie") ?? "")?.[1];
  if (cookie === undefined) throw new Error("no session cookie");
  return `mm_app=${cookie}`;
}

describe("POST /api/auth/otp", () => {
  it("sends a six-digit code on WhatsApp to a number with a booking", async () => {
    const { res, body } = await start("98100 00001");

    expect(res.status).toBe(202);
    expect(body).toEqual({
      challenge_id: expect.any(String) as string,
      channel: "whatsapp",
      expires_in_s: 600,
      resend_in_s: 30,
      sms_in_s: 30,
    });
    expect(deps.sentCodes).toEqual([
      { channel: "whatsapp", to: BOOKED, code: expect.stringMatching(/^\d{6}$/) as string },
    ]);
  });

  it("answers a number with no booking exactly as it answers one with, and sends nothing", async () => {
    const booked = await start("98100 00001");
    const unbooked = await start("98100 00002");
    const nobody = await start("98100 00009");

    for (const { res, body } of [unbooked, nobody]) {
      expect(res.status).toBe(booked.res.status);
      expect({ ...body, challenge_id: "" }).toEqual({ ...booked.body, challenge_id: "" });
    }
    expect(deps.sentCodes.map((sent) => sent.to)).toEqual([BOOKED]);
  });

  it("gives no code to a number whose person was erased", async () => {
    await env.DB.prepare("UPDATE people SET erased_at = ?1 WHERE id = 'p-booked'").bind(NOW.toISOString()).run();
    const { res } = await start("98100 00001");
    expect(res.status).toBe(202);
    expect(deps.sentCodes).toEqual([]);
  });

  it("on staging, sends codes only to the allowlisted handsets, and answers the same for the rest", async () => {
    build({ messaging: { ...LOCAL_SETTINGS.messaging, allowlist: ["+919810000099"] } });
    const { res } = await start("98100 00001");
    expect(res.status).toBe(202);
    expect(deps.sentCodes).toEqual([]);
    expect(logs.lines()).toContainEqual(expect.objectContaining({ event: "login_code_skipped" }));
  });

  it("limits codes per number a day, booked or not, and per address an hour", async () => {
    for (let i = 0; i < 5; i += 1) expect((await start("98100 00009")).res.status).toBe(202);
    expect((await start("98100 00009")).res.status).toBe(429);

    build({ login: { ...LOCAL_SETTINGS.login, codeIpHourlyLimit: 2 } });
    await start("98100 00011");
    await start("98100 00012");
    expect((await start("98100 00013")).res.status).toBe(429);
  });

  it("stops every code at the daily ceiling, and alerts once", async () => {
    build({ login: { ...LOCAL_SETTINGS.login, codeDailyCeiling: 2 } });
    await start("98100 00001");
    await start("98100 00009");
    expect((await start("98100 00001")).res.status).toBe(503);
    expect((await start("98100 00002")).res.status).toBe(503);
    expect(deps.alerts).toEqual([expect.stringContaining("client app login codes") as string]);
  });

  it("refuses a write from another origin, like every client-surface write", async () => {
    const res = await request(app, "/api/auth/otp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mobile: "98100 00001" }),
    });
    expect(res.status).toBe(403);
    expect(deps.sentCodes).toEqual([]);
  });

  it("never logs a code or a number", async () => {
    const { body } = await start("98100 00001");
    await verify(body.challenge_id, wrongCode(lastCode()));
    await verify(body.challenge_id, lastCode());

    const logged = JSON.stringify(logs.lines());
    expect(logged).toContain("login_code_sent");
    expect(logged).not.toContain(`"${lastCode()}"`); // as a value; a request ID may hold the same digits by chance
    expect(logged).not.toContain("9810000001");
  });
});

describe("POST /api/auth/verify", () => {
  it(RULES[0], async () => {
    const { body } = await start("98100 00001");
    const res = await verify(body.challenge_id, lastCode());

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ verified: true, first_name: "Arjun" });
    const cookie = res.headers.get("Set-Cookie") ?? "";
    expect(cookie).toMatch(/^mm_app=[A-Za-z0-9_-]{43}; Max-Age=7776000; Path=\/; HttpOnly; Secure; SameSite=Lax$/);
    const token = /mm_app=([^;]+)/.exec(cookie)?.[1] ?? "";
    const stored = await env.DB.prepare("SELECT subject_kind, subject_id FROM sessions WHERE id = ?1")
      .bind(await sha256Hex(token))
      .first();
    expect(stored).toEqual({ subject_kind: "client", subject_id: "p-booked" });
  });

  it("takes each code once", async () => {
    const { body } = await start("98100 00001");
    const code = lastCode();
    expect((await verify(body.challenge_id, code)).status).toBe(200);
    expect((await verify(body.challenge_id, code)).status).toBe(410);
  });

  it(RULES[2], async () => {
    const { body } = await start("98100 00001");
    const right = lastCode();
    for (const left of [4, 3, 2, 1, 0]) {
      expect(await (await verify(body.challenge_id, wrongCode(right))).json()).toEqual({
        verified: false,
        attempts_left: left,
      });
    }
    expect((await verify(body.challenge_id, right)).status).toBe(410);
  });

  it("counts wrong codes the same on a challenge that sent nothing", async () => {
    const { body } = await start("98100 00009");
    for (const left of [4, 3, 2, 1, 0]) {
      expect(await (await verify(body.challenge_id, "123456")).json()).toEqual({
        verified: false,
        attempts_left: left,
      });
    }
    expect((await verify(body.challenge_id, "123456")).status).toBe(410);
  });

  it("refuses a code after its ten minutes", async () => {
    const { body } = await start("98100 00001");
    later(601);
    expect((await verify(body.challenge_id, lastCode())).status).toBe(410);
  });
});

describe("sending the code again", () => {
  it(RULES[3], async () => {
    const { body } = await start("98100 00001");
    const first = lastCode();
    later(29);
    const early = await post("/api/auth/otp/resend", { challenge_id: body.challenge_id });
    expect(early.status).toBe(429);
    expect(await early.json()).toMatchObject({ error: { code: "too_early" } });

    later(1);
    const res = await post("/api/auth/otp/resend", { challenge_id: body.challenge_id });
    expect(res.status).toBe(202);
    expect(await res.json()).toMatchObject({ channel: "whatsapp", resend_in_s: 30, sms_in_s: 0 });
    expect(deps.sentCodes).toHaveLength(2);
    if (lastCode() !== first)
      expect(await (await verify(body.challenge_id, first)).json()).toMatchObject({ verified: false });
    expect((await verify(body.challenge_id, lastCode())).status).toBe(200);
  });

  it(RULES[1], async () => {
    const { body } = await start("98100 00001");
    later(20);
    expect((await post("/api/auth/otp/sms", { challenge_id: body.challenge_id })).status).toBe(429);
    later(10);
    const res = await post("/api/auth/otp/sms", { challenge_id: body.challenge_id });
    expect(res.status).toBe(202);
    expect(await res.json()).toMatchObject({ channel: "sms" });
    expect(deps.sentCodes.at(-1)).toMatchObject({ channel: "sms", to: BOOKED });
    expect((await verify(body.challenge_id, lastCode())).status).toBe(200);
  });

  it("keeps the count of wrong codes, so asking again gains a guesser nothing", async () => {
    const { body } = await start("98100 00001");
    for (let i = 0; i < 4; i += 1) await verify(body.challenge_id, wrongCode(lastCode()));
    later(30);
    await post("/api/auth/otp/resend", { challenge_id: body.challenge_id });
    expect(await (await verify(body.challenge_id, wrongCode(lastCode()))).json()).toEqual({
      verified: false,
      attempts_left: 0,
    });
  });

  it("sends at most five codes on one challenge", async () => {
    const { body } = await start("98100 00001");
    for (let i = 0; i < 4; i += 1) {
      later(30);
      expect((await post("/api/auth/otp/resend", { challenge_id: body.challenge_id })).status).toBe(202);
    }
    later(30);
    expect((await post("/api/auth/otp/resend", { challenge_id: body.challenge_id })).status).toBe(429);
    expect(deps.sentCodes).toHaveLength(5);
  });

  it("offers no SMS while there is no SMS provider", async () => {
    build({}, false);
    const { body } = await start("98100 00001");
    expect(body.sms_in_s).toBeNull();
    later(30);
    expect((await post("/api/auth/otp/sms", { challenge_id: body.challenge_id })).status).toBe(404);
  });

  it("refuses to resend on a closed challenge", async () => {
    const { body } = await start("98100 00001");
    await verify(body.challenge_id, lastCode());
    later(30);
    expect((await post("/api/auth/otp/resend", { challenge_id: body.challenge_id })).status).toBe(410);
  });
});

describe("the session", () => {
  it("opens GET /api/me: a lead with their consultation", async () => {
    const cookie = await loggedIn();
    const res = await request(app, "/api/me", { headers: { Cookie: cookie } });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      state: "lead",
      name: "Arjun Mehta",
      first_name: "Arjun",
      initials: "AM",
      consultation: { date: "2026-09-24", window_label: "after four", place: "Gurgaon" },
      next_visit: null,
      credits: null,
      prompt: null,
    });
  });

  it("is required for GET /api/me", async () => {
    const res = await request(app, "/api/me");
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ error: { code: "session_required" } });
    expect((await request(app, "/api/me", { headers: { Cookie: "mm_app=made-up" } })).status).toBe(401);
  });

  it("slides: each use moves its 90 days on, at most hourly", async () => {
    const cookie = await loggedIn();
    later(30 * 60);
    expect((await request(app, "/api/me", { headers: { Cookie: cookie } })).headers.get("Set-Cookie")).toBeNull();
    later(31 * 60);
    const res = await request(app, "/api/me", { headers: { Cookie: cookie } });
    expect(res.headers.get("Set-Cookie")).toMatch(/^mm_app=.*Max-Age=7776000/);
    const row = await env.DB.prepare("SELECT expires_at FROM sessions").first<string>("expires_at");
    expect(row).toBe(new Date(clock.getTime() + 90 * 24 * 60 * 60 * 1000).toISOString());
  });

  it("ends 90 days after its last use", async () => {
    const cookie = await loggedIn();
    later(90 * 24 * 60 * 60 + 1);
    expect((await request(app, "/api/me", { headers: { Cookie: cookie } })).status).toBe(401);
  });

  it("ends at logout, and the cookie goes with it", async () => {
    const cookie = await loggedIn();
    const res = await post("/api/auth/logout", {}, { Cookie: cookie });

    expect(res.status).toBe(204);
    expect(res.headers.get("Set-Cookie")).toMatch(/^mm_app=; Max-Age=0; Path=\/; Secure/);
    expect((await request(app, "/api/me", { headers: { Cookie: cookie } })).status).toBe(401);
    expect(await env.DB.prepare("SELECT revoked_at FROM sessions").first("revoked_at")).not.toBeNull();
  });

  it("ends, with every open code, when the person is erased", async () => {
    const cookie = await loggedIn();
    const { body } = await start("98100 00001");
    await erasePerson(env, BOOKED, clock);

    expect((await request(app, "/api/me", { headers: { Cookie: cookie } })).status).toBe(401);
    expect((await verify(body.challenge_id, lastCode())).status).toBe(410);
  });

  it("names the device from its browser, without keeping the full User-Agent", async () => {
    const { body } = await start("98100 00001");
    await verify(body.challenge_id, lastCode());
    const android = await start("98100 00001");
    await post(
      "/api/auth/verify",
      { challenge_id: android.body.challenge_id, code: lastCode() },
      { "User-Agent": "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/129.0 Mobile Safari/537.36" },
    );
    const labels = await env.DB.prepare("SELECT device_label FROM sessions ORDER BY created_at").all();
    expect(labels.results.map((row) => row.device_label)).toContain("Chrome on Android");
  });
});
