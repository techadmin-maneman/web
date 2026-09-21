import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { erasePerson } from "../../src/domain/erasure.ts";
import { secretsMatch } from "../../src/lib/hash.ts";
import { LOCAL_SETTINGS, NOW, appFor, captureLogs, fakeQueue, markDatabase, request } from "./helpers.ts";
import { insertJob, syntheticJpeg, syntheticPng } from "./tryon-fixtures.ts";

const MOBILE = "9810000001";
const MOBILE_E164 = "+919810000001";
const AUTHORIZED = { Authorization: `Bearer ${LOCAL_SETTINGS.erasureSecret}` };

async function book(mobile = MOBILE): Promise<string> {
  const response = await request(
    appFor(),
    "/api/lead",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Arjun Mehta",
        mobile,
        city: "Gurgaon",
        first_choice_window: "weekday_am",
        loss_extent: "crown",
        consent: true,
        turnstile_token: "token",
      }),
    },
    { CRM_QUEUE: fakeQueue() },
  );
  expect(response.status).toBe(201);
  // The booking form takes no e-mail; set one to show that it is blanked too.
  const person = await env.DB.prepare(
    "UPDATE people SET email = 'arjun@example.com' WHERE mobile_e164 = ? RETURNING id",
  )
    .bind(MOBILE_E164)
    .first<{ id: string }>();
  return person?.id ?? "";
}

/** A person with a booking, three try-ons in different states, messages, a session and a try-on consent. */
async function personWithHistory(): Promise<string> {
  const personId = await book();
  await insertJob({ id: "ready", person_id: personId, state: "ready", result_key: "results/ready.png" });
  await insertJob({ id: "running", person_id: personId, state: "rendering" });
  await insertJob({ id: "failed", person_id: personId, state: "failed", upload_deleted_at: NOW.toISOString() });
  await env.UPLOADS.put("uploads/ready", syntheticJpeg(800, 800));
  await env.UPLOADS.put("uploads/running", syntheticJpeg(800, 800));
  await env.RESULTS.put("results/ready.png", syntheticPng(512, 512));

  const at = NOW.toISOString();
  await env.DB.batch([
    ...["waiting", "queued", "sent"].map((state) =>
      env.DB.prepare(
        `INSERT INTO outbound_messages (id, created_at, person_id, kind, subject_id, state)
         VALUES (?, ?, ?, 'tryon_result', 'ready', ?)`,
      ).bind(`message-${state}`, at, personId, state),
    ),
    env.DB.prepare("INSERT INTO tryon_sessions (id, person_id, created_at, expires_at) VALUES ('s', ?, ?, ?)").bind(
      personId,
      at,
      at,
    ),
    env.DB.prepare(
      `INSERT INTO consents (id, person_id, purpose, notice_version, granted, created_at)
       VALUES ('c-tryon', ?, 'result_delivery', 'gate-v1', 1, ?)`,
    ).bind(personId, at),
  ]);
  return personId;
}

function erase(body: unknown, headers: Record<string, string> = AUTHORIZED, queue = fakeQueue()) {
  return request(
    appFor(),
    "/api/erasure",
    { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) },
    { CRM_QUEUE: queue },
  );
}

let logs: ReturnType<typeof captureLogs>;
beforeEach(async () => {
  await markDatabase();
  logs = captureLogs();
});

