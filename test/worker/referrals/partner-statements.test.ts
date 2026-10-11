// Partners' monthly statements (src/domain/referrals/partner-statements.ts, src/routes/ops/partner-statements.ts;
// docs/decisions/0124-partner-statements.md). NOW is Monday 21 September 2026, 12 noon in India, so last month is
// August. Every name and number is made up.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import type { App } from "../../../src/http/context.ts";
import { appFor, fakeDependencies, markDatabase, request } from "../helpers.ts";
import { person } from "./referral-grants-fixtures.ts";

let ops: App;

interface Statements {
  month: string;
  this_month: string;
  first_month: string;
  statements: {
    channel_id: string;
    fitted: number;
    earned: number;
    taken_back: number;
    taken_back_amount: number;
    due: number;
    payout: { amount: number; paid_on: string; reference: string } | null;
    owed: number;
    lines: { day: string; kind: string; commission: number }[];
  }[];
}

const SALON = "7b0c8e3a-4d5f-4a6b-8c7d-2e3f4a5b6c7d";
const FRIENDS = ["a1", "a2", "a3"].map((tag) => `${tag}111111-1111-4111-8111-111111111111`);

const send = (path: string, body?: unknown) =>
  request(ops, path, {
    method: "POST",
    headers: { Origin: "https://maneman.test", "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

const statements = async (month?: string) => {
  const answer = await request(ops, `/api/partner-statements${month === undefined ? "" : `?month=${month}`}`);
  expect(answer.status).toBe(200);
  return answer.json<Statements>();
};

/** A friend of the salon's, fitted at `granted` for `commission`, and taken back at `clawed` if given. */
async function friend(id: string, commission: number, granted: string, clawed: string | null = null) {
  await env.DB.prepare(
    `INSERT INTO channel_attributions (id, channel_id, referred_person_id, first_touch_at, via, grant_state, commission,
       granted_at, clawed_back_at, created_at, updated_at)
     VALUES (?1, ?2, ?1, '2026-07-01T06:30:00.000Z', 'consultation', ?3, ?4, ?5, ?6, '2026-07-01T06:30:00.000Z', ?5)`,
  )
    .bind(id, SALON, clawed === null ? "granted" : "clawed_back", commission, granted, clawed)
    .run();
}

beforeEach(async () => {
  await markDatabase();
  ops = appFor("local", fakeDependencies(), {}, "ops");
  await env.DB.prepare(
    `INSERT INTO referral_channels (id, name, code, friend_visits, valid_days, commission, created_by, created_at)
     VALUES (?1, 'Looks Salon, Sector 29', 'LSK7P2QX', 2, 180, 150000, 'growth@maneman.test', '2026-07-01T06:30:00.000Z')`,
  )
    .bind(SALON)
    .run();
  for (const [index, id] of FRIENDS.entries())
    await person(id, `Friend ${String(index)}`, `+91981000010${String(index)}`);
  // Fitted in the first half hour of 1 September in India, still 31 August by the clock in London.
  await friend(FRIENDS[0] ?? "", 150000, "2026-08-31T19:00:00.000Z");
  // Fitted when the commission was lower.
  await friend(FRIENDS[1] ?? "", 100000, "2026-09-15T06:30:00.000Z");
  // Fitted in August, and the fit refunded under the guarantee in September.
  await friend(FRIENDS[2] ?? "", 150000, "2026-08-10T06:30:00.000Z", "2026-09-20T06:30:00.000Z");
});

describe("a partner's month", () => {
  it("is its fits by day in India, less what a refund took back in it, beside all it is owed", async () => {
    const september = await statements("2026-09");
    expect(september).toMatchObject({ month: "2026-09", this_month: "2026-09", first_month: "2026-07" });
    expect(september.statements).toEqual([
      expect.objectContaining({
        channel_id: SALON,
        fitted: 2,
        earned: 250000,
        taken_back: 1,
        taken_back_amount: 150000,
        due: 100000,
        payout: null,
        owed: 250000,
        lines: [
          { day: "2026-09-01", kind: "fitted", commission: 150000 },
          { day: "2026-09-15", kind: "fitted", commission: 100000 },
          { day: "2026-09-20", kind: "taken_back", commission: 150000 },
        ],
      }),
    ]);
  });

  it("is last month's when none is asked for: the month to pay", async () => {
    const august = await statements();
    expect(august.month).toBe("2026-08");
    expect(august.statements).toMatchObject([{ fitted: 1, earned: 150000, taken_back: 0, due: 150000 }]);
  });
});

describe("a month's payment", () => {
  const PAID = { month: "2026-08", amount: 150000, paid_on: "2026-09-05", reference: "UTR 2026 0905 1234" };

  it("is recorded once, for a month that has ended, and leaves the partner owed the rest", async () => {
    const paid = await send(`/api/partner-statements/${SALON}/payouts`, PAID);
    expect(paid.status).toBe(200);
    expect((await paid.json<Statements>()).statements).toMatchObject([
      { payout: { amount: 150000, paid_on: "2026-09-05", reference: PAID.reference }, owed: 100000 },
    ]);
    const channels = await (await request(ops, "/api/referral-channels")).json<{ channels: { owed: number }[] }>();
    expect(channels.channels).toMatchObject([{ owed: 100000 }]);

    expect((await send(`/api/partner-statements/${SALON}/payouts`, PAID)).status).toBe(409);
    const thisMonth = await send(`/api/partner-statements/${SALON}/payouts`, { ...PAID, month: "2026-09" });
    expect(thisMonth.status).toBe(400);
    expect(await thisMonth.json()).toMatchObject({ error: { fields: ["month"] } });
    const early = await send(`/api/partner-statements/${SALON}/payouts`, {
      ...PAID,
      month: "2026-07",
      paid_on: "2026-06-30",
    });
    expect(await early.json()).toMatchObject({ error: { fields: ["paid_on"] } });
  });

  it("recorded by mistake is taken off, and the month is owed again", async () => {
    await send(`/api/partner-statements/${SALON}/payouts`, PAID);
    const taken = await send(`/api/partner-statements/${SALON}/payouts/2026-08/delete`);
    expect(taken.status).toBe(200);
    expect((await taken.json<Statements>()).statements).toMatchObject([{ payout: null, owed: 250000 }]);
    expect((await send(`/api/partner-statements/${SALON}/payouts/2026-08/delete`)).status).toBe(404);

    const { results } = await env.DB.prepare(
      "SELECT action, detail FROM audit_log WHERE action LIKE 'partner_payout.%' ORDER BY at, action DESC",
    ).all();
    expect(results).toEqual([
      { action: "partner_payout.record", detail: JSON.stringify({ month: "2026-08", amount: 150000 }) },
      { action: "partner_payout.delete", detail: JSON.stringify({ month: "2026-08", amount: 150000 }) },
    ]);
  });
});
