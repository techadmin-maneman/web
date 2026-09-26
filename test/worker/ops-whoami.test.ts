// Who is signed in to the ops console (src/routes/ops-whoami.ts). The console
// holds no session of its own: Cloudflare Access does, and this names the
// identity behind it so the console can say who is working, and how to leave.

import { beforeEach, describe, expect, it } from "vitest";
import { appFor, fakeDependencies, markDatabase, request } from "./helpers.ts";

const ACCESS = { teamDomain: "maneman.cloudflareaccess.com", opsAudience: "ops-audience" };

beforeEach(async () => {
  await markDatabase();
});

describe("GET /api/whoami", () => {
  it("names the member of staff Access let through, and where signing out goes", async () => {
    const ops = appFor("local", fakeDependencies(), { access: ACCESS }, "ops");
    const answer = await request(ops, "/api/whoami");
    expect(answer.status).toBe(200);
    expect(await answer.json()).toEqual({ signed_in_as: "ops@localhost", sign_out: "/cdn-cgi/access/logout" });
  });

  it("offers no way out where no Access stands in front, as on a laptop", async () => {
    const ops = appFor("local", fakeDependencies(), {}, "ops");
    expect(await (await request(ops, "/api/whoami")).json()).toEqual({ signed_in_as: "ops@localhost", sign_out: null });
  });

  it("is not a route of any other surface", async () => {
    for (const surface of ["public", "client", "tech"] as const) {
      expect((await request(appFor("local", fakeDependencies(), {}, surface), "/api/whoami")).status, surface).toBe(
        404,
      );
    }
  });
});
