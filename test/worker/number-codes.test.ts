// A WhatsApp code that proves a number typed into the site, before /book's one visit or /try's gate acts on it
// (src/policy/number-proof.ts, src/routes/number-codes.ts). Every number here is made up.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import type { Settings } from "../../src/config/settings.ts";
import type { App } from "../../src/http/context.ts";
import { ceilingReached } from "../../src/domain/ceilings.ts";
import { mobileHashOf, numberProved } from "../../src/domain/number-codes.ts";
import {
  appFor,
  fakeDependencies,
  fakeFetch,
  json,
  LOCAL_SETTINGS,
  markDatabase,
  NOW,
  request,
  TURNSTILE_URL,
  type TestDependencies,
} from "./helpers.ts";

const MOBILE = "+919810000001";
const MINUTE = 60_000;

let clock: Date;
let deps: TestDependencies;
let app: App;

function build(settings: Partial<Settings> = {}, overrides: Parameters<typeof fakeDependencies>[0] = {}): void {
  deps = fakeDependencies({ now: () => clock, ...overrides });
  app = appFor("local", deps, settings);
}

const post = (path: string, body: unknown) =>
  request(app, path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

async function ask(mobile = "98100 00001", name = "Arjun Mehta") {
  const answer = await post("/api/number-code", { mobile, name, turnstile_token: "token" });
  return { status: answer.status, body: await answer.json<{ code_id: string; error?: { code: string } }>() };
}

const verify = (codeId: string, code: string) => post("/api/number-code/verify", { code_id: codeId, code });

/** The code the number received on WhatsApp. */
function received(): string {
  const sent = deps.sentCodes.at(-1);
  if (sent === undefined) throw new Error("no code was sent");
  return sent.code;
}

const proved = async (codeId: string, mobile = MOBILE) =>
  numberProved(env.DB, { id: codeId, mobileHash: await mobileHashOf(LOCAL_SETTINGS.ipHashSalt, mobile), now: clock });

beforeEach(async () => {
  clock = NOW;
  build();
  await markDatabase();
});

describe("POST /api/number-code", () => {
  it("sends a code on WhatsApp to any number, keeping the number and the code only as hashes", async () => {
    const { status, body } = await ask("+91 98100 00001");

    expect(status).toBe(202);
    expect(Object.keys(body)).toEqual(["code_id"]);
    expect(deps.sentCodes).toEqual([
      { channel: "whatsapp", to: MOBILE, code: expect.stringMatching(/^\d{6}$/) as string },
    ]);
    const row = await env.DB.prepare("SELECT * FROM number_codes").first();
    expect(JSON.stringify(row)).not.toContain("9810000001");
    expect(JSON.stringify(row)).not.toContain(received());
    expect(row).toMatchObject({ id: body.code_id, attempts: 0, verified_at: null, voided_at: null });
  });

  it("refuses without Turnstile, and sends nothing", async () => {
    build({}, { fetch: fakeFetch({ [TURNSTILE_URL]: () => json({ success: false }) }).fetch });
    const { status, body } = await ask();
    expect(status).toBe(403);
    expect(body.error?.code).toBe("turnstile_failed");
    expect(deps.sentCodes).toEqual([]);
  });

  it("refuses a number that is not a mobile", async () => {
    expect((await ask("12345")).status).toBe(400);
    expect(deps.sentCodes).toEqual([]);
  });

  it("sends a number its day's codes and no more", async () => {
    for (let sent = 0; sent < LOCAL_SETTINGS.login.codeMobileDailyLimit; sent += 1) {
      expect((await ask()).status).toBe(202);
    }
    const refused = await ask();
    expect(refused.status).toBe(429);
    expect(refused.body.error?.code).toBe("rate_limited");
    expect(deps.sentCodes).toHaveLength(LOCAL_SETTINGS.login.codeMobileDailyLimit);
  });

  it("stops at a day's ceiling of its own, so codes sent to numbers typed here never stop a login", async () => {
    build({ login: { ...LOCAL_SETTINGS.login, codeDailyCeiling: 1 } });
    expect((await ask("98100 00001")).status).toBe(202);

    const busy = await ask("98100 00002");
    expect(busy.status).toBe(503);
    expect(busy.body.error?.code).toBe("busy");
    expect(deps.sentCodes).toHaveLength(1);
    expect(deps.alerts).toEqual([
      'The daily form_code ceiling (1) is reached; the site\'s WhatsApp codes for the one visit and the try-on answer "busy" until midnight IST.',
    ]);
    expect(await ceilingReached(env.DB, "login_code", 1, clock)).toBe(false);
  });

  it("proves no number where codes have no pepper", async () => {
    build({ login: { ...LOCAL_SETTINGS.login, codePepper: "" } });
    const { status, body } = await ask();
    expect(status).toBe(503);
    expect(body.error?.code).toBe("unavailable");
    expect(deps.sentCodes).toEqual([]);
  });
});

describe("POST /api/number-code/verify", () => {
  it("proves the number with the right code, for 30 minutes", async () => {
    const { body } = await ask();
    expect(await proved(body.code_id)).toBe(false);

    const answer = await verify(body.code_id, received());
    expect(answer.status).toBe(200);
    expect(await answer.json()).toEqual({ verified: true });
    expect(await proved(body.code_id)).toBe(true);
    expect(await proved(body.code_id, "+919810000002")).toBe(false);

    clock = new Date(NOW.getTime() + 30 * MINUTE);
    expect(await proved(body.code_id)).toBe(false);
  });

  it("is entered once", async () => {
    const { body } = await ask();
    expect((await verify(body.code_id, received())).status).toBe(200);
    expect((await verify(body.code_id, received())).status).toBe(410);
  });

  it("counts wrong codes, and the fifth voids it", async () => {
    const { body } = await ask();
    const wrong = received() === "000000" ? "111111" : "000000";
    for (const left of [4, 3, 2, 1, 0]) {
      expect(await (await verify(body.code_id, wrong)).json()).toEqual({ verified: false, attempts_left: left });
    }
    const closed = await verify(body.code_id, received());
    expect(closed.status).toBe(410);
    expect(await closed.json()).toMatchObject({ error: { code: "code_expired" } });
    expect(await proved(body.code_id)).toBe(false);
  });

  it("works for ten minutes", async () => {
    const { body } = await ask();
    clock = new Date(NOW.getTime() + 10 * MINUTE);
    expect((await verify(body.code_id, received())).status).toBe(410);
  });
});
