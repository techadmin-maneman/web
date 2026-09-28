import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { CURRENT_NOTICE } from "../../src/config/notices.ts";
import { ErrorResponseSchema } from "../../src/http/errors.ts";
import { LeadResponseSchema } from "../../src/routes/lead.ts";
import {
  appFor,
  captureLogs,
  fakeDependencies,
  fakeFetch,
  fakeQueue,
  json,
  markDatabase,
  NOW,
  request,
  TURNSTILE_URL,
  turnstilePasses,
} from "./helpers.ts";

// NOW in the helpers is Monday 21 September 2026, 12:00 in India. VISIT_LEAD_DAYS is 2.

const BOOKING = {
  name: "Arjun Mehta",
  mobile: "98100 00001",
  city: "Gurgaon",
  first_choice_window: "weekday_am",
  loss_extent: "crown",
  consent: true,
  turnstile_token: "token",
};

function post(body: unknown, headers: Record<string, string> = {}): RequestInit {
  return {
    method: "POST",
    headers: { "Content-Type": "application/json", "CF-Connecting-IP": "203.0.113.7", ...headers },
    body: JSON.stringify(body),
  };
}

async function errorCode(response: Response): Promise<string> {
  return ErrorResponseSchema.parse(await response.json()).error.code;
}

beforeEach(async () => {
  await markDatabase();
  captureLogs();
});

