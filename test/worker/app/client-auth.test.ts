// Logging in to the client app (docs/decisions/0029-sessions.md, 0030-one-time-codes.md),
// against the rules in src/policy/one-time-code.ts. Every number here is made up.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import {
  captureLogs,
  fakeDependencies,
  fakeFetch,
  json,
  LOCAL_SETTINGS,
  markDatabase,
  NOW,
  request,
  TURNSTILE_URL,
} from "../helpers.ts";
import {
  BOOKED,
  UNBOOKED,
  clock,
  useClock,
  deps,
  app,
  useDependencies,
  build,
  later,
  post,
  start,
  verify,
  lastCode,
  wrongCode,
} from "./client-auth-fixtures.ts";

let logs: ReturnType<typeof captureLogs>;

beforeEach(async () => {
  useClock(NOW);
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

describe("a login code that does not go", () => {
  const failing = (detail: string) => {
    useDependencies(
      fakeDependencies({
        now: () => clock,
        codes: { smsAvailable: true, send: () => Promise.resolve({ ok: false, transient: true, detail }) },
      }),
    );
  };

  async function tries(times: number) {
    for (let time = 0; time < times; time += 1) {
      await start("98100 00001");
      later(5 * 60);
    }
  }

  it("is logged, and the third within the hour tells ops once", async () => {
    failing("HTTP 500 INTERNAL_SERVER_ERROR");
    await tries(2);
    expect(deps.alerts).toEqual([]);
    expect(logs.lines()).toContainEqual(expect.objectContaining({ event: "login_code_failed" }));

    await tries(2);
    expect(deps.alerts).toEqual([
      "3 login codes failed to send in the last hour, the latest with HTTP 500 INTERNAL_SERVER_ERROR. Clients " +
        'and technicians cannot sign in. Check the WhatsApp bridge (runbook, "WhatsApp (Evolution) is down").',
    ]);
  });

  it("is forgotten once a code goes through, so the next run of failures is told afresh", async () => {
    failing("HTTP 500 INTERNAL_SERVER_ERROR");
    await tries(3);
    build();
    await tries(1);
    const open = await env.DB.prepare("SELECT COUNT(*) AS n FROM alerts WHERE resolved_at IS NULL").first();
    expect(open).toEqual({ n: 0 });
  });
});

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
    // The log alone says why, once for each, and never with the number.
    const notSent = logs.lines().filter((line) => line.event === "login_code_not_sent");
    expect(notSent).toEqual([
      expect.objectContaining({ surface: "client", channel: "whatsapp", reason: "no account holds the number" }),
      expect.objectContaining({ surface: "client", channel: "whatsapp", reason: "no account holds the number" }),
    ]);
    expect(JSON.stringify(notSent)).not.toMatch(/9810000002|9810000009/);
  });

  it("gives no code to a number whose person was erased", async () => {
    await env.DB.prepare("UPDATE people SET erased_at = ?1 WHERE id = 'p-booked'").bind(NOW.toISOString()).run();
    const { res } = await start("98100 00001");
    expect(res.status).toBe(202);
    expect(deps.sentCodes).toEqual([]);
  });

  // Logins open, reminders fenced (ADR 0097): a login code
  // answers the phone that just asked for it, so it is never held to staging's allowlist, unlike a reminder or
  // another automatic message.
  it("sends a code to a number off staging's allowlist, since a login code answers whoever asked for it", async () => {
    build({ messaging: { ...LOCAL_SETTINGS.messaging, allowlist: ["+919810000099"] } });
    const { res } = await start("98100 00001");
    expect(res.status).toBe(202);
    expect(deps.sentCodes).toEqual([
      { channel: "whatsapp", to: BOOKED, code: expect.stringMatching(/^\d{6}$/) as string },
    ]);
  });

  // A record one of our own scripts made stays fenced, whatever the ruling above frees (isStagingTestRecord,
  // src/policy/staging-test-records.ts).
  it("holds back a code to a 'Staging test' record off the allowlist, unlike an ordinary person's", async () => {
    const TEST_RECORD = "+919810000050";
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO people (id, created_at, mobile_e164, name, contactable, test_record) VALUES ('p-script', ?1, ?2, 'Staging test', 1, 1)",
      ).bind(NOW.toISOString(), TEST_RECORD),
      env.DB.prepare(
        `INSERT INTO leads (id, person_id, created_at, source, city, first_choice_window, loss_extent, proposed_visit_date, request_id)
         VALUES ('l-script', 'p-script', ?1, 'form', 'Gurgaon', 'weekday_pm', 'crown', '2026-09-24', 'r')`,
      ).bind(NOW.toISOString()),
    ]);
    build({ messaging: { ...LOCAL_SETTINGS.messaging, allowlist: ["+919810000099"] } });

    const { res } = await start("98100 00050");

    expect(res.status).toBe(202);
    expect(deps.sentCodes).toEqual([]);
    expect(logs.lines()).toContainEqual(
      expect.objectContaining({ event: "login_code_not_sent", reason: "number not on the allowlist" }),
    );
  });

  // The mark is read from the person, so a record renamed "Staging test" is still a real one.
  it("sends a code to a record named 'Staging test' that was never marked a test record", async () => {
    const RENAMED = "+919810000051";
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO people (id, created_at, mobile_e164, name, contactable) VALUES ('p-renamed', ?1, ?2, 'Staging test', 1)",
      ).bind(NOW.toISOString(), RENAMED),
      env.DB.prepare(
        `INSERT INTO leads (id, person_id, created_at, source, city, first_choice_window, loss_extent, proposed_visit_date, request_id)
         VALUES ('l-renamed', 'p-renamed', ?1, 'form', 'Gurgaon', 'weekday_pm', 'crown', '2026-09-24', 'r')`,
      ).bind(NOW.toISOString()),
    ]);
    build({ messaging: { ...LOCAL_SETTINGS.messaging, allowlist: ["+919810000099"] } });

    expect((await start("98100 00051")).res.status).toBe(202);
    expect(deps.sentCodes).toHaveLength(1);
  });

  it("limits codes per number a day, booked or not, and per address an hour", async () => {
    for (let i = 0; i < 5; i += 1) expect((await start("98100 00009")).res.status).toBe(202);
    expect((await start("98100 00009")).res.status).toBe(429);

    build({ login: { ...LOCAL_SETTINGS.login, codeIpHourlyLimit: 2 } });
    await start("98100 00011");
    await start("98100 00012");
    expect((await start("98100 00013")).res.status).toBe(429);
  });

  it("stops every code at the daily ceiling, for every number alike, and alerts once", async () => {
    build({ login: { ...LOCAL_SETTINGS.login, codeDailyCeiling: 2 } });
    await start("98100 00001");
    await start("98100 00001");
    expect(deps.sentCodes).toHaveLength(2);
    for (const mobile of ["98100 00001", "98100 00002", "98100 00009"]) {
      expect((await start(mobile)).res.status).toBe(503);
    }
    expect(deps.alerts).toEqual([expect.stringContaining("the client app's login codes and number changes") as string]);
  });

  it("counts only codes that are sent against the ceiling, so numbers nobody knows cannot use it up", async () => {
    build({ login: { ...LOCAL_SETTINGS.login, codeDailyCeiling: 1 } });
    for (const mobile of ["98100 00009", "98100 00011", "98100 00002"]) {
      expect((await start(mobile)).res.status).toBe(202);
    }
    expect((await start("98100 00001")).res.status).toBe(202);
    expect(deps.sentCodes.map((sent) => sent.to)).toEqual([BOOKED]);
  });

  // Twenty numbers nobody knows used to lock their address out for the day, an office or a carrier's
  // shared address with it, so one stranger's typos stopped every client there signing in.
  it("keeps answering an address that asks for many numbers nobody knows, and sends its client's code", async () => {
    const address = { "CF-Connecting-IP": "203.0.113.50" };
    for (let unknown = 0; unknown < 40; unknown += 1) {
      if (unknown % 10 === 0) later(3600); // past the address's ten an hour
      expect((await start(`98200 ${String(unknown).padStart(5, "0")}`, address)).res.status).toBe(202);
    }
    later(3600);
    expect((await start("98100 00001", address)).res.status).toBe(202);
    expect(deps.sentCodes.map((sent) => sent.to)).toEqual([BOOKED]);
  });

  it("refuses without Turnstile, and sends nothing", async () => {
    useDependencies(
      fakeDependencies({
        now: () => clock,
        fetch: fakeFetch({ [TURNSTILE_URL]: () => json({ success: false }) }).fetch,
      }),
    );

    const { res, body } = await start("98100 00001");

    expect(res.status).toBe(403);
    expect(body).toMatchObject({ error: { code: "turnstile_failed" } });
    expect(deps.sentCodes).toEqual([]);
    const missing = await post("/api/auth/otp", { mobile: "98100 00001" });
    expect(missing.status).toBe(400);
  });

  it("answers unavailable, and sends nothing, while Turnstile cannot be reached", async () => {
    useDependencies(
      fakeDependencies({
        now: () => clock,
        fetch: fakeFetch({ [TURNSTILE_URL]: () => json({}, 502) }).fetch,
      }),
    );

    const { res, body } = await start("98100 00001");

    expect(res.status).toBe(503);
    expect(body).toMatchObject({ error: { code: "unavailable" } });
    expect(deps.sentCodes).toEqual([]);
  });

  it("refuses a write from another origin, like every client-surface write", async () => {
    const res = await request(app, "/api/auth/otp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mobile: "98100 00001", turnstile_token: "token" }),
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
