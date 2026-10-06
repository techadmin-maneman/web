// The storage meter (src/domain/storage-meter.ts; docs/decisions/0093-the-storage-meter.md): what the apps' two
// buckets hold, counted as each object is stored and deleted, and ops told once at each mark of the share.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import {
  deleteCounted,
  deleteUnder,
  putCounted,
  readDatabaseBytes,
  readMeter,
  tellOfDatabaseSize,
  tellOfStorage,
} from "../../../src/domain/storage-meter.ts";
import { DATABASE_LIMIT_BYTES } from "../../../src/policy/database-size.ts";
import { SHARE_BYTES } from "../../../src/policy/storage-share.ts";

/** Production's part of the share: 3.6 GB. */
const SHARE = SHARE_BYTES.production;
import { fakeDependencies, markDatabase, type TestDependencies } from "../helpers.ts";

let deps: TestDependencies;

beforeEach(async () => {
  await markDatabase();
  deps = fakeDependencies();
});

const bytes = (length: number) => new Uint8Array(length).fill(7);
const held = async () => (await readMeter(env.DB)).bytes;
const setMeter = (value: number) => env.DB.prepare("UPDATE storage_meter SET bytes = ?1").bind(value).run();

describe("counting what is stored", () => {
  it("adds each object as it is stored, in either bucket", async () => {
    await putCounted(env.DB, env.CLIENT_PHOTOS, "visits/a1/after-front-1.jpg", bytes(1200), "image/jpeg");
    await putCounted(env.DB, env.REFERRAL_CARDS, "cards/ROHIT7/v2.jpg", bytes(300), "image/jpeg");
    expect(await held()).toBe(1500);
    expect((await env.CLIENT_PHOTOS.head("visits/a1/after-front-1.jpg"))?.httpMetadata?.contentType).toBe("image/jpeg");
  });

  it("takes off what a deleted object held, and nothing for a key that holds nothing", async () => {
    await putCounted(env.DB, env.CLIENT_PHOTOS, "tryons/j1/before.jpg", bytes(900), "image/jpeg");
    await putCounted(env.DB, env.CLIENT_PHOTOS, "tryons/j2/before.jpg", bytes(400), "image/jpeg");

    await deleteCounted(env.DB, env.CLIENT_PHOTOS, [
      "tryons/j1/before.jpg",
      "tryons/j1/look.png",
      "tryons/j1/before.jpg",
    ]);

    expect(await held()).toBe(400);
    expect(await env.CLIENT_PHOTOS.head("tryons/j1/before.jpg")).toBeNull();
  });

  it("finds everything under a visit's prefix, a photograph taken again and every small copy with it", async () => {
    await putCounted(env.DB, env.CLIENT_PHOTOS, "visits/a1/after-front-1.jpg", bytes(1000), "image/jpeg");
    await putCounted(env.DB, env.CLIENT_PHOTOS, "visits/a1/after-front-1-small.jpg", bytes(40), "image/jpeg");
    await putCounted(env.DB, env.CLIENT_PHOTOS, "visits/a1/after-front-2.jpg", bytes(1100), "image/jpeg");
    await putCounted(env.DB, env.CLIENT_PHOTOS, "visits/a2/after-front-3.jpg", bytes(700), "image/jpeg");

    await deleteUnder(env.DB, env.CLIENT_PHOTOS, ["visits/a1/"]);

    expect(await held()).toBe(700);
    expect((await env.CLIENT_PHOTOS.list({ prefix: "visits/" })).objects.map((object) => object.key)).toEqual([
      "visits/a2/after-front-3.jpg",
    ]);
  });

  it("takes nothing off for an object it never counted", async () => {
    await putCounted(env.DB, env.CLIENT_PHOTOS, "visits/a1/counted.jpg", bytes(300), "image/jpeg");
    await env.CLIENT_PHOTOS.put("visits/a1/uncounted.jpg", bytes(500));
    await deleteCounted(env.DB, env.CLIENT_PHOTOS, ["visits/a1/uncounted.jpg"]);
    expect(await held()).toBe(300);
    expect(await env.CLIENT_PHOTOS.head("visits/a1/uncounted.jpg")).toBeNull();
  });

  // R2 replaces an object stored again under its key: a sweep or a queue message retried after its store.
  it("counts an object stored again under the same key as what it holds now, not twice", async () => {
    await putCounted(env.DB, env.CLIENT_PHOTOS, "tryons/j1/look.png", bytes(5000), "image/png");
    await putCounted(env.DB, env.CLIENT_PHOTOS, "tryons/j1/look.png", bytes(5000), "image/png");
    expect(await held()).toBe(5000);
    await putCounted(env.DB, env.CLIENT_PHOTOS, "tryons/j1/look.png", bytes(3000), "image/png");
    expect(await held()).toBe(3000);
  });

  it("takes an object off once when two deletes of it race, as an erasure and the sweeper can", async () => {
    await putCounted(env.DB, env.CLIENT_PHOTOS, "tryons/j1/before.jpg", bytes(900), "image/jpeg");
    await putCounted(env.DB, env.CLIENT_PHOTOS, "tryons/j2/before.jpg", bytes(400), "image/jpeg");
    await Promise.all([
      deleteCounted(env.DB, env.CLIENT_PHOTOS, ["tryons/j1/before.jpg"]),
      deleteCounted(env.DB, env.CLIENT_PHOTOS, ["tryons/j1/before.jpg"]),
    ]);
    expect(await held()).toBe(400);
  });

  it("reads no object to learn its size", async () => {
    await putCounted(env.DB, env.CLIENT_PHOTOS, "tryons/j1/before.jpg", bytes(900), "image/jpeg");
    const photos = env.CLIENT_PHOTOS;
    const bucket = {
      put: (key: string, value: Uint8Array, options: R2PutOptions) => photos.put(key, value, options),
      delete: (keys: string[]) => photos.delete(keys),
      head: () => Promise.reject(new Error("a head read, which costs a Class B operation")),
    } as unknown as R2Bucket;
    await putCounted(env.DB, bucket, "tryons/j1/before.jpg", bytes(800), "image/jpeg");
    await deleteCounted(env.DB, bucket, ["tryons/j1/before.jpg"]);
    expect(await held()).toBe(0);
  });
});

