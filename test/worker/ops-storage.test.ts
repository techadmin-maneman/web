// What the console shows of the storage meter (src/routes/ops-storage.ts; docs/decisions/0093-the-storage-meter.md).

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { appFor, fakeDependencies, markDatabase, request } from "./helpers.ts";

beforeEach(async () => {
  await markDatabase();
});

describe("GET /api/storage", () => {
  it("gives what the photographs and cards hold, their share of R2, and the runaway ceiling", async () => {
    await env.DB.prepare("UPDATE storage_meter SET bytes = 1234567890, told_percent = 0").run();
    const answer = await request(appFor("local", fakeDependencies(), {}, "ops"), "/api/storage");
    expect(answer.status).toBe(200);
    expect(await answer.json()).toEqual({ held_bytes: 1_234_567_890, share_bytes: 4e9, ceiling_bytes: 20e9 });
  });

  it("is the console's alone", async () => {
    for (const surface of ["public", "client", "tech"] as const) {
      expect((await request(appFor("local", fakeDependencies(), {}, surface), "/api/storage")).status, surface).toBe(
        404,
      );
    }
  });
});
