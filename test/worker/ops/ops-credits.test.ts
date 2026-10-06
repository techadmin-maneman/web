// Ops putting a client's service-visit credits right by hand (src/routes/ops/credits.ts).
// NOW is Monday 21 September 2026, 12 noon in India. Every name and number here is made up.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import type { App } from "../../../src/http/context.ts";
import { creditBalance, grantCredits } from "../../../src/domain/money/credits.ts";
import { appFor, captureLogs, fakeDependencies, markDatabase, NOW, request } from "../helpers.ts";

const PERSON = "11111111-1111-4111-8111-111111111111";
let ops: App;

const adjust = (body: object, personId = PERSON) =>
  request(ops, `/api/clients/${personId}/credits`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: "https://maneman.test" },
    body: JSON.stringify(body),
  });

beforeEach(async () => {
  await markDatabase();
  captureLogs();
  ops = appFor("local", fakeDependencies(), {}, "ops");
  await env.DB.prepare(
    "INSERT INTO people (id, created_at, mobile_e164, name) VALUES (?1, ?2, '+919810000001', 'Rohit Malhotra')",
  )
    .bind(PERSON, NOW.toISOString())
    .run();
});

describe("POST /api/clients/:id/credits", () => {
  it("adds visits as a grant from ops, and records who did it and why", async () => {
    const answer = await adjust({ visits: 2, reason: "goodwill" });
    expect(answer.status).toBe(200);
    expect(await answer.json()).toEqual({ visits: 2, earliest_expiry: "2027-09-21T18:29:59.999Z" });
    const audit = await env.DB.prepare(
      "SELECT actor_kind, subject_id, detail FROM audit_log WHERE action = 'credit.adjust'",
    ).first();
    expect(audit).toEqual({
      actor_kind: "staff",
      subject_id: PERSON,
      detail: JSON.stringify({ visits: 2, reason: "goodwill" }),
    });
  });

  it("takes visits away from the grants that expire soonest, leaving the ledger append-only", async () => {
    await grantCredits(env.DB, {
      personId: PERSON,
      visits: 1,
      source: "ops",
      sourceId: "soon",
      now: NOW,
      expiresAt: new Date("2026-12-01T00:00:00Z"),
    }).run();
    await grantCredits(env.DB, { personId: PERSON, visits: 3, source: "referral", sourceId: "later", now: NOW }).run();
    const answer = await adjust({ visits: -2, reason: "correction" });
    expect(await answer.json()).toMatchObject({ visits: 2 });
    const adjusts = await env.DB.prepare(
      "SELECT visits FROM credit_ledger WHERE kind = 'adjust' ORDER BY visits",
    ).all();
    expect(adjusts.results).toEqual([{ visits: -1 }, { visits: -1 }]);
    expect((await creditBalance(env.DB, PERSON, NOW)).visits).toBe(2);
  });

  it("refuses to take away more than the client has, writing nothing", async () => {
    await grantCredits(env.DB, { personId: PERSON, visits: 1, source: "ops", sourceId: "one", now: NOW }).run();
    const answer = await adjust({ visits: -2, reason: "correction" });
    expect(answer.status).toBe(400);
    expect(await answer.json()).toMatchObject({ error: { code: "invalid_request", fields: ["visits"] } });
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM credit_ledger WHERE kind = 'adjust'").first()).toEqual({
      n: 0,
    });
  });

  it("refuses nought, a reason it does not know, and a client it does not have", async () => {
    expect((await adjust({ visits: 0, reason: "goodwill" })).status).toBe(400);
    expect((await adjust({ visits: 1, reason: "because" })).status).toBe(400);
    expect((await adjust({ visits: 1, reason: "goodwill" }, "99999999-9999-4999-8999-999999999999")).status).toBe(404);
  });
});
