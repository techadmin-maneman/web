// A month's targets, city by city (src/domain/ops/targets.ts, src/routes/ops/targets.ts;
// docs/decisions/0154-targets-and-reporting-access.md). NOW is Monday 21 September 2026 in India.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import type { App } from "../../../src/http/context.ts";
import { captureLogs, markDatabase, request } from "../helpers.ts";
import { enforce, listStaff, opsAs, person } from "../ops/staff-fixtures.ts";

const ADMIN = "admin@maneman.test";
const LOOKER = "looker@maneman.test";

const post = (app: App, path: string, body: unknown) =>
  request(app, path, {
    method: "POST",
    headers: { Origin: "https://maneman.test", "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

interface Month {
  month: string;
  targets: { city: string; measure: string; target: number }[];
  first_month: string;
  last_month: string;
}

const NEW_CLIENTS = { month: "2026-10", city: "Gurgaon", measure: "new_clients", target: 40 };

beforeEach(async () => {
  captureLogs();
  await markDatabase();
  await listStaff(ADMIN, ["admin:manage:national"]);
  await listStaff(LOOKER, ["admin:view:national"]);
});

describe("targets", () => {
  it("are set and set again for a month and a city, read by month, taken off once, and audited", async () => {
    const admin = opsAs(person(ADMIN));
    const now = await (await request(admin, "/api/targets")).json<Month>();
    expect(now).toMatchObject({ month: "2026-09", targets: [], first_month: "2025-09", last_month: "2027-09" });

    await post(admin, "/api/targets", NEW_CLIENTS);
    const again = await (await post(admin, "/api/targets", { ...NEW_CLIENTS, target: 45 })).json<Month>();
    expect(again.targets).toMatchObject([{ city: "Gurgaon", measure: "new_clients", target: 45 }]);
    expect((await (await request(admin, "/api/targets?month=2026-10")).json<Month>()).targets).toHaveLength(1);

    const which = { month: "2026-10", city: "Gurgaon", measure: "new_clients" };
    expect((await post(admin, "/api/targets/remove", which)).status).toBe(200);
    expect((await post(admin, "/api/targets/remove", which)).status).toBe(404);
    const { results } = await env.DB.prepare(
      "SELECT action FROM audit_log WHERE action LIKE 'target.%' ORDER BY id",
    ).all();
    expect(results.map((row) => row.action)).toEqual(["target.set", "target.set", "target.remove"]);
  });

  it("refuse a month outside the year either side, a city we do not hold, and a percentage past a hundred", async () => {
    const admin = opsAs(person(ADMIN));
    const refused = async (change: object) => (await post(admin, "/api/targets", { ...NEW_CLIENTS, ...change })).json();
    expect(await refused({ month: "2027-10" })).toMatchObject({ error: { fields: ["month"] } });
    expect(await refused({ city: "Atlantis" })).toMatchObject({ error: { fields: ["city"] } });
    expect(await refused({ measure: "on_time", target: 101 })).toMatchObject({ error: { fields: ["target"] } });
  });

  it("are Admin's to set once the Staff list is enforced, and to read with a look", async () => {
    await enforce();
    expect((await request(opsAs(person(LOOKER)), "/api/targets")).status).toBe(200);
    expect((await post(opsAs(person(LOOKER)), "/api/targets", NEW_CLIENTS)).status).toBe(403);
  });
});
