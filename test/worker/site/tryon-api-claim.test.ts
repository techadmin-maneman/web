import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { mobileHashOf } from "../../../src/domain/clients/number-codes.ts";
import { LOCAL_SETTINGS, NOW, captureLogs, markDatabase, provedNumberCode } from "../helpers.ts";
import { insertPerson } from "../tryon-fixtures.ts";
import { visitor, jobRow, count, setState } from "./tryon-api-fixtures.ts";

beforeEach(async () => {
  await markDatabase();
  captureLogs();
});

describe("POST /api/tryon/claim, before the look is made", () => {
  it("captures the lead once the photograph is uploaded, before any render, and opens no session", async () => {
    const browser = visitor();
    const jobId = await browser.uploaded();

    const response = await browser.claim(jobId, "98100 00001", {}, { stage: "advanced" });
    expect(response.status).toBe(201);
    const body = await response.json<{ lead_id: string }>();
    expect(Object.keys(body)).toEqual(["lead_id"]);
    expect(response.headers.get("Set-Cookie")).toBeNull();

    const lead = await env.DB.prepare("SELECT source, city, first_choice_window, loss_extent FROM leads WHERE id = ?")
      .bind(body.lead_id)
      .first();
    expect(lead).toEqual({ source: "tryon", city: null, first_choice_window: null, loss_extent: "advanced" });
    const person = await env.DB.prepare("SELECT mobile_e164, contactable FROM people").first();
    expect(person).toEqual({ mobile_e164: "+919810000001", contactable: 0 }); // a try-on alone is not contact consent
    const consents = await env.DB.prepare(
      "SELECT purpose, notice_version, created_at, source FROM consents ORDER BY purpose",
    ).all();
    expect(consents.results).toEqual([
      { purpose: "result_delivery", notice_version: "gate-v4", created_at: NOW.toISOString(), source: "try_on" },
      { purpose: "tryon_photo", notice_version: "photo-v4", created_at: NOW.toISOString(), source: "try_on" },
    ]);
    // The job keeps the claim's stage, which its render is made for.
    expect(await jobRow(jobId)).toMatchObject({
      state: "awaiting_upload",
      stage: "advanced",
      lead_id: body.lead_id,
      claimed_at: NOW.toISOString(),
      session_id: null,
      number_proved_at: NOW.toISOString(),
    });
    // The look's message waits for the render the claim comes before.
    const message = await env.DB.prepare("SELECT kind, state, subject_id FROM outbound_messages").first();
    expect(message).toEqual({ kind: "tryon_result", state: "waiting", subject_id: jobId });
    expect(await count("tryon_sessions")).toBe(0);
    expect(browser.queues.CRM_QUEUE.sent).toEqual([
      { lead_id: body.lead_id, request_id: expect.any(String) as string },
    ]);
    expect(browser.queues.MESSAGE_QUEUE.sent).toEqual([]);
  });

  it("refuses a job whose photograph has not arrived, or whose render was asked for already", async () => {
    const browser = visitor();
    const link = await (await browser.uploadLink()).json<{ job_id: string }>();
    expect(await (await browser.claim(link.job_id)).json()).toMatchObject({ error: { code: "job_not_claimable" } });

    const failed = await browser.uploaded();
    await setState(failed, "failed");
    expect((await browser.claim(failed)).status).toBe(409);
    expect((await browser.claim(crypto.randomUUID())).status).toBe(404);
    expect((await browser.claim(failed, "12345")).status).toBe(400);
    expect(await count("leads")).toBe(0);
  });

  // The gate's earlier notices said the result opens on the next screen, or that the photograph is kept thirty days.
  it("records the gate's current notice, and refuses any other", async () => {
    const browser = visitor();
    const jobId = await browser.uploaded();
    for (const version of ["gate-v1", "gate-v2", "gate-v3", "photo-v4"]) {
      const refused = await browser.claim(jobId, "98100 00001", {}, { notice_version: version });
      expect(refused.status).toBe(400);
      expect(await refused.json()).toMatchObject({ error: { code: "invalid_request", fields: ["notice_version"] } });
    }
    expect((await browser.claim(jobId, "98100 00001", {}, { notice_version: "gate-v4" })).status).toBe(201);
    const consents = await env.DB.prepare("SELECT purpose, notice_version FROM consents ORDER BY purpose").all();
    expect(consents.results).toEqual([
      { purpose: "result_delivery", notice_version: "gate-v4" },
      { purpose: "tryon_photo", notice_version: "photo-v4" },
    ]);
  });

  // The gate wrote a person, their consents and a lead for any number typed, and sent its look there.
  it("refuses a number no code proved in the last 30 minutes, writing nothing", async () => {
    const browser = visitor();
    const jobId = await browser.uploaded();
    const notProved = async (body: Record<string, unknown>) => {
      const refused = await browser.claim(jobId, "98100 00001", {}, body);
      expect(refused.status).toBe(403);
      expect(await refused.json()).toMatchObject({ error: { code: "number_not_proved" } });
    };

    await notProved({ number_code_id: crypto.randomUUID() });
    await notProved({ number_code_id: await provedNumberCode("+919810000002") });
    await notProved({ number_code_id: await provedNumberCode("+919810000001", new Date(NOW.getTime() - 31 * 60_000)) });
    // Sent to the number, and never entered.
    const notEntered = crypto.randomUUID();
    await env.DB.prepare(
      "INSERT INTO number_codes (id, created_at, mobile_hash, code_hash, expires_at) VALUES (?1, ?2, ?3, 'sent', ?4)",
    )
      .bind(
        notEntered,
        NOW.toISOString(),
        await mobileHashOf(LOCAL_SETTINGS.ipHashSalt, "+919810000001"),
        new Date(NOW.getTime() + 10 * 60_000).toISOString(),
      )
      .run();
    await notProved({ number_code_id: notEntered });
    const missing = await browser.post("/api/tryon/claim", {
      job_id: jobId,
      name: "Arjun Mehta",
      mobile: "98100 00001",
      stage: "crown",
    });
    expect(missing.status).toBe(400);

    for (const table of ["people", "consents", "leads", "outbound_messages"]) expect(await count(table)).toBe(0);
    expect((await jobRow(jobId))?.claimed_at).toBeNull();
  });

  it("asks for the stage the visitor chose", async () => {
    const browser = visitor();
    const jobId = await browser.uploaded();
    const refused = await browser.post("/api/tryon/claim", {
      job_id: jobId,
      name: "Arjun Mehta",
      mobile: "98100 00001",
    });
    expect(refused.status).toBe(400);
  });

  // ADR 0104: a try-on whose look could not be sent does not run, so nothing of the claim is written.
  it("refuses while WhatsApp cannot send the look, writing nothing", async () => {
    const jobId = await visitor().uploaded();
    const refused = await visitor({ messaging: { enabled: false } }).claim(jobId);
    expect(refused.status).toBe(503);
    expect(await refused.json()).toMatchObject({ error: { code: "whatsapp_unavailable" } });
    for (const table of ["people", "consents", "leads", "outbound_messages"]) expect(await count(table)).toBe(0);
    expect((await jobRow(jobId))?.claimed_at).toBeNull();
  });

  // Logins open, reminders fenced (ADR 0097): the look answers
  // the person who just claimed it, so it reaches any number, allowlisted or not.
  it("takes any number off the allowlist, since the look answers the person who just claimed it", async () => {
    const browser = visitor({ messaging: { allowlist: ["+919810000002"] } });
    const jobId = await browser.uploaded();
    expect((await browser.claim(jobId, "98100 00001")).status).toBe(201);
  });

  // A record one of our own scripts made stays fenced (isStagingTestRecord, src/policy/staging-test-records.ts), and
  // its look would be held back, so its try-on does not run off the allowlist.
  it("refuses a 'Staging test' claim off the allowlist, and takes one on it", async () => {
    const browser = visitor({ messaging: { allowlist: ["+919810000002"] } });
    const jobId = await browser.uploaded();
    // Two test records our scripts made: the mark is stored on the person, never read from the name typed here.
    for (const [id, mobile] of [
      ["p-test-1", "+919810000001"],
      ["p-test-2", "+919810000002"],
    ] as const) {
      await env.DB.prepare(
        "INSERT INTO people (id, created_at, mobile_e164, name, contactable, test_record) VALUES (?1, ?2, ?3, 'Staging test', 0, 1)",
      )
        .bind(id, new Date().toISOString(), mobile)
        .run();
    }
    const asStagingTest = async (mobile: string) =>
      browser.post("/api/tryon/claim", {
        job_id: jobId,
        name: "Staging test",
        mobile,
        stage: "crown",
        ...(await browser.proofOf(mobile)),
      });
    expect(await (await asStagingTest("98100 00001")).json()).toMatchObject({
      error: { code: "whatsapp_unavailable" },
    });
    expect((await asStagingTest("98100 00002")).status).toBe(201);
  });

  it("refuses a number that has had its looks sent today, as the messaging queue would skip a fourth", async () => {
    const browser = visitor({ tryon: { resultMessageMobileDailyLimit: 0 } });
    const jobId = await browser.uploaded();
    const refused = await browser.claim(jobId);
    expect(refused.status).toBe(429);
    expect(await refused.json()).toMatchObject({ error: { code: "rate_limited" } });
    expect(await count("leads")).toBe(0);
  });

  it("keeps a person who booked before contactable", async () => {
    await insertPerson("p", "+919810000001");
    await env.DB.prepare("UPDATE people SET contactable = 1").run();
    await visitor().claimed();
    expect(await env.DB.prepare("SELECT contactable FROM people").first()).toEqual({ contactable: 1 });
  });

  it("is never renamed by the gate", async () => {
    await insertPerson("p-known", "+919810000001", "Karan Bhatia");
    const browser = visitor();
    const jobId = await browser.uploaded();

    const response = await browser.claim(jobId, "98100 00001", {}, { name: "Somebody Else" });
    expect(response.status).toBe(201);
    const { lead_id: leadId } = await response.json<{ lead_id: string }>();
    expect(await env.DB.prepare("SELECT id, name FROM people").all()).toMatchObject({
      results: [{ id: "p-known", name: "Karan Bhatia" }],
    });
    expect(await env.DB.prepare("SELECT person_id FROM leads WHERE id = ?").bind(leadId).first()).toEqual({
      person_id: "p-known",
    });
  });

  it("replays an idempotent claim with the same lead", async () => {
    const browser = visitor();
    const jobId = await browser.uploaded();
    const first = await (await browser.claim(jobId, "98100 00001", { "Idempotency-Key": "claim-key-1" })).json();

    const replay = await browser.claim(jobId, "98100 00001", { "Idempotency-Key": "claim-key-1" });
    expect(replay.status).toBe(201);
    expect(await replay.json()).toEqual(first);
    expect(await count("leads")).toBe(1);
  });

  it("gives the same number its lead again, after its render too, and refuses another number", async () => {
    const browser = visitor();
    const jobId = await browser.uploaded();
    const first = await (await browser.claim(jobId)).json<{ lead_id: string }>();
    await browser.generate(jobId);

    const again = await browser.claim(jobId);
    expect(again.status).toBe(201);
    expect(await again.json()).toEqual(first);
    const stranger = await visitor().claim(jobId, "98100 00002");
    expect(stranger.status).toBe(409);
    expect(await count("leads")).toBe(1);
    expect(await count("outbound_messages")).toBe(1);
  });

  it("limits claims per number per day", async () => {
    const browser = visitor({ tryon: { claimMobileDailyLimit: 1 } });
    const first = await browser.uploaded();
    const second = await browser.uploaded();
    expect((await browser.claim(first)).status).toBe(201);
    expect((await browser.claim(second)).status).toBe(429);
  });

  // "One per number, every 30 days" (LOOK_PER_NUMBER_DAYS).
  it("refuses a number that had a look in the last thirty days, but not for a look never made or failed", async () => {
    const browser = visitor({ tryon: { claimMobileDailyLimit: 10 } });
    const made = await browser.uploaded();
    expect((await browser.claim(made)).status).toBe(201);
    // Claimed, but its render never asked for: no look yet.
    expect((await browser.claim(await browser.uploaded())).status).toBe(201);

    await setState(made, "queued");
    const refused = await browser.claim(await browser.uploaded());
    expect(refused.status).toBe(403);
    expect(await refused.json()).toMatchObject({ error: { code: "look_limit_reached" } });

    await setState(made, "failed");
    expect((await browser.claim(await browser.uploaded())).status).toBe(201);

    await env.DB.prepare(
      "UPDATE tryon_jobs SET state = 'ready', claimed_at = strftime('%Y-%m-%dT%H:%M:%fZ', claimed_at, '-31 days') WHERE id = ?",
    )
      .bind(made)
      .run();
    expect((await browser.claim(await browser.uploaded())).status).toBe(201);
  });
});