describe("POST /api/erasure", () => {
  it("deletes the photos and results, blanks the person, cancels unsent messages and queues the CRM", async () => {
    const personId = await personWithHistory();
    const crmQueue = fakeQueue();

    const response = await erase({ mobile: "98100 00001" }, AUTHORIZED, crmQueue);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      person_id: personId,
      erased_at: NOW.toISOString(),
      photos_deleted: 2,
      results_deleted: 1,
      messages_cancelled: 2,
      crm: "queued",
    });
    expect(crmQueue.sent).toEqual([{ erase_person_id: personId, request_id: expect.any(String) as string }]);

    expect(await env.UPLOADS.head("uploads/ready")).toBeNull();
    expect(await env.UPLOADS.head("uploads/running")).toBeNull();
    expect(await env.RESULTS.head("results/ready.png")).toBeNull();

    expect(await env.DB.prepare("SELECT * FROM people WHERE id = ?").bind(personId).first()).toMatchObject({
      name: "Erased",
      email: null,
      mobile_e164: `erased:${personId}`,
      contactable: 0,
      erased_at: NOW.toISOString(),
    });
    const jobs = await env.DB.prepare(
      "SELECT id, state, result_key, upload_deleted_at FROM tryon_jobs WHERE person_id = ? ORDER BY id",
    )
      .bind(personId)
      .all();
    expect(jobs.results).toEqual([
      { id: "failed", state: "failed", result_key: null, upload_deleted_at: NOW.toISOString() },
      { id: "ready", state: "expired", result_key: null, upload_deleted_at: NOW.toISOString() },
      { id: "running", state: "expired", result_key: null, upload_deleted_at: NOW.toISOString() },
    ]);

    const messages = await env.DB.prepare("SELECT id, state FROM outbound_messages ORDER BY id").all();
    expect(messages.results).toEqual([
      { id: "message-queued", state: "skipped" },
      { id: "message-sent", state: "sent" },
      { id: "message-waiting", state: "skipped" },
    ]);
    const sessions = await env.DB.prepare("SELECT COUNT(*) AS n FROM tryon_sessions WHERE person_id = ?")
      .bind(personId)
      .first<{ n: number }>();
    expect(sessions?.n).toBe(0);

    const withdrawals = await env.DB.prepare(
      "SELECT purpose FROM consents WHERE person_id = ? AND notice_version = 'withdrawal' AND granted = 0 ORDER BY purpose",
    )
      .bind(personId)
      .all<{ purpose: string }>();
    expect(withdrawals.results.map((row) => row.purpose)).toEqual(["contact", "result_delivery"]);
    const event = await env.DB.prepare(
      "SELECT payload_json FROM events WHERE name = 'person_erased' AND subject_id = ?",
    )
      .bind(personId)
      .first<{ payload_json: string }>();
    expect(JSON.parse(event?.payload_json ?? "{}")).toEqual({ photos: 2, results: 1 });
  });

  it("never writes the person's name, number or e-mail to the logs", async () => {
    await personWithHistory();
    await erase({ mobile: MOBILE });
    const written = JSON.stringify(logs.lines());
    expect(written).toContain("person_erased");
    for (const secret of ["Arjun", "9810000001", "arjun@example.com"]) expect(written).not.toContain(secret);
  });

  it("answers 404 for a number it does not know, including one already erased", async () => {
    expect((await erase({ mobile: MOBILE })).status).toBe(404);
    await book();
    expect((await erase({ mobile: MOBILE })).status).toBe(200);
    expect((await erase({ mobile: MOBILE })).status).toBe(404);
  });

  it("lets the number book again afterwards, as a new person needing a new consent", async () => {
    const erased = await book();
    await erase({ mobile: MOBILE });
    const again = await book();
    expect(again).not.toBe(erased);
    const consents = await env.DB.prepare("SELECT COUNT(*) AS n FROM consents WHERE person_id = ?")
      .bind(again)
      .first<{ n: number }>();
    expect(consents?.n).toBe(1);
  });

  it("refuses a missing, wrong or unprefixed secret", async () => {
    await book();
    const refused: Record<string, string>[] = [
      {},
      { Authorization: "Bearer not-the-erasure-secret-at-all-00000000" },
      { Authorization: LOCAL_SETTINGS.erasureSecret },
      { Authorization: "Bearer " },
    ];
    for (const headers of refused) {
      const response = await erase({ mobile: MOBILE }, headers);
      expect(response.status).toBe(401);
      expect((await response.json<{ error: { code: string } }>()).error.code).toBe("unauthorized");
    }
    const person = await env.DB.prepare("SELECT erased_at FROM people WHERE mobile_e164 = ?")
      .bind(MOBILE_E164)
      .first<{ erased_at: string | null }>();
    expect(person?.erased_at).toBeNull();
  });

  it("refuses a body that is not one Indian mobile number", async () => {
    for (const body of [{}, { mobile: "12345" }, { mobile: MOBILE, name: "Arjun" }]) {
      expect((await erase(body)).status).toBe(400);
    }
  });

  it("still erases when the CRM queue is down, leaving the CRM to the sweeper", async () => {
    await book();
    const downQueue = { send: () => Promise.reject(new Error("queue unavailable")) } as unknown as ReturnType<
      typeof fakeQueue
    >;
    const response = await erase({ mobile: MOBILE }, AUTHORIZED, downQueue);
    expect(response.status).toBe(200);
    expect(logs.lines().some((line) => line.event === "crm_enqueue_failed")).toBe(true);
  });
});

describe("erasePerson", () => {
  it("deletes a result a running render stored after the jobs were read", async () => {
    const personId = await book();
    await insertJob({ id: "late", person_id: personId, state: "downloading" });
    await env.RESULTS.put("results/late.jpg", syntheticJpeg(512, 512));

    const summary = await erasePerson(env, MOBILE_E164, NOW);

    expect(summary?.resultsDeleted).toBe(0); // it had no result_key when read
    expect(await env.RESULTS.head("results/late.jpg")).toBeNull();
  });
});

describe("secretsMatch", () => {
  it("matches only the same secret, and never an unset one", async () => {
    expect(await secretsMatch("a-secret", "a-secret")).toBe(true);
    expect(await secretsMatch("a-secret", "a-secreT")).toBe(false);
    expect(await secretsMatch("a-secret-but-longer", "a-secret")).toBe(false);
    expect(await secretsMatch("", "")).toBe(false);
  });
});
