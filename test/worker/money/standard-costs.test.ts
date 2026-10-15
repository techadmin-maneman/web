// What each hair system costs us (src/domain/money/standard-costs.ts, src/routes/ops/standard-costs.ts;
// docs/decisions/0152-standard-costs.md): Finance set a product's cost from today, and a later one never rewrites it.
// NOW is Monday 21 September 2026 in India.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import type { App } from "../../../src/http/context.ts";
import { captureLogs, markDatabase, request } from "../helpers.ts";
import { enforce, listStaff, opsAs, person } from "../ops/staff-fixtures.ts";

const FINANCE = "finance@maneman.test";
const LOOKER = "looker@maneman.test";

const post = (app: App, body: unknown) =>
  request(app, "/api/standard-costs", {
    method: "POST",
    headers: { Origin: "https://maneman.test", "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

interface Products {
  products: { item: string; tier: string; cost: number | null; since: string | null }[];
}

const products = async (app: App) => (await (await request(app, "/api/standard-costs")).json<Products>()).products;

beforeEach(async () => {
  captureLogs();
  await markDatabase();
  await listStaff(FINANCE, ["finance:manage:national"]);
  await listStaff(LOOKER, ["finance:view:national"]);
});

describe("hair system costs", () => {
  it("list each first fit and replacement product, and take a cost from today, audited", async () => {
    const finance = opsAs(person(FINANCE));
    const listed = await products(finance);
    expect(listed.length).toBeGreaterThan(0);
    expect(new Set(listed.map((product) => product.item))).toEqual(new Set(["first_fit", "replacement"]));
    const [first] = listed;
    expect(first?.cost).toBeNull();

    const answer = await post(finance, { item: first?.item, tier: first?.tier, cost: 600000 });
    expect(answer.status).toBe(200);
    expect((await answer.json<Products>()).products[0]).toMatchObject({ cost: 600000, since: "2026-09-21" });
    await post(finance, { item: first?.item, tier: first?.tier, cost: 650000 });
    const { results } = await env.DB.prepare("SELECT cost FROM standard_costs").all();
    expect(results).toEqual([{ cost: 650000 }]);
    const audited = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM audit_log WHERE action = 'standard_cost.set'",
    ).first();
    expect(audited).toEqual({ n: 2 });
  });

  it("refuses a product no longer sold, and is Finance's to change once the Staff list is enforced", async () => {
    expect((await post(opsAs(person(FINANCE)), { item: "first_fit", tier: "nonesuch", cost: 1 })).status).toBe(404);
    await enforce();
    expect((await request(opsAs(person(LOOKER)), "/api/standard-costs")).status).toBe(200);
    expect((await post(opsAs(person(LOOKER)), { item: "first_fit", tier: "standard", cost: 1 })).status).toBe(403);
  });
});