describe("POST /api/lead: a served city", () => {
  it("saves the person, consent and lead, queues the syncs to the CRM and FSM, and proposes a visit day", async () => {
    const queue = fakeQueue();
    const fsmQueue = fakeQueue();
    const res = await request(appFor(), "/api/lead", post(BOOKING), { CRM_QUEUE: queue, FSM_QUEUE: fsmQueue });

    expect(res.status).toBe(201);
    const body = LeadResponseSchema.parse(await res.json());
    // Monday + 2 days = Wednesday 23 September, a weekday.
    expect(body).toEqual({
      lead_id: body.lead_id,
      served: true,
      proposed_visit_date: "2026-09-23",
      window_label: "before noon",
    });

    const person = await env.DB.prepare("SELECT * FROM people").first();
    expect(person).toMatchObject({ name: "Arjun Mehta", mobile_e164: "+919810000001", contactable: 1 });

    const consent = await env.DB.prepare("SELECT * FROM consents").first();
    expect(consent).toMatchObject({
      person_id: person?.id,
      purpose: "contact",
      notice_version: CURRENT_NOTICE.contact,
      granted: 1,
      source: "site_booking",
    });
    expect(consent?.ip_hash).toMatch(/^[0-9a-f]{64}$/);

    const lead = await env.DB.prepare("SELECT * FROM leads").first();
    expect(lead).toMatchObject({
      id: body.lead_id,
      person_id: person?.id,
      source: "form",
      city: "Gurgaon",
      first_choice_window: "weekday_am",
      loss_extent: "crown",
      proposed_visit_date: "2026-09-23",
      sync_state: "pending",
    });

    expect(queue.sent).toEqual([{ lead_id: body.lead_id, request_id: res.headers.get("X-Request-Id") }]);
    expect(fsmQueue.sent).toEqual([{ lead_id: body.lead_id, request_id: res.headers.get("X-Request-Id") }]);
  });

  it("stamps a booking put on the fsm-sync queue, and leaves one that failed to go for the sweeper", async () => {
    const queued = await request(appFor(), "/api/lead", post(BOOKING), {
      CRM_QUEUE: fakeQueue(),
      FSM_QUEUE: fakeQueue(),
    });
    const { lead_id: sent } = LeadResponseSchema.parse(await queued.json());

    const broken = { ...fakeQueue(), send: () => Promise.reject(new Error("queue unavailable")) } as unknown as Queue;
    const failed = await request(appFor(), "/api/lead", post({ ...BOOKING, mobile: "98100 00002" }), {
      CRM_QUEUE: fakeQueue(),
      FSM_QUEUE: broken,
    });
    expect(failed.status).toBe(201);
    const { lead_id: unsent } = LeadResponseSchema.parse(await failed.json());

    const stamp = (id: string) =>
      env.DB.prepare("SELECT fsm_queued_at FROM leads WHERE id = ?1")
        .bind(id)
        .first<{ fsm_queued_at: string | null }>();
    expect((await stamp(sent))?.fsm_queued_at).toBe(NOW.toISOString());
    expect((await stamp(unsent))?.fsm_queued_at).toBeNull();
  });

  it("proposes the first weekend day for a weekend window, after four for an evening", async () => {
    const res = await request(appFor(), "/api/lead", post({ ...BOOKING, first_choice_window: "weekend_pm" }), {
      CRM_QUEUE: fakeQueue(),
    });
    expect(LeadResponseSchema.parse(await res.json())).toMatchObject({
      proposed_visit_date: "2026-09-26", // Saturday
      window_label: "after four",
    });
  });

  it("skips blacked-out days", async () => {
    await env.DB.prepare("INSERT INTO visit_blackouts (date, reason) VALUES ('2026-09-23', 'Holiday')").run();
    const res = await request(appFor(), "/api/lead", post(BOOKING), { CRM_QUEUE: fakeQueue() });
    expect(LeadResponseSchema.parse(await res.json()).proposed_visit_date).toBe("2026-09-24");
  });

  it("keeps attribution with the lead", async () => {
    const attribution = { utm_source: "google", utm_campaign: "launch", gclid: "abc", landing_path: "/book" };
    await request(appFor(), "/api/lead", post({ ...BOOKING, attribution }), { CRM_QUEUE: fakeQueue() });
    const lead = await env.DB.prepare("SELECT utm_source, utm_campaign, gclid, landing_path FROM leads").first();
    expect(lead).toEqual(attribution);
  });

  // A form anyone can fill in with a number never renames the person it belongs to (ADR 0068).
  it("recognises a returning number: one person, the name they first gave, two leads", async () => {
    const app = appFor();
    await request(app, "/api/lead", post(BOOKING), { CRM_QUEUE: fakeQueue() });
    await request(app, "/api/lead", post({ ...BOOKING, name: "Arjun M.", mobile: "+91 98100-00001" }), {
      CRM_QUEUE: fakeQueue(),
    });

    const people = await env.DB.prepare("SELECT name FROM people").all();
    expect(people.results).toEqual([{ name: "Arjun Mehta" }]);
    const leads = await env.DB.prepare("SELECT COUNT(*) AS n FROM leads").first<{ n: number }>();
    expect(leads?.n).toBe(2);
  });

  it("keeps consents append-only: a stored consent cannot be changed or deleted", async () => {
    await request(appFor(), "/api/lead", post(BOOKING), { CRM_QUEUE: fakeQueue() });
    await expect(env.DB.prepare("UPDATE consents SET granted = 0").run()).rejects.toThrow("consents are append-only");
    await expect(env.DB.prepare("DELETE FROM consents").run()).rejects.toThrow("consents are append-only");
  });

  it("still answers 201 when the queue refuses the message; the sweeper will send it", async () => {
    const brokenQueue = { ...fakeQueue(), send: () => Promise.reject(new Error("queue full")) };
    const res = await request(appFor(), "/api/lead", post(BOOKING), { CRM_QUEUE: brokenQueue as unknown as Queue });
    expect(res.status).toBe(201);
    const lead = await env.DB.prepare("SELECT sync_state FROM leads").first();
    expect(lead).toEqual({ sync_state: "pending" });
  });
});

describe("POST /api/lead: a city not yet served", () => {
  it("joins the waitlist: no visit day, no window label", async () => {
    const res = await request(appFor(), "/api/lead", post({ ...BOOKING, city: "Mumbai" }), {
      CRM_QUEUE: fakeQueue(),
    });
    expect(res.status).toBe(201);
    const body = LeadResponseSchema.parse(await res.json());
    expect(body).toEqual({ lead_id: body.lead_id, served: false });

    const lead = await env.DB.prepare("SELECT source, proposed_visit_date FROM leads").first();
    expect(lead).toEqual({ source: "waitlist", proposed_visit_date: null });
  });

  it("follows the cities table: opening Mumbai is an UPDATE", async () => {
    await env.DB.prepare("UPDATE cities SET served = 1 WHERE name = 'Mumbai'").run();
    const res = await request(appFor(), "/api/lead", post({ ...BOOKING, city: "Mumbai" }), {
      CRM_QUEUE: fakeQueue(),
    });
    expect(LeadResponseSchema.parse(await res.json()).served).toBe(true);
  });
});

