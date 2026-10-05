// The Phase 2 surfaces refuse a write from any origin but their own
// (docs/decisions/0026-hosts-and-surfaces.md).

import { beforeEach, describe, expect, it } from "vitest";
import type { App } from "../../../src/http/context.ts";
import type { Surface } from "../../../src/config/environments.ts";
import { appFor, captureLogs, fakeDependencies, markDatabase, request } from "../helpers.ts";

const OWN_ORIGIN = "https://maneman.test"; // the origin helpers.request() uses

let logs: ReturnType<typeof captureLogs>;

beforeEach(async () => {
  logs = captureLogs();
  await markDatabase();
});

/** A surface's app with one write route and one read route to aim at. */
function appWithRoutes(surface: Surface): App {
  const app = appFor("local", fakeDependencies(), {}, surface);
  app.post("/api/probe", (c) => c.json({ ok: true }));
  app.get("/api/probe", (c) => c.json({ ok: true }));
  return app;
}

describe("a Phase 2 surface", () => {
  it("accepts a write from its own origin", async () => {
    const res = await request(appWithRoutes("client"), "/api/probe", {
      method: "POST",
      headers: { Origin: OWN_ORIGIN },
    });
    expect(res.status).toBe(200);
  });

  it.each<[string, Record<string, string>]>([
    ["no Origin", {}],
    ["another surface's origin", { Origin: "https://ops.maneman.test" }],
    ["the same host over http", { Origin: "http://maneman.test" }],
    ["an opaque origin", { Origin: "null" }],
  ])("refuses a write with %s", async (_label, headers) => {
    const res = await request(appWithRoutes("client"), "/api/probe", { method: "POST", headers });

    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: { code: "forbidden_origin" } });
    expect(logs.lines()).toContainEqual(
      expect.objectContaining({ event: "cross_origin_write_refused", has_origin: "Origin" in headers }),
    );
  });

  it.each(["ops", "tech"] as const)("on the %s host refuses a write from elsewhere too", async (surface) => {
    const res = await request(appWithRoutes(surface), "/api/probe", { method: "DELETE" });
    expect(res.status).toBe(403);
  });

  it("lets a read through without an Origin, as browsers send none on a same-origin GET", async () => {
    const res = await request(appWithRoutes("client"), "/api/probe");
    expect(res.status).toBe(200);
  });
});

describe("the public site", () => {
  it("leaves writes to Turnstile and does not check the Origin", async () => {
    const res = await request(appWithRoutes("public"), "/api/probe", { method: "POST" });
    expect(res.status).toBe(200);
  });
});
