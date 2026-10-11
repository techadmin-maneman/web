// The weekly backup end to end: written by the Worker's own code over the migrated schema, read back by the restore
// script's, and loaded into an empty database.

import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { backupDueOn, deleteOldBackups, writeBackup } from "../../../src/domain/platform/backups.ts";
import { backupKeyOf, Manifest, privateKeyOf, rowsIn, sqlFor, toBase64 } from "../../../scripts/lib/backup-restore.ts";
import { asD1, migratedDatabase } from "../d1-over-sqlite.ts";

/** An R2 bucket of in-memory objects, as much of one as the backup uses. */
function memoryBucket() {
  const objects = new Map<string, Uint8Array>();
  const bucket = {
    head: (key: string) => Promise.resolve(objects.has(key) ? {} : null),
    put: async (key: string, body: ArrayBuffer | string) => {
      objects.set(key, typeof body === "string" ? new TextEncoder().encode(body) : new Uint8Array(body));
      return Promise.resolve({});
    },
    list: (options: { prefix?: string; delimiter?: string }) => {
      const keys = [...objects.keys()].filter((key) => key.startsWith(options.prefix ?? ""));
      const folders = [...new Set(keys.map((key) => `${key.split("/")[0] ?? ""}/`))];
      return Promise.resolve({ objects: keys.map((key) => ({ key })), delimitedPrefixes: folders });
    },
    delete: (keys: string[]) => {
      for (const key of keys) objects.delete(key);
      return Promise.resolve();
    },
  };
  return { bucket: bucket as unknown as R2Bucket, objects };
}

async function keyPair() {
  const pair = await crypto.subtle.generateKey(
    { name: "RSA-OAEP", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["wrapKey", "unwrapKey"],
  );
  if (!("publicKey" in pair)) throw new Error("RSA-OAEP makes a key pair");
  const publicKey = toBase64(await crypto.subtle.exportKey("spki", pair.publicKey));
  const pem = `-----BEGIN PRIVATE KEY-----\n${toBase64(await crypto.subtle.exportKey("pkcs8", pair.privateKey))}\n-----END PRIVATE KEY-----`;
  return { publicKey, pem };
}

const SUNDAY_3_30_IST = new Date("2026-10-10T22:00:00Z");

describe("the weekly backup", () => {
  it("is due in the hour from 3 am in India on Sundays, and at no other time", () => {
    expect(backupDueOn(SUNDAY_3_30_IST)).toBe("2026-10-11");
    expect(backupDueOn(new Date("2026-10-10T22:31:00Z"))).toBeNull();
    expect(backupDueOn(new Date("2026-10-03T22:00:00Z"))).toBe("2026-10-04");
    expect(backupDueOn(new Date("2026-10-09T22:00:00Z"))).toBeNull();
  });

  it("is read back, decrypted with the owner's key, into the same rows in an empty database", async () => {
    const sqlite = migratedDatabase();
    sqlite
      .prepare("INSERT INTO people (id, created_at, mobile_e164, name) VALUES ('p1', '2026-10-01', '+919810000001', ?)")
      .run("Rohit O'Brien");
    const { bucket, objects } = memoryBucket();
    const { publicKey, pem } = await keyPair();

    const written = await writeBackup({
      db: asD1(sqlite),
      bucket,
      publicKey,
      environment: "staging",
      now: SUNDAY_3_30_IST,
    });
    expect(written).toMatchObject({ prefix: "2026-10-11/" });
    expect(
      await writeBackup({ db: asD1(sqlite), bucket, publicKey, environment: "staging", now: SUNDAY_3_30_IST }),
    ).toBe("already");
    // Nothing of a client's is readable in what is stored.
    for (const [key, body] of objects) {
      if (!key.endsWith("manifest.json")) expect(new TextDecoder("latin1").decode(body)).not.toContain("Rohit");
    }

    const manifest = Manifest.parse(JSON.parse(new TextDecoder().decode(objects.get("2026-10-11/manifest.json"))));
    const key = await backupKeyOf(manifest, await privateKeyOf(pem));
    const rows = new Map<string, Record<string, unknown>[]>();
    for (const table of manifest.tables) {
      const body = objects.get(table.object);
      if (body === undefined) throw new Error(`${table.object} is in the bucket`);
      rows.set(table.name, await rowsIn(key, table.iv, body));
    }
    expect(rows.get("people")).toEqual([expect.objectContaining({ id: "p1", name: "Rohit O'Brien" })]);

    const restored = new DatabaseSync(":memory:");
    // As D1 loads a file: in one transaction, its foreign keys checked at the end.
    restored.exec(`BEGIN;
${sqlFor(manifest, rows)}COMMIT;`);
    expect(restored.prepare("SELECT name FROM people WHERE id = 'p1'").get()).toEqual({ name: "Rohit O'Brien" });
    const tables = (
      sqlite
        .prepare("SELECT count(*) AS n FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
        .get() as { n: number }
    ).n;
    expect(manifest.tables).toHaveLength(tables);
  });

  it("deletes the backups past thirteen weeks, and keeps the rest", async () => {
    const { bucket, objects } = memoryBucket();
    for (const key of [
      "2026-07-05/manifest.json",
      "2026-07-05/people.jsonl.gz.enc",
      "2026-07-12/manifest.json",
      "2026-10-04/manifest.json",
    ]) {
      await bucket.put(key, "x");
    }
    expect(await deleteOldBackups(bucket, SUNDAY_3_30_IST)).toBe(1);
    expect([...objects.keys()]).toEqual(["2026-07-12/manifest.json", "2026-10-04/manifest.json"]);
  });
});
