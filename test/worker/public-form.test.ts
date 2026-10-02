// What both of the site's forms check of the person sending them, the same for the consultation and the waitlist,
// on /book and on an invite's landing (src/http/public-form.ts): the body, the number, Turnstile and its staging test
// token, and the day's limits per number and address. They are sent to POST /api/waitlist here, which books no slot,
// so a number may be sent as often as a test needs. These were POST /api/lead's tests until that route was removed
// (docs/open-points.md, item 107). Every name and number here is made up.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { ErrorResponseSchema } from "../../src/http/errors.ts";
import {
  appFor,
  captureLogs,
  fakeDependencies,
  fakeFetch,
  fakeQueue,
  json,
  markDatabase,
  request,
  TURNSTILE_URL,
  turnstilePasses,
} from "./helpers.ts";

const UNSERVED = "400050";

const JOINING = {
  name: "Arjun Mehta",
  mobile: "98100 00001",
  pincode: UNSERVED,
  loss_extent: "crown",
  turnstile_token: "token",
  contact_consent: true,
  launch_alert: false,
};

const queues = () => ({ CRM_QUEUE: fakeQueue(), MESSAGE_QUEUE: fakeQueue() });

function post(body: unknown): RequestInit {
  return {
    method: "POST",
    headers: { "Content-Type": "application/json", "CF-Connecting-IP": "203.0.113.7" },
    body: JSON.stringify(body),
  };
}

const join = (app = appFor(), body: unknown = JOINING) => request(app, "/api/waitlist", post(body), queues());

async function errorOf(response: Response) {
  return ErrorResponseSchema.parse(await response.json()).error;
}

const count = async (sql: string) => (await env.DB.prepare(sql).first<{ n: number }>())?.n;

beforeEach(async () => {
  await markDatabase();
  captureLogs();
  await env.DB.prepare(
    "INSERT INTO serviceable_pincodes (pincode, area, city, served) VALUES (?1, 'Bandra', 'Mumbai', 0)",
  )
    .bind(UNSERVED)
    .run();
});

describe("the site's forms: the body", () => {
  it.each([
    ["an unknown field", { ...JOINING, email: "a@b.in" }],
    ["a name that is only spaces", { ...JOINING, name: "   " }],
    ["consent not given", { ...JOINING, contact_consent: false }],
    ["an unknown loss extent", { ...JOINING, loss_extent: "total" }],
    ["a missing Turnstile token", { ...JOINING, turnstile_token: "" }],
  ])("refuses %s, and keeps nothing", async (_label, body) => {
    const answer = await join(appFor(), body);
    expect(answer.status).toBe(400);
    expect((await errorOf(answer)).code).toBe("invalid_request");
    expect(await count("SELECT COUNT(*) AS n FROM leads")).toBe(0);
  });

  it.each([
    ["a landline", "0124 4000000"],
    ["nine digits", "981000000"],
  ])("refuses %s, naming the number, and counts nothing against it", async (_label, mobile) => {
    const answer = await join(appFor(), { ...JOINING, mobile });
    expect(answer.status).toBe(400);
    expect(await errorOf(answer)).toMatchObject({ code: "invalid_request", fields: ["mobile"] });
    expect(await count("SELECT COUNT(*) AS n FROM counters")).toBe(0);
  });

  it("answers a body that is not JSON with invalid_request, not a server error", async () => {
    const answer = await request(appFor(), "/api/waitlist", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{not json",
    });
    expect(answer.status).toBe(400);
    expect((await errorOf(answer)).code).toBe("invalid_request");
  });

  // BK-60, UX-38: the form chose crown thinning for everyone who skipped the question.
  it("takes a form that does not say where the hair loss is, and records it as not said", async () => {
    const { loss_extent: _skipped, ...withoutExtent } = JOINING;
    expect((await join(appFor(), withoutExtent)).status).toBe(201);
    const lead = await env.DB.prepare("SELECT loss_extent FROM leads").first<{ loss_extent: string | null }>();
    expect(lead).toEqual({ loss_extent: null });
  });

  it("never echoes the values it refused", async () => {
    const text = await (await join(appFor(), { ...JOINING, mobile: "12345", name: "x".repeat(81) })).text();
    expect(text).not.toContain("12345");
    expect(text).not.toContain("xxxxx");
  });

  it("keeps consents append-only: a stored consent cannot be changed or deleted", async () => {
    expect((await join()).status).toBe(201);
    await expect(env.DB.prepare("UPDATE consents SET granted = 0").run()).rejects.toThrow("consents are append-only");
    await expect(env.DB.prepare("DELETE FROM consents").run()).rejects.toThrow("consents are append-only");
  });
});

