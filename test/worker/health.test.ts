import { env, exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { REQUEST_ID_HEADER } from "../../src/http/context.ts";
import { createLogger } from "../../src/log.ts";
import { HealthSchema } from "../../src/routes/health.ts";
import { runCronJobs } from "../../src/scheduled/cron.ts";
import { LOCAL_CONFIG, NOW, appFor, captureLogs, fakeDependencies, markDatabase, request } from "./helpers.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe("GET /api/health", () => {
  it("reports the environment, the version and a correctly marked database, through the real entry point", async () => {
    await markDatabase();

    const res = await exports.default.fetch("https://maneman.test/api/health");

    expect(res.status).toBe(200);
    const body = HealthSchema.parse(await res.json());
    expect(body).toMatchObject({ status: "ok", environment: "local", d1: "ok" });
    expect(body.version_id).toBe(env.CF_VERSION_METADATA.id);
    expect(res.headers.get(REQUEST_ID_HEADER)).toMatch(UUID);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });

  it("is unavailable when the database has no identity row", async () => {
    captureLogs();
    const res = await request(appFor(), "/api/health");

    expect(res.status).toBe(503);
    expect(HealthSchema.parse(await res.json())).toMatchObject({ status: "unavailable", d1: "unmarked" });
  });

  it("is unavailable when the database belongs to another environment", async () => {
    captureLogs();
    await markDatabase("maneman-prod");

    const res = await request(appFor(), "/api/health");

    expect(res.status).toBe(503);
    expect(HealthSchema.parse(await res.json())).toMatchObject({ status: "unavailable", d1: "mismatch" });
  });

  it("reports a staging Worker on the local database as a mismatch", async () => {
    captureLogs();
    await markDatabase();

    const res = await request(appFor("staging"), "/api/health");

    expect(res.status).toBe(503);
    expect(HealthSchema.parse(await res.json())).toMatchObject({ environment: "staging", d1: "mismatch" });
  });

  it("is unavailable when the database cannot be queried", async () => {
    const logs = captureLogs();
    await env.DB.exec("DROP TABLE deployment_identity");

    const res = await request(appFor(), "/api/health");

    expect(res.status).toBe(503);
    expect(HealthSchema.parse(await res.json())).toMatchObject({ d1: "unreachable" });
    expect(logs.lines().some((line) => line.event === "health_unavailable")).toBe(true);
  });

  // PLAT-42: a cron that never ran looked the same as one that never failed.
  it("says when the cron last finished a run, which the status does not depend on", async () => {
    await markDatabase();
    const before = HealthSchema.parse(await (await request(appFor(), "/api/health")).json());
    expect(before).toMatchObject({ status: "ok", cron_completed_at: null });

    await runCronJobs([], { env, deps: fakeDependencies(), config: LOCAL_CONFIG, log: createLogger() });

    const after = HealthSchema.parse(await (await request(appFor(), "/api/health")).json());
    expect(after).toMatchObject({ status: "ok", cron_completed_at: NOW.toISOString() });
  });

  it("stays healthy when the cron's record cannot be read", async () => {
    captureLogs();
    await markDatabase();
    await env.DB.exec("DROP TABLE cron_runs");

    const res = await request(appFor(), "/api/health");

    expect(res.status).toBe(200);
    expect(HealthSchema.parse(await res.json())).toMatchObject({ status: "ok", cron_completed_at: null });
  });

  it("reports the upload tag when the version has one", async () => {
    await markDatabase();
    const tagged = { ...env, CF_VERSION_METADATA: { id: "v-1", tag: "abc1234", timestamp: "" } };

    const res = await appFor().request("https://maneman.test/api/health", {}, tagged);

    expect(HealthSchema.parse(await res.json())).toMatchObject({ version_id: "v-1", version_tag: "abc1234" });
  });
});
