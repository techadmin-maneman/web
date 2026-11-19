// A discount code's terms changed while no booking has taken it, its text kept
// (docs/decisions/0283-changed-and-deleted-while-unused.md); once one has, it is switched off instead.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { enterOnVisit } from "../../../src/domain/money/discount-code-visits.ts";
import { makeCodes, type NewCodes } from "../../../src/domain/money/discount-codes.ts";
import type { App } from "../../../src/http/context.ts";
import { aVisit } from "../fixtures/index.ts";
import { appFor, captureLogs, fakeDependencies, markDatabase, NOW, request } from "../helpers.ts";

const VISIT = "22222222-2222-4222-8222-222222222222";
const OPS = { kind: "ops", actor: { kind: "staff", id: "ops@localhost" } } as const;

let ops: App;

const patch = (id: string, body: unknown) =>
  request(ops, `/api/discount-codes/${id}`, {
    method: "PATCH",
    headers: { Origin: "https://maneman.test", "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

interface Listed {
  id: string;
  code: string;
  kind: string;
  value: number;
  covers: string[];
  max_uses: number | null;
  once_per_client: boolean;
  deletable: boolean;
}

const listed = async () => (await (await request(ops, "/api/discount-codes")).json<{ codes: Listed[] }>()).codes;

const make = (code: string, covers: NewCodes["covers"] = ["service"]) =>
  makeCodes(
    env.DB,
    {
      code,
      count: 1,
      kind: "percent",
      value: 10,
      cap: null,
      covers,
      expiresOn: null,
      maxUses: null,
      oncePerClient: true,
    },
    { actor: OPS.actor, requestId: "r", now: NOW },
  );

/** Five hundred rupees off a first fit or a service visit, three times at most, as often as a client likes. */
const FIVE_HUNDRED = {
  kind: "amount",
  value: 50_000,
  covers: ["first_fit", "service"],
  max_uses: 3,
  once_per_client: false,
};

beforeEach(async () => {
  await markDatabase();
  captureLogs();
  ops = appFor("local", fakeDependencies(), {}, "ops");
  await aVisit({ id: VISIT, window_start: "2026-09-23T04:30:00.000Z" });
});

describe("Settings · Discount codes, a code's terms changed", () => {
  it("changes a code no booking has taken, its text kept, and audits it", async () => {
    await make("UNUSED");
    const [code] = await listed();
    expect((await patch(code?.id ?? "", FIVE_HUNDRED)).status).toBe(204);
    expect(await listed()).toEqual([expect.objectContaining({ id: code?.id, code: "UNUSED", ...FIVE_HUNDRED })]);
    const audit = await env.DB.prepare("SELECT subject_id FROM audit_log WHERE action = 'discount_code.change'").all();
    expect(audit.results).toEqual([{ subject_id: code?.id }]);
  });

  it("refuses a code a booking has taken, even once taken off, and writes nothing", async () => {
    await make("TENPC");
    await enterOnVisit(env.DB, { visitId: VISIT, text: "TENPC", by: OPS }, NOW);
    await request(ops, `/api/visits/${VISIT}/discount-code/remove`, {
      method: "POST",
      headers: { Origin: "https://maneman.test" },
    });
    const [code] = await listed();
    const refused = await patch(code?.id ?? "", FIVE_HUNDRED);
    expect(refused.status).toBe(409);
    expect(await refused.json()).toMatchObject({ error: { code: "in_use" } });
    expect(await listed()).toEqual([expect.objectContaining({ kind: "percent", value: 10, covers: ["service"] })]);
    const audit = await env.DB.prepare("SELECT 1 FROM audit_log WHERE action = 'discount_code.change'").all();
    expect(audit.results).toEqual([]);
  });

  it("refuses a code a partner gives its friends, as the list says, and writes nothing", async () => {
    await make("SALON2K", ["first_fit"]);
    const partner = { name: "Looks Salon, Sector 29", friend_visits: 0, valid_days: 180, commission: 150_000 };
    const added = await request(ops, "/api/referral-channels", {
      method: "POST",
      headers: { Origin: "https://maneman.test", "Content-Type": "application/json" },
      body: JSON.stringify({ ...partner, discount_code: "salon2k" }),
    });
    expect(added.status).toBe(200);
    const [code] = await listed();
    expect(code).toMatchObject({ code: "SALON2K", deletable: false });
    const refused = await patch(code?.id ?? "", FIVE_HUNDRED);
    expect(refused.status).toBe(409);
    expect(await refused.json()).toMatchObject({ error: { code: "in_use" } });
    const audit = await env.DB.prepare("SELECT 1 FROM audit_log WHERE action = 'discount_code.change'").all();
    expect(audit.results).toEqual([]);
  });

  it("refuses terms a code cannot take, naming the box, and a code that is not there", async () => {
    await make("UNUSED");
    const [code] = await listed();
    const over = await patch(code?.id ?? "", { ...FIVE_HUNDRED, kind: "percent", value: 150 });
    expect(over.status).toBe(400);
    expect(await over.json()).toMatchObject({ error: { code: "invalid_request", fields: ["value"] } });
    expect((await patch(code?.id ?? "", { ...FIVE_HUNDRED, code: "OTHER" })).status).toBe(400);
    expect((await patch("33333333-3333-4333-8333-333333333333", FIVE_HUNDRED)).status).toBe(404);
  });
});
