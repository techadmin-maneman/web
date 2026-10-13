// A weekly copy of the database in R2, encrypted to a key kept offline, kept thirteen weeks: what Time Travel
// cannot give back once its thirty days have passed, or if the database itself is lost (docs/runbook/restoring-d1.md,
// "From a weekly backup"). Each table is gzipped JSON lines under an AES key of its own, which an RSA public key wraps,
// so each can be written by a step of its own (src/workflows/backup.ts); the manifest goes last, so a backup cut short
// is never taken for a whole one.

import { addDays, indiaDate } from "../../lib/india-time.ts";
import { parentsFirst } from "../../lib/parents-first.ts";

const KEEP_WEEKS = 13;
const PAGE_ROWS = 1000;
const MANIFEST = "manifest.json";
export interface Table {
  readonly name: string;
  readonly sql: string;
}

export interface Schema {
  /** In reading order: each table before those it points at, so every row read finds the row it points at still there. */
  readonly tables: readonly Table[];
  /** The indexes, triggers and views, built once the rows are in. */
  readonly afterRows: readonly Table[];
}

/** Everything of ours in the database: Cloudflare's own and SQLite's left out. */
export async function schemaOf(db: D1Database): Promise<Schema> {
  const { results } = await db
    .prepare(
      `SELECT m.type, m.name, m.sql, group_concat(f."table") AS parents
       FROM sqlite_master m LEFT JOIN pragma_foreign_key_list(m.name) f
       WHERE m.sql IS NOT NULL AND m.name NOT LIKE 'sqlite\\_%' ESCAPE '\\' AND m.name NOT LIKE '\\_cf\\_%' ESCAPE '\\'
       GROUP BY m.rowid ORDER BY m.rowid`,
    )
    .all<Table & { type: string; parents: string | null }>();
  const tables = results.filter((each) => each.type === "table");
  const byName = new Map(tables.map(({ name, sql }) => [name, { name, sql }]));
  const order = parentsFirst(tables.map(({ name, parents }) => ({ name, parents: parents?.split(",") ?? [] })));
  return {
    tables: order.toReversed().flatMap((name) => byName.get(name) ?? []),
    afterRows: results.filter((each) => each.type !== "table").map(({ name, sql }) => ({ name, sql })),
  };
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

/** A fresh AES key for one table; the API types it as a pair too, which an AES key never is. */
async function tableKey(): Promise<CryptoKey> {
  const generated = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt"]);
  if (!("algorithm" in generated)) throw new Error("an AES key is a single key");
  return generated;
}

/** A table as its backup wrote it: its rows, its object, and the IV and wrapped key that open it. */
export interface WrittenTable {
  readonly name: string;
  readonly rows: number;
  readonly object: string;
  readonly iv: string;
  readonly wrapped_key: string;
}

/** The folder a backup of `date`, an India date, is written under. */
export const backupFolder = (date: string) => `${date}/`;

/** Whether the backup under the folder is whole already: its manifest, written last, is there. */
export const backupIsWhole = async (bucket: R2Bucket, prefix: string) =>
  (await bucket.head(`${prefix}${MANIFEST}`)) !== null;

/** Writes one table, under a key of its own that only the private key unwraps. */
export async function writeTable(
  db: D1Database,
  bucket: R2Bucket,
  { prefix, table, publicKey }: { readonly prefix: string; readonly table: Table; readonly publicKey: string },
): Promise<WrittenTable> {
  const rows = await rowsOf(db, table);
  const key = await tableKey();
  const wrapped = await crypto.subtle.wrapKey("raw", key, await wrappingKey(publicKey), { name: "RSA-OAEP" });
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const lines = rows.map((row) => JSON.stringify(row)).join("\n");
  const body = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, await gzip(lines));
  const object = `${prefix}${table.name}.jsonl.gz.enc`;
  await bucket.put(object, body);
  return { name: table.name, rows: rows.length, object, iv: base64(iv), wrapped_key: base64(wrapped) };
}

/** The manifest, last: what makes the backup whole. */
export async function writeManifest(
  bucket: R2Bucket,
  given: {
    readonly prefix: string;
    readonly environment: string;
    readonly createdAt: Date;
    readonly schema: Schema;
    readonly written: readonly WrittenTable[];
  },
): Promise<void> {
  const manifest = {
    format: 2,
    environment: given.environment,
    created_at: given.createdAt.toISOString(),
    encryption: "AES-256-GCM, each table's key wrapped by RSA-OAEP with SHA-256",
    schema: given.schema.tables,
    after_rows: given.schema.afterRows,
    tables: given.written,
  };
  await bucket.put(`${given.prefix}${MANIFEST}`, JSON.stringify(manifest, null, 2), {
    httpMetadata: { contentType: "application/json" },
  });
}

/** What a backup wrote: its folder, tables and rows; or that this week's was written already. */
type BackupOutcome = { readonly prefix: string; readonly tables: number; readonly rows: number } | "already";

/** Writes the backup of `date`, an India date, into `bucket` under it, unless it is there already: in one pass. */
export async function writeBackup(input: {
  readonly db: D1Database;
  readonly bucket: R2Bucket;
  readonly publicKey: string;
  readonly environment: string;
  readonly now: Date;
  readonly date: string;
}): Promise<BackupOutcome> {
  const { db, bucket, publicKey } = input;
  const prefix = backupFolder(input.date);
  if (await backupIsWhole(bucket, prefix)) return "already";
  const schema = await schemaOf(db);
  const written: WrittenTable[] = [];
  for (const table of schema.tables) written.push(await writeTable(db, bucket, { prefix, table, publicKey }));
  await writeManifest(bucket, { prefix, environment: input.environment, createdAt: input.now, schema, written });
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
