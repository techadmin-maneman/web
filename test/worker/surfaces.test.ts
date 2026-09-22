// Each surface answers on its own host only, and a host the environment does
// not serve gets a bare 404 (docs/decisions/0026-hosts-and-surfaces.md).

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import type { App } from "../../src/app.ts";
import { EXPECTED_DATABASE_NAME, SURFACES, type Surface } from "../../src/config/environments.ts";
import { ErrorResponseSchema } from "../../src/http/errors.ts";
import { byHost, surfaceOf } from "../../src/http/surfaces.ts";
import worker from "../../src/index.ts";
import { HealthSchema } from "../../src/routes/health.ts";
import { appFor, captureLogs, markDatabase } from "./helpers.ts";

const LOCAL_ORIGINS: Readonly<Record<Surface, string>> = {
  public: "http://localhost:8787",
  client: "http://app.localhost:8787",
  ops: "http://ops.localhost:8787",
  tech: "http://tech.localhost:8787",
};

let logs: ReturnType<typeof captureLogs>;

beforeEach(() => {
  logs = captureLogs();
});

describe("surfaceOf", () => {
  it("locally, gives app., ops. and tech.localhost their surfaces and every other host the public site", () => {
    expect(surfaceOf("app.localhost", "local")).toBe("client");
    expect(surfaceOf("ops.localhost", "local")).toBe("ops");
    expect(surfaceOf("tech.localhost", "local")).toBe("tech");
    expect(surfaceOf("localhost", "local")).toBe("public");
    expect(surfaceOf("127.0.0.1", "local")).toBe("public");
    expect(surfaceOf("shop.localhost", "local")).toBe("public");
  });

  it("on staging, serves the public host alone until the other surfaces are switched on", () => {
    expect(surfaceOf("staging.maneman.in", "staging")).toBe("public");
    expect(surfaceOf("app-staging.maneman.in", "staging")).toBeNull();
    expect(surfaceOf("ops-staging.maneman.in", "staging")).toBeNull();
    expect(surfaceOf("tech-staging.maneman.in", "staging")).toBeNull();
  });

  it("never answers for the other environment's host, or a host that is not ours", () => {
    expect(surfaceOf("maneman.in", "staging")).toBeNull();
    expect(surfaceOf("staging.maneman.in", "production")).toBeNull();
    expect(surfaceOf("maneman.in", "production")).toBe("public");
    expect(surfaceOf("maneman.in.example.com", "production")).toBeNull();
    expect(surfaceOf("localhost", "production")).toBeNull();
  });
});

describe("the Worker, locally", () => {
  beforeEach(async () => {
    await markDatabase();
  });

  it.each(SURFACES)("answers /api/health on the %s host, from that surface's app", async (surface) => {
    const res = await worker.fetch(new Request(`${LOCAL_ORIGINS[surface]}/api/health`), env);

    expect(res.status).toBe(200);
    expect(HealthSchema.parse(await res.json()).status).toBe("ok");
    const access = logs.lines().find((line) => line.event === "request");
    expect(access).toMatchObject({ surface, route: "/api/health" });
  });

  it.each(SURFACES.filter((surface) => surface !== "public"))(
    "answers every public route with a 404 on the %s host, even from its own origin",
    async (surface) => {
      const routes = publicRoutes();
      expect(routes.length).toBeGreaterThan(5);

      for (const { method, path } of routes) {
        const origin = LOCAL_ORIGINS[surface];
        const res = await worker.fetch(
          new Request(`${origin}${path}`, { method, headers: { Origin: origin, "Content-Type": "application/json" } }),
          env,
        );
        expect(res.status, `${method} ${path}`).toBe(404);
        expect(await res.json()).toMatchObject({ error: { code: "not_found" } });
      }
    },
  );
});

describe("byHost, on staging", () => {
  beforeEach(async () => {
    await markDatabase(EXPECTED_DATABASE_NAME.staging);
  });

  const apps = new Map<Surface, App>([["public", appFor("staging")]]);
  const fetchStaging = byHost(apps, "staging");

  it("sends the public host to the public app", async () => {
    const res = await fetchStaging(new Request("https://staging.maneman.in/api/health"), env);

    expect(res.status).toBe(200);
    expect(HealthSchema.parse(await res.json()).environment).toBe("staging");
  });

  it.each([
    "https://app-staging.maneman.in/api/health",
    "https://maneman.in/api/health",
    "https://staging.maneman.in.example.com/api/health",
  ])("answers %s with a bare 404, never reaching an app", async (url) => {
    const res = await fetchStaging(new Request(url), env);

    expect(res.status).toBe(404);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    const body = ErrorResponseSchema.parse(await res.json());
    expect(body.error.code).toBe("not_found");
    expect(res.headers.get("X-Request-Id")).toBe(body.error.request_id);
    expect(logs.lines().some((line) => line.event === "request")).toBe(false);
  });
});

/** The public app's routes other than the health check, with a placeholder for each path parameter. */
function publicRoutes(): { method: string; path: string }[] {
  const seen = new Set<string>();
  return appFor()
    .routes.filter((route) => route.method !== "ALL" && route.path !== "/api/health")
    .map((route) => ({ method: route.method, path: route.path.replace(/:[^/]+/g, "x") }))
    .filter((route) => {
      const key = `${route.method} ${route.path}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}
