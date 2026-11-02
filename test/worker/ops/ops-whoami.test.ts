// Who is signed in to the ops console (src/routes/ops/whoami.ts). The console
// holds no session of its own: Cloudflare Access does, and this names the
// identity behind it so the console can say who is working, how to leave, what
// the Staff list lets them do, and which cities its pages can be narrowed to.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { ROUTE_NEEDS } from "../../../src/policy/console-routes.ts";
import { appFor, fakeDependencies, markDatabase, request } from "../helpers.ts";

const ACCESS = { teamDomain: "maneman.cloudflareaccess.com", opsAudience: "ops-audience" };
/** A fresh database lists nobody and does not enforce the list; with no bootstrap admin, every call goes ahead. */
const NOT_LISTED = { enforced: false, listed: false, grants: [], may_call: Object.keys(ROUTE_NEEDS) };

beforeEach(async () => {
  await markDatabase();
  // No city served and no technician at work, unless a test says otherwise.
  await env.DB.prepare("UPDATE cities SET served = 0").run();
});

describe("GET /api/whoami", () => {
  it("names the member of staff Access let through, and where signing out goes", async () => {
    const ops = appFor("local", fakeDependencies(), { access: ACCESS, staffBootstrapAdmins: [] }, "ops");
    const answer = await request(ops, "/api/whoami");
    expect(answer.status).toBe(200);
    expect(await answer.json()).toEqual({
      signed_in_as: "ops@localhost",
      sign_out: "/cdn-cgi/access/logout",
      staff: NOT_LISTED,
      cities: [],
    });
  });

  it("offers no way out where no Access stands in front, as on a laptop", async () => {
    const ops = appFor("local", fakeDependencies(), { staffBootstrapAdmins: [] }, "ops");
    expect(await (await request(ops, "/api/whoami")).json()).toEqual({
      signed_in_as: "ops@localhost",
      sign_out: null,
      staff: NOT_LISTED,
      cities: [],
    });
  });

  it("offers the cities served, in the console's order, and none that is not", async () => {
    await env.DB.prepare("UPDATE cities SET served = 1 WHERE name IN ('Delhi', 'Gurgaon')").run();
    const ops = appFor("local", fakeDependencies(), { staffBootstrapAdmins: [] }, "ops");
    const { cities } = await (await request(ops, "/api/whoami")).json<{ cities: string[] }>();
    const order = await env.DB.prepare(
      "SELECT name FROM cities WHERE name IN ('Delhi', 'Gurgaon') ORDER BY sort, name",
    ).all<{ name: string }>();
    expect(cities).toEqual(order.results.map((row) => row.name));
  });

  it("is not a route of any other surface", async () => {
    for (const surface of ["public", "client", "tech"] as const) {
      expect((await request(appFor("local", fakeDependencies(), {}, surface), "/api/whoami")).status, surface).toBe(
        404,
      );
    }
  });
});
