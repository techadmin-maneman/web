// Spend (src/domain/money/spend.ts, spend-import.ts, src/routes/ops/spend.ts; docs/decisions/0150-spend.md, amended
// by 0288): growth add a day's spend for a city or national under any channel, Google's and Meta's included, take one
// off, and bring in an ad account's rows from its CSV once; each is audited. NOW is Monday 21 September 2026 in India.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import type { App } from "../../../src/http/context.ts";
import { captureLogs, markDatabase, request } from "../helpers.ts";
import { enforce, listStaff, opsAs, person } from "../ops/staff-fixtures.ts";

const GROWTH = "growth@maneman.test";
const LOOKER = "looker@maneman.test";

const post = (app: App, path: string, body?: unknown) =>
  request(app, path, {
    method: "POST",
    headers: { Origin: "https://maneman.test", "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

interface Listed {
  entries: {
    id: string;
    spent_date: string | null;
    city: string | null;
    channel: string;
    campaign: string | null;
    amount: number;
    source: string;
  }[];
  first_day: string;
  today: string;
}

const listed = async (app: App) => (await request(app, "/api/spend")).json<Listed>();

const FLYERS = { day: "2026-09-18", city: "Gurgaon", channel: "partner", amount: 2_500_000, note: "Salon flyers" };

const audited = async () =>
  (
    await env.DB.prepare("SELECT action FROM audit_log WHERE action LIKE 'spend.%' ORDER BY id").all<{
      action: string;
    }>()
  ).results.map((row) => row.action);

beforeEach(async () => {
  captureLogs();
  await markDatabase();
  await listStaff(GROWTH, ["growth:manage:national"]);
  await listStaff(LOOKER, ["growth:view:national"]);
});

describe("spend typed in", () => {
  it("is added by the day for a city or national, listed the latest day first, taken off once, and audited", async () => {
    const growth = opsAs(person(GROWTH));
    const flyers = await (await post(growth, "/api/spend", FLYERS)).json<{ id: string }>();
    await post(growth, "/api/spend", { day: "2026-08-02", city: null, channel: "google_ads", amount: 1_000_000 });

    const list = await listed(growth);
    expect(
      list.entries.map((entry) => [entry.spent_date, entry.city, entry.channel, entry.amount, entry.source]),
    ).toEqual([
      ["2026-09-18", "Gurgaon", "partner", 2_500_000, "manual"],
      ["2026-08-02", null, "google_ads", 1_000_000, "manual"],
    ]);
    expect(list).toMatchObject({ today: "2026-09-21", first_day: "2025-09-01" });

    expect((await post(growth, `/api/spend/${flyers.id}/remove`)).status).toBe(200);
    expect((await post(growth, `/api/spend/${flyers.id}/remove`)).status).toBe(404);
    expect((await listed(growth)).entries.map((entry) => entry.spent_date)).toEqual(["2026-08-02"]);
    expect(await audited()).toEqual(["spend.add", "spend.add", "spend.remove"]);
  });

  it("refuses a day past today or before the list, a city we do not hold, and a channel that is not one", async () => {
    const growth = opsAs(person(GROWTH));
    const refused = async (change: object) => (await post(growth, "/api/spend", { ...FLYERS, ...change })).json();
    expect(await refused({ day: "2026-09-22" })).toMatchObject({ error: { fields: ["day"] } });
    expect(await refused({ day: "2025-08-31" })).toMatchObject({ error: { fields: ["day"] } });
    expect(await refused({ city: "Atlantis" })).toMatchObject({ error: { fields: ["city"] } });
    expect((await post(growth, "/api/spend", { ...FLYERS, channel: "billboards" })).status).toBe(400);
  });

  it("is growth's to change once the Staff list is enforced, and to read with a look", async () => {
    await enforce();
    expect((await request(opsAs(person(LOOKER)), "/api/spend")).status).toBe(200);
    expect((await post(opsAs(person(LOOKER)), "/api/spend", FLYERS)).status).toBe(403);
    expect((await post(opsAs(person(LOOKER)), "/api/spend/import", { platform: "google", rows: [] })).status).toBe(403);
  });
});

describe("an ad account's CSV", () => {
  const ROWS = [
    { day: "2026-09-19", campaign: "gurgaon-search-hair-systems", amount: 1_250_000 },
    { day: "2026-09-20", campaign: "national-brand-search", amount: 300_000 },
  ];

  it("is brought in under its platform's channel, each campaign in the city its name starts with, once", async () => {
    const growth = opsAs(person(GROWTH));
    const answer = await post(growth, "/api/spend/import", { platform: "google", rows: ROWS });

    expect(await answer.json()).toEqual({ added: 2 });
    expect(
      (await listed(growth)).entries.map((entry) => [
        entry.spent_date,
        entry.city,
        entry.channel,
        entry.campaign,
        entry.source,
      ]),
    ).toEqual([
      ["2026-09-20", null, "google_ads", "national-brand-search", "csv"],
      ["2026-09-19", "Gurgaon", "google_ads", "gurgaon-search-hair-systems", "csv"],
    ]);
    const again = await post(growth, "/api/spend/import", { platform: "google", rows: ROWS });
    expect(again.status).toBe(409);
    expect(await again.json()).toMatchObject({ error: { code: "already_imported" } });
    expect(await audited()).toEqual(["spend.import"]);
  });

  it("replaces, from a later export, the days and campaigns an earlier one brought", async () => {
    const growth = opsAs(person(GROWTH));
    await post(growth, "/api/spend/import", { platform: "google", rows: ROWS });
    await post(growth, "/api/spend/import", {
      platform: "google",
      rows: [
        { day: "2026-09-20", campaign: "national-brand-search", amount: 350_000 },
        { day: "2026-09-21", campaign: "national-brand-search", amount: 200_000 },
      ],
    });

    expect((await listed(growth)).entries.map((entry) => [entry.spent_date, entry.campaign, entry.amount])).toEqual([
      ["2026-09-21", "national-brand-search", 200_000],
      ["2026-09-20", "national-brand-search", 350_000],
      ["2026-09-19", "gurgaon-search-hair-systems", 1_250_000],
    ]);
  });

  it("refuses rows for a day outside the list, and keeps none of them", async () => {
    const growth = opsAs(person(GROWTH));
    const answer = await post(growth, "/api/spend/import", {
      platform: "meta",
      rows: [...ROWS, { day: "2026-09-22", campaign: "gurgaon-reels", amount: 100_000 }],
    });

    expect(await answer.json()).toMatchObject({ error: { fields: ["rows"] } });
    expect((await listed(growth)).entries).toEqual([]);
  });
});
