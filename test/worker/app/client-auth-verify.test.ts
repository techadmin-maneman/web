// Logging in to the client app (docs/decisions/0029-sessions.md, 0030-one-time-codes.md),
// against the rules in src/policy/one-time-code.ts. Every number here is made up.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { sha256Hex } from "../../../src/lib/hash.ts";
import { captureLogs, LOCAL_SETTINGS, markDatabase, NOW } from "../helpers.ts";
import {
  BOOKED,
  UNBOOKED,
  useClock,
  deps,
  build,
  later,
  post,
  start,
  verify,
  lastCode,
  wrongCode,
} from "./client-auth-fixtures.ts";

beforeEach(async () => {
  useClock(NOW);
  captureLogs();
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

const resend = (challengeId: string, headers: Record<string, string> = {}) =>
  post("/api/auth/otp/resend", { challenge_id: challengeId }, headers);

describe("POST /api/auth/verify", () => {
  it("signs in with the six-digit code, and keeps the session for 90 days", async () => {
    const { body } = await start("98100 00001");
    const res = await verify(body.challenge_id, lastCode());

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ verified: true, first_name: "Arjun" });
    const cookie = res.headers.get("Set-Cookie") ?? "";
    expect(cookie).toMatch(
      /^__Host-mm_app=[A-Za-z0-9_-]{43}; Max-Age=7776000; Path=\/; HttpOnly; Secure; SameSite=Lax$/,
    );
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

  it("voids the code after five wrong attempts", async () => {
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
  it("refuses a resend inside 30 seconds, and sends a new code after", async () => {
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

  it("offers SMS after 30 seconds, and the code it sends signs in", async () => {
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

  it("sends at most three codes on one challenge", async () => {
    const { body } = await start("98100 00001");
    for (let i = 0; i < 2; i += 1) {
      later(30);
      expect((await resend(body.challenge_id)).status).toBe(202);
    }
    later(30);
    expect((await resend(body.challenge_id)).status).toBe(429);
    expect(deps.sentCodes).toHaveLength(3);
  });

  /**
   * The answers to two challenges for one number, each sent as often as it may be, then a third challenge; from an
   * address of its own, so only the number's day is spent.
   */
  async function spendTheDay(mobile: string, ip: string): Promise<number[]> {
    const address = { "CF-Connecting-IP": ip };
    const statuses: number[] = [];
    for (let challenge = 0; challenge < 2; challenge += 1) {
      const { res, body } = await start(mobile, address);
      statuses.push(res.status);
      for (let again = 0; again < 2; again += 1) {
        later(31);
        statuses.push((await resend(body.challenge_id, address)).status);
      }
    }
    statuses.push((await start(mobile, address)).res.status);
    return statuses;
  }

  // Resends skipped the number's day, so five challenges of five sends put 25 codes on one number a day.
  it("counts every code sent again against the number's day, so a number gets five codes a day at most", async () => {
    expect(await spendTheDay("98100 00001", "203.0.113.60")).toEqual([202, 202, 202, 202, 202, 429, 429]);
    expect(deps.sentCodes).toHaveLength(5);
  });

  it("answers a number nobody knows exactly as it answers a client's, code for code", async () => {
    const client = await spendTheDay("98100 00001", "203.0.113.60");
    const nobody = await spendTheDay("98100 00009", "203.0.113.61");
    expect(nobody).toEqual(client);
    expect(deps.sentCodes.map((sent) => sent.to)).toEqual(Array<string>(5).fill(BOOKED));
  });

  it("counts every code sent again against the address's hour", async () => {
    build({ login: { ...LOCAL_SETTINGS.login, codeIpHourlyLimit: 2 } });
    const { body } = await start("98100 00001");
    later(30);
    expect((await resend(body.challenge_id)).status).toBe(202);
    later(30);
    const refused = await resend(body.challenge_id);
    expect(refused.status).toBe(429);
    expect(await refused.json()).toMatchObject({ error: { code: "rate_limited" } });
    expect(deps.sentCodes).toHaveLength(2);
  });

  it("starts again on a challenge made before its number was kept", async () => {
    const { body } = await start("98100 00001");
    await env.DB.prepare("UPDATE otp_challenges SET mobile_hash = NULL").run();
    later(30);
    expect((await resend(body.challenge_id)).status).toBe(410);
    expect(deps.sentCodes).toHaveLength(1);
  });

  it("keeps the number only as the limits key it", async () => {
    await start("98100 00001");
    await start("98100 00009");
    const kept = await env.DB.prepare("SELECT mobile_hash FROM otp_challenges").all<{ mobile_hash: string }>();
    expect(kept.results.map((row) => row.mobile_hash)).toEqual([
      expect.stringMatching(/^[0-9a-f]{64}$/) as string,
      expect.stringMatching(/^[0-9a-f]{64}$/) as string,
    ]);
    expect(JSON.stringify(kept.results)).not.toMatch(/9810000001|9810000009/);
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