describe("POST /api/lead: validation", () => {
  it.each([
    ["an unknown field", { ...BOOKING, email: "a@b.in" }, "body"],
    ["a name that is only spaces", { ...BOOKING, name: "   " }, "name"],
    ["a name over 60 characters", { ...BOOKING, name: "x".repeat(61) }, "name"],
    ["a landline", { ...BOOKING, mobile: "0124 4000000" }, "mobile"],
    ["nine digits", { ...BOOKING, mobile: "981000000" }, "mobile"],
    ["consent not given", { ...BOOKING, consent: false }, "consent"],
    ["an unknown window", { ...BOOKING, first_choice_window: "sunday" }, "first_choice_window"],
    ["an unknown loss extent", { ...BOOKING, loss_extent: "total" }, "loss_extent"],
    ["a missing Turnstile token", { ...BOOKING, turnstile_token: "" }, "turnstile_token"],
  ])("rejects %s, naming the field", async (_label, body, field) => {
    const res = await request(appFor(), "/api/lead", post(body));
    expect(res.status).toBe(400);
    const error = ErrorResponseSchema.parse(await res.json()).error;
    expect(error.code).toBe("invalid_request");
    expect(error.fields).toContain(field);
    const count = await env.DB.prepare("SELECT COUNT(*) AS n FROM leads").first<{ n: number }>();
    expect(count?.n).toBe(0);
  });

  it("rejects a city that is not in the list, or not active", async () => {
    await env.DB.prepare("UPDATE cities SET active = 0 WHERE name = 'Bengaluru'").run();
    for (const city of ["Atlantis", "Bengaluru"]) {
      const res = await request(appFor(), "/api/lead", post({ ...BOOKING, city }));
      expect(res.status).toBe(400);
      expect(ErrorResponseSchema.parse(await res.json()).error.fields).toEqual(["city"]);
    }
  });

  it("answers a body that is not JSON with invalid_request, not a server error", async () => {
    const res = await request(appFor(), "/api/lead", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{not json",
    });
    expect(res.status).toBe(400);
    expect(await errorCode(res)).toBe("invalid_request");
  });

  it("never echoes the values it rejected", async () => {
    const res = await request(appFor(), "/api/lead", post({ ...BOOKING, mobile: "12345", name: "x".repeat(61) }));
    const text = await res.text();
    expect(text).not.toContain("12345");
    expect(text).not.toContain("xxxxx");
  });
});

describe("POST /api/lead: Turnstile", () => {
  it("rejects a token Cloudflare does not accept", async () => {
    const deps = fakeDependencies({
      fetch: fakeFetch({ [TURNSTILE_URL]: () => json({ success: false, "error-codes": ["invalid-input-response"] }) })
        .fetch,
    });
    const res = await request(appFor("local", deps), "/api/lead", post(BOOKING));
    expect(res.status).toBe(403);
    expect(await errorCode(res)).toBe("turnstile_failed");
  });

  it("refuses the lead when Turnstile cannot be reached, and logs why", async () => {
    const deps = fakeDependencies({
      fetch: fakeFetch({ [TURNSTILE_URL]: () => new Response("", { status: 502 }) }).fetch,
    });
    const logs = captureLogs();
    const res = await request(appFor("local", deps), "/api/lead", post(BOOKING));
    expect(res.status).toBe(503);
    expect(await errorCode(res)).toBe("unavailable");
    expect(logs.lines()).toContainEqual(
      expect.objectContaining({ event: "turnstile_unavailable", detail: "siteverify 502" }),
    );
  });

  it("tells ops once a day when Turnstile has turned five visitors away in an hour", async () => {
    const deps = fakeDependencies({
      fetch: fakeFetch({ [TURNSTILE_URL]: () => new Response("", { status: 502 }) }).fetch,
    });
    const app = appFor("local", deps);
    for (let visitor = 0; visitor < 4; visitor += 1) await request(app, "/api/lead", post(BOOKING));
    expect(deps.alerts).toEqual([]);

    for (let visitor = 0; visitor < 3; visitor += 1) await request(app, "/api/lead", post(BOOKING));
    expect(deps.alerts).toEqual([
      "Turnstile could not check 5 visitors in the last hour (siteverify 502), so their leads and try-ons were " +
        "turned away. Check Cloudflare's status, and TURNSTILE_SECRET on the Worker.",
    ]);
  });

  it("sends Cloudflare the secret, the token and the visitor's IP", async () => {
    const turnstile = fakeFetch({ [TURNSTILE_URL]: turnstilePasses });
    await request(appFor("local", fakeDependencies({ fetch: turnstile.fetch })), "/api/lead", post(BOOKING), {
      CRM_QUEUE: fakeQueue(),
    });
    const sent = turnstile.calls[0]?.body ?? "";
    expect(sent).toContain("1x0000000000000000000000000000000AA");
    expect(sent).toContain("token");
    expect(sent).toContain("203.0.113.7");
  });
});

