import { env } from "cloudflare:workers";
import { describe, expect, it, vi } from "vitest";
import { REQUEST_ID_HEADER, type App } from "../../src/http/context.ts";
import { ErrorResponseSchema } from "../../src/http/errors.ts";
import {
  appFor,
  captureLogs,
  countRowsRead,
  d1TripsOf,
  fakeDependencies,
  markDatabase,
  request,
} from "./helpers.ts";

describe("errors", () => {
  it("answers an unknown API route with a stable code and the request ID", async () => {
    await markDatabase();
    captureLogs();

    const res = await request(appFor(), "/api/does-not-exist");

    expect(res.status).toBe(404);
    const body = ErrorResponseSchema.parse(await res.json());
    expect(body.error.code).toBe("not_found");
    expect(body.error.request_id).toBe(res.headers.get(REQUEST_ID_HEADER));
  });

  it("never returns an internal error's message or stack", async () => {
    await markDatabase();
    const logs = captureLogs();
    const app = appFor();
    app.get("/api/boom", () => {
      throw new Error("upstream rejected +91 98765 43210 (dev@example.com)");
    });

    const res = await request(app, "/api/boom");

    expect(res.status).toBe(500);
    const text = await res.text();
    expect(ErrorResponseSchema.parse(JSON.parse(text)).error.code).toBe("internal_error");
    expect(text).not.toMatch(/upstream|98765|example\.com|at /);
    const logged = JSON.stringify(logs.lines());
    expect(logged).toContain("unhandled_error");
    expect(logged).not.toMatch(/98765|dev@example\.com/);
  });
});

describe("database identity gate", () => {
  it("blocks API routes while the database is unmarked", async () => {
    captureLogs();
    const res = await request(appFor(), "/api/does-not-exist");

    expect(res.status).toBe(503);
    expect(ErrorResponseSchema.parse(await res.json()).error.code).toBe("environment_mismatch");
  });

  it("blocks API routes when the database belongs to another environment", async () => {
    captureLogs();
    await markDatabase("maneman-staging");

    const res = await request(appFor(), "/api/does-not-exist");

    expect(res.status).toBe(503);
    expect(ErrorResponseSchema.parse(await res.json()).error.code).toBe("environment_mismatch");
  });

  it("answers unavailable when the database cannot be queried", async () => {
    captureLogs();
    await env.DB.exec("DROP TABLE deployment_identity");

    const res = await request(appFor(), "/api/does-not-exist");

    expect(res.status).toBe(503);
    expect(ErrorResponseSchema.parse(await res.json()).error.code).toBe("unavailable");
  });

  it("re-checks after a failure, so marking the database takes effect without a redeploy", async () => {
    captureLogs();
    const app = appFor();
    expect((await request(app, "/api/does-not-exist")).status).toBe(503);

    await markDatabase();

    expect((await request(app, "/api/does-not-exist")).status).toBe(404);
  });

  it("caches a successful check for the life of the isolate", async () => {
    captureLogs();
    await markDatabase();
    const app = appFor();
    expect((await request(app, "/api/does-not-exist")).status).toBe(404);

    await env.DB.exec("DROP TABLE deployment_identity");

    expect((await request(app, "/api/does-not-exist")).status).toBe(404);
  });

  it("does not gate paths outside /api", async () => {
    captureLogs();
    const res = await request(appFor(), "/anything-else");
    expect(res.status).toBe(404);
  });
});

describe("response headers", () => {
  it("marks non-production responses noindex", async () => {
    await markDatabase("maneman-staging");
    const res = await request(appFor("staging"), "/api/health");
    expect(res.headers.get("X-Robots-Tag")).toBe("noindex, nofollow");
  });

  it("leaves production responses indexable and uncached", async () => {
    await markDatabase("maneman-prod");
    const res = await request(appFor("production"), "/api/health");
    expect(res.status).toBe(200);
    expect(res.headers.get("X-Robots-Tag")).toBeNull();
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
  });

  it("keeps a Cache-Control header a route sets itself", async () => {
    await markDatabase();
    const app = appFor();
    app.get("/api/cacheable", (c) => c.json({}, 200, { "Cache-Control": "public, max-age=300" }));

    const res = await request(app, "/api/cacheable");

    expect(res.headers.get("Cache-Control")).toBe("public, max-age=300");
  });
});

describe("access log", () => {
  it("logs the route pattern, never the raw path, which can carry tokens", async () => {
    await markDatabase();
    const logs = captureLogs();
    await request(appFor(), "/api/result/tok_supersecret");

    const access = logs.lines().find((line) => line.event === "request");
    expect(access).toMatchObject({ method: "GET", route: "/api/result/:token", status: 404 });
    expect(typeof access?.request_id).toBe("string");
    expect(JSON.stringify(logs.lines())).not.toContain("tok_supersecret");
  });

  it("says what the request cost D1: the rows it read and wrote, and its statements", async () => {
    await markDatabase();
    const app = appFor();
    app.get("/api/costly", async (c) => {
      await c.env.DB.prepare("INSERT INTO cities (name, served, sort) VALUES ('Pune', 0, 90), ('Jaipur', 0, 91)").run();
      const { results } = await c.env.DB.prepare("SELECT name FROM cities").all();
      return c.json({ cities: results.length });
    });
    const logs = captureLogs();
    const rowsRead = countRowsRead();

    await request(app, "/api/costly");
    const access = logs.lines().find((line) => line.event === "request");
    const read = rowsRead();
    vi.restoreAllMocks();

    expect(access).toMatchObject({ route: "/api/costly", d1_rows_read: read });
    expect(access?.d1_rows_read).toBeGreaterThanOrEqual(2);
    expect(access?.d1_rows_written).toBeGreaterThanOrEqual(2);
    expect(access?.d1_queries).toBeGreaterThanOrEqual(2);
    expect(access?.d1_trips).toBeGreaterThanOrEqual(2);
    expect(typeof access?.d1_wait_ms).toBe("number");
  });

  // PLAT-15: how long a request waited on D1, in a browser's network panel. Not on the public host, where it could
  // tell a number we know from a new one by the trips its answer took.
  it("tells a signed-in host's browser how many round trips to D1 it waited on, and the public host's nothing", async () => {
    await markDatabase();
    const waitTwice = (app: App) => {
      app.get("/api/waits", async (c) => {
        await Promise.all([c.env.DB.prepare("SELECT 1").first(), c.env.DB.prepare("SELECT 2").first()]);
        await c.env.DB.prepare("SELECT 3").first();
        return c.json({});
      });
      return app;
    };
    const signedIn = waitTwice(appFor("local", fakeDependencies(), {}, "client"));
    const site = waitTwice(appFor());

    await request(signedIn, "/api/waits");
    const answer = await request(signedIn, "/api/waits");

    expect(answer.headers.get("server-timing")).toMatch(/^d1;dur=\d+;desc="\d+ round trips"$/);
    expect(d1TripsOf(answer)).toBe(2);
    expect((await request(site, "/api/waits")).headers.get("server-timing")).toBeNull();
  });
});
