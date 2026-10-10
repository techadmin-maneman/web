// A weekly copy of the database in R2, encrypted to a key kept offline, kept thirteen weeks: what Time Travel
// cannot give back once its thirty days have passed, or if the database itself is lost (docs/runbook/restoring-d1.md,
// "From a weekly backup"). Each table is gzipped JSON lines under one AES key, which an RSA public key wraps;
// the manifest goes last, so a backup cut short is never taken for a whole one.

import { addDays, indiaDate } from "../../lib/india-time.ts";

const KEEP_WEEKS = 13;
const PAGE_ROWS = 1000;
const MANIFEST = "manifest.json";
const IST_OFFSET_MS = 330 * 60_000;

/** The India date of the backup due now: on Sundays, in the hour from 3 am in India; else null. */
export function backupDueOn(now: Date): string | null {
  const india = new Date(now.getTime() + IST_OFFSET_MS);
  return india.getUTCDay() === 0 && india.getUTCHours() === 3 ? indiaDate(now) : null;
}

interface Table {
  readonly name: string;
  readonly sql: string;
}

/** Every table of ours: Cloudflare's own and SQLite's left out. */
async function tablesOf(db: D1Database): Promise<Table[]> {
  const { results } = await db
    .prepare(
      `SELECT name, sql FROM sqlite_master
       WHERE type = 'table' AND name NOT LIKE 'sqlite\\_%' ESCAPE '\\' AND name NOT LIKE '\\_cf\\_%' ESCAPE '\\'
       ORDER BY name`,
    )
    .all<Table>();
  return results;
}

const quoted = (name: string): string => `"${name.replaceAll('"', '""')}"`;

/** A table's rows, a page at a time by rowid; a table without one is read whole. */
async function rowsOf(db: D1Database, table: Table): Promise<Record<string, unknown>[]> {
  if (/WITHOUT\s+ROWID/i.test(table.sql)) {
    return (await db.prepare(`SELECT * FROM ${quoted(table.name)}`).all()).results;
  }
  const rows: Record<string, unknown>[] = [];
  let after = Number.MIN_SAFE_INTEGER;
  for (;;) {
    const page = (
      await db
        .prepare(`SELECT rowid AS backup_rowid, * FROM ${quoted(table.name)} WHERE rowid > ?1 ORDER BY rowid LIMIT ?2`)
        .bind(after, PAGE_ROWS)
        .all<Record<string, unknown> & { backup_rowid: number }>()
    ).results;
    for (const { backup_rowid: rowid, ...row } of page) {
      rows.push(row);
      after = rowid;
    }
    if (page.length < PAGE_ROWS) return rows;
  }
}

const base64 = (bytes: ArrayBuffer | Uint8Array): string => {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let text = "";
  for (const byte of view) text += String.fromCharCode(byte);
  return btoa(text);
};

const fromBase64 = (text: string): Uint8Array => Uint8Array.from(atob(text), (char) => char.charCodeAt(0));

async function gzip(text: string): Promise<ArrayBuffer> {
  return new Response(new Blob([text]).stream().pipeThrough(new CompressionStream("gzip"))).arrayBuffer();
}

/** The public key: an RSA-OAEP key, SHA-256, as base64 SPKI (scripts/ops/backup-keys.ts makes the pair). */
async function wrappingKey(publicKey: string): Promise<CryptoKey> {
  return crypto.subtle.importKey("spki", fromBase64(publicKey), { name: "RSA-OAEP", hash: "SHA-256" }, false, [
    "wrapKey",
  ]);
}

/** A fresh AES key for one backup; the API types it as a pair too, which an AES key never is. */
async function backupKey(): Promise<CryptoKey> {
  const generated = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt"]);
  if (!("algorithm" in generated)) throw new Error("an AES key is a single key");
  return generated;
}

/** What a backup wrote: its folder, tables and rows; or that this week's was written already. */
type BackupOutcome = { readonly prefix: string; readonly tables: number; readonly rows: number } | "already";

/** Writes this week's backup into `bucket`, under its India date, unless it is there already. */
export async function writeBackup(input: {
  readonly db: D1Database;
  readonly bucket: R2Bucket;
  readonly publicKey: string;
  readonly environment: string;
  readonly now: Date;
}): Promise<BackupOutcome> {
  const { db, bucket, now } = input;
  const prefix = `${indiaDate(now)}/`;
  if ((await bucket.head(`${prefix}${MANIFEST}`)) !== null) return "already";
  const key = await backupKey();
  const wrapped = await crypto.subtle.wrapKey("raw", key, await wrappingKey(input.publicKey), { name: "RSA-OAEP" });
  const tables = await tablesOf(db);
  const written: { name: string; rows: number; object: string; iv: string }[] = [];
  for (const table of tables) {
    const rows = await rowsOf(db, table);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const lines = rows.map((row) => JSON.stringify(row)).join("\n");
    const body = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, await gzip(lines));
    const object = `${prefix}${table.name}.jsonl.gz.enc`;
    await bucket.put(object, body);
    written.push({ name: table.name, rows: rows.length, object, iv: base64(iv) });
  }
  const manifest = {
    format: 1,
    environment: input.environment,
    created_at: now.toISOString(),
    encryption: "AES-256-GCM, its key wrapped by RSA-OAEP with SHA-256",
    wrapped_key: base64(wrapped),
    schema: tables,
    tables: written,
  };
  await bucket.put(`${prefix}${MANIFEST}`, JSON.stringify(manifest, null, 2), {
    httpMetadata: { contentType: "application/json" },
  });
  return { prefix, tables: written.length, rows: written.reduce((sum, table) => sum + table.rows, 0) };
}

/** Deletes every backup older than thirteen weeks; the folders sort as their dates do. */
export async function deleteOldBackups(bucket: R2Bucket, now: Date): Promise<number> {
  const oldest = addDays(indiaDate(now), -7 * KEEP_WEEKS);
  const folders = (await bucket.list({ delimiter: "/" })).delimitedPrefixes;
  let deleted = 0;
  for (const folder of folders.filter((each) => each.slice(0, 10) < oldest)) {
    const objects = (await bucket.list({ prefix: folder })).objects.map((object) => object.key);
    if (objects.length > 0) await bucket.delete(objects);
    deleted += 1;
  }
  return deleted;
}