describe("POST /api/lead: the staging test token", () => {
  const REAL_SECRET = "0x4AAAAAAA-the-real-widget-secret";
  const TEST_SECRET = "1x0000000000000000000000000000000AA";

  /** The lead's answer, and the body of any siteverify request the Worker sent for this token. */
  async function siteverify(
    token: string,
    acceptTurnstileTestToken: boolean,
  ): Promise<{ status: number; body: string }> {
    const turnstile = fakeFetch({ [TURNSTILE_URL]: turnstilePasses });
    const app = appFor("local", fakeDependencies({ fetch: turnstile.fetch }), {
      turnstileSecret: REAL_SECRET,
      acceptTurnstileTestToken,
    });
    const res = await request(app, "/api/lead", post({ ...BOOKING, turnstile_token: token }), {
      CRM_QUEUE: fakeQueue(),
    });
    return { status: res.status, body: turnstile.calls[0]?.body ?? "" };
  }

  const siteverifyBody = async (token: string, on: boolean) => (await siteverify(token, on)).body;

  // Cloudflare's test secret passes that token by definition, so asking decides nothing and only
  // makes the tests and the staging proofs depend on reaching Cloudflare.
  it("passes Cloudflare's dummy token without asking Cloudflare, when the switch is on", async () => {
    const { status, body } = await siteverify("XXXX.DUMMY.TOKEN.XXXX", true);
    expect(status).toBe(201);
    expect(body).toBe("");
  });

  it("checks every other token, and the dummy token when the switch is off, against the real secret", async () => {
    for (const [token, switchOn] of [
      ["a-real-widget-token", true],
      ["XXXX.DUMMY.TOKEN.XXXX", false],
    ] as const) {
      const body = await siteverifyBody(token, switchOn);
      expect(body).toContain(REAL_SECRET);
      expect(body).not.toContain(TEST_SECRET);
    }
  });
});