describe("telling ops", () => {
  it("says nothing below half the share", async () => {
    await setMeter(SHARE / 2 - 1);
    await tellOfStorage(env.DB, deps.alertOnce, "production");
    expect(deps.alerts).toEqual([]);
  });

  it("tells once at half the share, and not again on the next run", async () => {
    await setMeter(SHARE / 2);
    await tellOfStorage(env.DB, deps.alertOnce, "production");
    await tellOfStorage(env.DB, deps.alertOnce, "production");
    expect(deps.alerts).toEqual([
      expect.stringContaining("Photos and referral cards use 1.80 GB, half of their 3.6 GB of free storage"),
    ]);
    expect((await readMeter(env.DB)).toldPercent).toBe(50);
  });

  it("tells again at 80%, and once more when the share is full, saying uploads go on", async () => {
    await setMeter(SHARE / 2);
    await tellOfStorage(env.DB, deps.alertOnce, "production");
    await setMeter(SHARE * 0.8);
    await tellOfStorage(env.DB, deps.alertOnce, "production");
    await setMeter(SHARE);
    await tellOfStorage(env.DB, deps.alertOnce, "production");
    await tellOfStorage(env.DB, deps.alertOnce, "production");

    expect(deps.alerts).toHaveLength(3);
    expect(deps.alerts[1]).toContain("80% of their 3.6 GB of free storage");
    expect(deps.alerts[2]).toContain("all of their 3.6 GB of free storage");
    expect(deps.alerts[2]).toContain("Uploads go on");
    const { results } = await env.DB.prepare("SELECT key FROM alerts ORDER BY first_seen_at, key").all<{
      key: string;
    }>();
    expect(results.map((row) => row.key).sort()).toEqual(["r2_share:100", "r2_share:50", "r2_share:80"]);
  });

  it("tells only the highest mark passed since the last run", async () => {
    await setMeter(SHARE * 0.85);
    await tellOfStorage(env.DB, deps.alertOnce, "production");
    expect(deps.alerts).toEqual([expect.stringContaining("80% of their 3.6 GB of free storage")]);
  });

  // The figure moved from the top of Settings to The console's section of Rules.
  it("links to where Settings shows the figure", async () => {
    await setMeter(SHARE / 2);
    await tellOfStorage(env.DB, deps.alertOnce, "production");
    await tellOfDatabaseSize(env.DB, deps.alertOnce, 5e9);
    expect(deps.alerts).toEqual([
      expect.stringMatching(/\/settings#console$/),
      expect.stringMatching(/\/settings#console$/),
    ]);
  });
});

// Nothing read the database's size, and past D1's limit every write fails.
describe("the database's size", () => {
  it("is what D1 says the database holds", async () => {
    expect(await readDatabaseBytes(env.DB)).toBeGreaterThan(0);
  });

  it("says nothing below half the limit", async () => {
    await tellOfDatabaseSize(env.DB, deps.alertOnce, DATABASE_LIMIT_BYTES / 2 - 1);
    expect(deps.alerts).toEqual([]);
  });

  it("tells once at each of half, 80% and 95% of the limit, and not again on the next run", async () => {
    await tellOfDatabaseSize(env.DB, deps.alertOnce, 5e9);
    await tellOfDatabaseSize(env.DB, deps.alertOnce, 5.2e9);
    await tellOfDatabaseSize(env.DB, deps.alertOnce, 8e9);
    await tellOfDatabaseSize(env.DB, deps.alertOnce, 9.6e9);
    await tellOfDatabaseSize(env.DB, deps.alertOnce, 9.8e9);

    expect(deps.alerts).toEqual([
      expect.stringContaining("The database holds 5.00 GB, 50% of the 10 GB"),
      expect.stringContaining("The database holds 8.00 GB, 80% of the 10 GB"),
      expect.stringContaining("The database holds 9.60 GB, 95% of the 10 GB"),
    ]);
    const { results } = await env.DB.prepare("SELECT key FROM alerts WHERE key LIKE 'd1_size:%'").all<{
      key: string;
    }>();
    expect(results.map((row) => row.key).sort()).toEqual(["d1_size:50", "d1_size:80", "d1_size:95"]);
  });

  it("tells only the highest mark passed since the last run, and leaves R2's marks alone", async () => {
    await tellOfDatabaseSize(env.DB, deps.alertOnce, 8.4e9);
    expect(deps.alerts).toEqual([expect.stringContaining("80% of the 10 GB")]);
    expect((await readMeter(env.DB)).toldPercent).toBe(0);
  });
});
