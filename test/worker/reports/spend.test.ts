// Offline spend (src/domain/money/spend.ts, src/routes/ops/spend.ts; docs/decisions/0150-spend.md): growth add a
// month's spend for a city or national, take one off, and each is audited. NOW is Monday 21 September 2026 in India.

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
  entries: { id: string; month: string; city: string | null; amount: number }[];
  first_month: string;
  this_month: string;
}

const listed = async (app: App) => (await request(app, "/api/spend")).json<Listed>();

const FLYERS = { month: "2026-09", city: "Gurgaon", channel: "partner", amount: 2_500_000, note: "Salon flyers" };

beforeEach(async () => {
  captureLogs();
  await markDatabase();
  await listStaff(GROWTH, ["growth:manage:national"]);
  await listStaff(LOOKER, ["growth:view:national"]);
});

describe("offline spend", () => {
  it("is added for a city or national, listed the latest month first, taken off once, and audited", async () => {
    const growth = opsAs(person(GROWTH));
    const flyers = await (await post(growth, "/api/spend", FLYERS)).json<{ id: string }>();
    await post(growth, "/api/spend", { month: "2026-08", city: null, channel: "organic_social", amount: 1_000_000 });

    const list = await listed(growth);
    expect(list.entries.map((entry) => [entry.month, entry.city, entry.amount])).toEqual([
      ["2026-09", "Gurgaon", 2_500_000],
      ["2026-08", null, 1_000_000],
    ]);
    expect(list).toMatchObject({ this_month: "2026-09", first_month: "2025-09" });

    expect((await post(growth, `/api/spend/${flyers.id}/remove`)).status).toBe(200);
    expect((await post(growth, `/api/spend/${flyers.id}/remove`)).status).toBe(404);
    expect((await listed(growth)).entries.map((entry) => entry.month)).toEqual(["2026-08"]);
    const { results } = await env.DB.prepare(
      "SELECT action FROM audit_log WHERE action LIKE 'spend.%' ORDER BY id",
    ).all();
    expect(results.map((row) => row.action)).toEqual(["spend.add", "spend.add", "spend.remove"]);
  });

  it("refuses a month past this one or before the list, a city we do not hold, and Google or Meta", async () => {
    const growth = opsAs(person(GROWTH));
    const refused = async (change: object) => (await post(growth, "/api/spend", { ...FLYERS, ...change })).json();
    expect(await refused({ month: "2026-10" })).toMatchObject({ error: { fields: ["month"] } });
    expect(await refused({ month: "2025-08" })).toMatchObject({ error: { fields: ["month"] } });
    expect(await refused({ city: "Atlantis" })).toMatchObject({ error: { fields: ["city"] } });
    expect((await post(growth, "/api/spend", { ...FLYERS, channel: "google_ads" })).status).toBe(400);
  });

  it("is growth's to change once the Staff list is enforced, and to read with a look", async () => {
    await enforce();
    expect((await request(opsAs(person(LOOKER)), "/api/spend")).status).toBe(200);
    expect((await post(opsAs(person(LOOKER)), "/api/spend", FLYERS)).status).toBe(403);
  });
});