describe("POST /api/lead: rate limits", () => {
  it("allows five leads a day per mobile number, then answers rate_limited", async () => {
    const app = appFor();
    for (let i = 0; i < 5; i++) {
      expect((await request(app, "/api/lead", post(BOOKING), { CRM_QUEUE: fakeQueue() })).status).toBe(201);
    }
    const sixth = await request(app, "/api/lead", post(BOOKING), { CRM_QUEUE: fakeQueue() });
    expect(sixth.status).toBe(429);
    expect(await errorCode(sixth)).toBe("rate_limited");
  });

  it("limits each IP address across different numbers", async () => {
    const app = appFor("local", fakeDependencies(), { leadIpDailyLimit: 2 });
    const statuses: number[] = [];
    for (const mobile of ["9810000011", "9810000012", "9810000013"]) {
      statuses.push((await request(app, "/api/lead", post({ ...BOOKING, mobile }), { CRM_QUEUE: fakeQueue() })).status);
    }
    expect(statuses).toEqual([201, 201, 429]);
  });

  it("counts nothing against a number for a city it cannot book", async () => {
    const app = appFor();
    const refused = await request(app, "/api/lead", post({ ...BOOKING, city: "Atlantis" }), { CRM_QUEUE: fakeQueue() });
    expect(refused.status).toBe(400);
    const counted = await env.DB.prepare("SELECT COUNT(*) AS n FROM counters").first<{ n: number }>();
    expect(counted?.n).toBe(0);
  });

  it("counts nothing against a number when its address has used up the day", async () => {
    const app = appFor("local", fakeDependencies(), { leadIpDailyLimit: 1 });
    const first = await request(app, "/api/lead", post({ ...BOOKING, mobile: "9810000011" }), {
      CRM_QUEUE: fakeQueue(),
    });
    expect(first.status).toBe(201);
    const second = await request(app, "/api/lead", post(BOOKING), { CRM_QUEUE: fakeQueue() });
    expect(second.status).toBe(429);

    // Only the first number has spent one of its five.
    const numbers = await env.DB.prepare("SELECT COUNT(*) AS n FROM counters WHERE scope = 'lead:mobile'").first<{
      n: number;
    }>();
    expect(numbers?.n).toBe(1);
  });

  it("keeps no mobile number or IP address in the counters", async () => {
    await request(appFor(), "/api/lead", post(BOOKING), { CRM_QUEUE: fakeQueue() });
    const keys = await env.DB.prepare("SELECT key FROM counters").all<{ key: string }>();
    expect(keys.results.length).toBe(2);
    for (const { key } of keys.results) {
      expect(key).toMatch(/^[0-9a-f]{64}$/);
    }
  });
});

describe("POST /api/lead: Idempotency-Key", () => {
  it("returns the first response for a repeat, without a second lead", async () => {
    const app = appFor();
    const headers = { "Idempotency-Key": "key-0001-abcdef" };
    const first = await request(app, "/api/lead", post(BOOKING, headers), { CRM_QUEUE: fakeQueue() });
    const second = await request(app, "/api/lead", post(BOOKING, headers), { CRM_QUEUE: fakeQueue() });

    expect(second.status).toBe(201);
    expect(await second.json()).toEqual(await first.json());
    const count = await env.DB.prepare("SELECT COUNT(*) AS n FROM leads").first<{ n: number }>();
    expect(count?.n).toBe(1);
  });

  it("refuses the same key with a different body", async () => {
    const app = appFor();
    const headers = { "Idempotency-Key": "key-0002-abcdef" };
    await request(app, "/api/lead", post(BOOKING, headers), { CRM_QUEUE: fakeQueue() });
    const res = await request(app, "/api/lead", post({ ...BOOKING, city: "Delhi" }, headers));
    expect(res.status).toBe(422);
    expect(await errorCode(res)).toBe("idempotency_key_reused");
  });

  it("releases the key when the request fails, so a retry can succeed", async () => {
    const headers = { "Idempotency-Key": "key-0003-abcdef" };
    const rejecting = fakeDependencies({ fetch: fakeFetch({ [TURNSTILE_URL]: () => json({ success: false }) }).fetch });
    expect((await request(appFor("local", rejecting), "/api/lead", post(BOOKING, headers))).status).toBe(403);

    const retry = await request(appFor(), "/api/lead", post(BOOKING, headers), { CRM_QUEUE: fakeQueue() });
    expect(retry.status).toBe(201);
  });

  it("answers in_progress while the first request with the key is still running", async () => {
    await env.DB.prepare(
      "INSERT INTO idempotency (key, route, request_hash, created_at) VALUES ('key-0004-abcdef', 'POST /api/lead', ?, ?)",
    )
      .bind(
        // the hash of BOOKING as the route computes it
        await crypto.subtle
          .digest("SHA-256", new TextEncoder().encode(JSON.stringify(BOOKING)))
          .then((buffer) => [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, "0")).join("")),
        new Date().toISOString(),
      )
      .run();
    const res = await request(appFor(), "/api/lead", post(BOOKING, { "Idempotency-Key": "key-0004-abcdef" }));
    expect(res.status).toBe(409);
    expect(await errorCode(res)).toBe("idempotency_in_progress");
  });
});