describe("the site's forms: Turnstile", () => {
  it("refuses a token Cloudflare does not accept", async () => {
    const deps = fakeDependencies({
      fetch: fakeFetch({ [TURNSTILE_URL]: () => json({ success: false, "error-codes": ["invalid-input-response"] }) })
        .fetch,
    });
    const answer = await join(appFor("local", deps));
    expect(answer.status).toBe(403);
    expect((await errorOf(answer)).code).toBe("turnstile_failed");
  });

  it("refuses the form when Turnstile cannot be reached, and logs why", async () => {
    const deps = fakeDependencies({
      fetch: fakeFetch({ [TURNSTILE_URL]: () => new Response("", { status: 502 }) }).fetch,
    });
    const logs = captureLogs();
    const answer = await join(appFor("local", deps));
    expect(answer.status).toBe(503);
    expect((await errorOf(answer)).code).toBe("unavailable");
    expect(logs.lines()).toContainEqual(
      expect.objectContaining({ event: "turnstile_unavailable", detail: "siteverify 502" }),
    );
  });

  it("tells ops once a day when Turnstile has turned five visitors away in an hour", async () => {
    const deps = fakeDependencies({
      fetch: fakeFetch({ [TURNSTILE_URL]: () => new Response("", { status: 502 }) }).fetch,
    });
    const app = appFor("local", deps);
    for (let visitor = 0; visitor < 4; visitor += 1) await join(app);
    expect(deps.alerts).toEqual([]);

    for (let visitor = 0; visitor < 3; visitor += 1) await join(app);
    expect(deps.alerts).toEqual([
      "Turnstile could not check 5 visitors in the last hour (siteverify 502), so their leads and try-ons were " +
        "turned away. Check Cloudflare's status, and TURNSTILE_SECRET on the Worker.",
    ]);
  });

  it("sends Cloudflare the secret, the token and the visitor's IP", async () => {
    const turnstile = fakeFetch({ [TURNSTILE_URL]: turnstilePasses });
    await join(appFor("local", fakeDependencies({ fetch: turnstile.fetch })));
    const sent = turnstile.calls[0]?.body ?? "";
    expect(sent).toContain("1x0000000000000000000000000000000AA");
    expect(sent).toContain("token");
    expect(sent).toContain("203.0.113.7");
  });
});

// The staging check and the load test book through the real API with this token (docs/runbook.md).
describe("the site's forms: the staging test token", () => {
  const REAL_SECRET = "0x4AAAAAAA-the-real-widget-secret";
  const TEST_SECRET = "1x0000000000000000000000000000000AA";

  /** The form's answer, and the body of any siteverify request the Worker sent for this token. */
  async function siteverify(token: string, acceptTurnstileTestToken: boolean) {
    const turnstile = fakeFetch({ [TURNSTILE_URL]: turnstilePasses });
    const app = appFor("local", fakeDependencies({ fetch: turnstile.fetch }), {
      turnstileSecret: REAL_SECRET,
      acceptTurnstileTestToken,
    });
    const answer = await join(app, { ...JOINING, turnstile_token: token });
    return { status: answer.status, body: turnstile.calls[0]?.body ?? "" };
  }

  // Cloudflare's test secret passes that token by definition, so asking decides nothing and only
  // makes the tests and the staging proofs depend on reaching Cloudflare.
  it("passes Cloudflare's dummy token without asking Cloudflare, when the switch is on", async () => {
    expect(await siteverify("XXXX.DUMMY.TOKEN.XXXX", true)).toEqual({ status: 201, body: "" });
  });

  it("checks every other token, and the dummy token when the switch is off, against the real secret", async () => {
    for (const [token, switchOn] of [
      ["a-real-widget-token", true],
      ["XXXX.DUMMY.TOKEN.XXXX", false],
    ] as const) {
      const { body } = await siteverify(token, switchOn);
      expect(body).toContain(REAL_SECRET);
      expect(body).not.toContain(TEST_SECRET);
    }
  });
});

describe("the site's forms: the day's limits", () => {
  it("allows five a day per mobile number, then answers rate_limited", async () => {
    const app = appFor();
    for (let i = 0; i < 5; i++) expect((await join(app)).status).toBe(201);
    const sixth = await join(app);
    expect(sixth.status).toBe(429);
    expect((await errorOf(sixth)).code).toBe("rate_limited");
  });

  it("limits each address across different numbers", async () => {
    const app = appFor("local", fakeDependencies(), { leadIpDailyLimit: 2 });
    const statuses: number[] = [];
    for (const mobile of ["9810000011", "9810000012", "9810000013"]) {
      statuses.push((await join(app, { ...JOINING, mobile })).status);
    }
    expect(statuses).toEqual([201, 201, 429]);
  });

  it("holds staging's test records to the address's limit everywhere but staging", async () => {
    const app = appFor("local", fakeDependencies(), { leadIpDailyLimit: 1 });
    const statuses: number[] = [];
    for (const mobile of ["9810000021", "9810000022"]) {
      statuses.push((await join(app, { ...JOINING, name: "Staging test Arjun Mehta", mobile })).status);
    }
    expect(statuses).toEqual([201, 429]);
  });

  it("counts nothing against a number for a pincode the form may not take", async () => {
    await env.DB.prepare(
      "INSERT INTO serviceable_pincodes (pincode, area, city, served) VALUES ('122018', 'Gurgaon South City II', 'Gurgaon', 1)",
    ).run();
    expect((await join(appFor(), { ...JOINING, pincode: "122018" })).status).toBe(422);
    expect(await count("SELECT COUNT(*) AS n FROM counters")).toBe(0);
  });

  it("counts nothing against a number when its address has used up the day", async () => {
    const app = appFor("local", fakeDependencies(), { leadIpDailyLimit: 1 });
    expect((await join(app, { ...JOINING, mobile: "9810000011" })).status).toBe(201);
    expect((await join(app)).status).toBe(429);

    // Only the first number has spent one of its five.
    expect(await count("SELECT COUNT(*) AS n FROM counters WHERE scope = 'booking:mobile'")).toBe(1);
  });

  it("keeps no mobile number or IP address in the counters", async () => {
    await join();
    const keys = await env.DB.prepare("SELECT key FROM counters").all<{ key: string }>();
    expect(keys.results.length).toBe(2);
    for (const { key } of keys.results) expect(key).toMatch(/^[0-9a-f]{64}$/);
  });
});
