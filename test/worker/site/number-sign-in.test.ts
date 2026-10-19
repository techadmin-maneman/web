// A number the site has proved, signed in to the client app once a booking holds it (src/routes/public/number-codes.ts,
// ADR 0214). Every number here is made up.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import type { App } from "../../../src/http/context.ts";
import {
  appFor,
  fakeDependencies,
  markDatabase,
  NOW,
  phaseOneLead,
  provedNumberCode,
  request,
  type TestDependencies,
} from "../helpers.ts";

const MOBILE = "+919810000001";
const MINUTE = 60_000;

let clock: Date;
let deps: TestDependencies;
let app: App;
let clientApp: App;

const post = (path: string, body: unknown) =>
  request(app, path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

/** The app finishing the sign-in, as it does at POST /api/auth/verify. */
const finish = (challengeId: string, code: string) =>
  request(clientApp, "/api/auth/verify", {
    method: "POST",
    headers: { Origin: "https://maneman.test", "Content-Type": "application/json" },
    body: JSON.stringify({ challenge_id: challengeId, code }),
  });

const signIn = async (codeId: string, mobile = "98100 00001") => {
  const answer = await post("/api/number-code/sign-in", { code_id: codeId, mobile });
  return {
    status: answer.status,
    body: await answer.json<{ challenge_id: string; code: string; error?: { code: string } }>(),
  };
};

beforeEach(async () => {
  clock = NOW;
  deps = fakeDependencies({ now: () => clock });
  app = appFor("local", deps);
  clientApp = appFor("local", deps, {}, "client");
  await markDatabase();
});

describe("POST /api/number-code/sign-in", () => {
  it("hands a booked number's proof a sign-in the app finishes, and sends no message", async () => {
    await phaseOneLead(MOBILE);
    const { status, body } = await signIn(await provedNumberCode(MOBILE));

    expect(status).toBe(201);
    expect(body).toEqual({
      challenge_id: expect.any(String) as string,
      code: expect.stringMatching(/^\d{6}$/) as string,
    });
    expect(deps.sentCodes).toEqual([]);

    const verified = await finish(body.challenge_id, body.code);
    expect(verified.status).toBe(200);
    expect(await verified.json()).toMatchObject({ verified: true, first_name: "Arjun" });
    expect(verified.headers.get("Set-Cookie")).toMatch(/mm_app=/);
  });

  it("is finished once only", async () => {
    await phaseOneLead(MOBILE);
    const { body } = await signIn(await provedNumberCode(MOBILE));
    await finish(body.challenge_id, body.code);
    const again = await finish(body.challenge_id, body.code);
    expect(again.status).toBe(410);
  });

  it("refuses a proof of another number, or one entered more than 30 minutes ago", async () => {
    await phaseOneLead(MOBILE);
    const other = await signIn(await provedNumberCode("+919810000002"));
    expect(other.status).toBe(403);
    expect(other.body.error?.code).toBe("number_not_proved");

    const codeId = await provedNumberCode(MOBILE);
    clock = new Date(NOW.getTime() + 31 * MINUTE);
    const stale = await signIn(codeId);
    expect(stale.status).toBe(403);
  });

  it("signs in nobody for a number no booking holds", async () => {
    const { status, body } = await signIn(await provedNumberCode(MOBILE));
    expect(status).toBe(404);
    expect(body.error?.code).toBe("not_found");
    const challenges = await env.DB.prepare("SELECT COUNT(*) AS n FROM otp_challenges").first<number>("n");
    expect(challenges).toBe(0);
  });
});
