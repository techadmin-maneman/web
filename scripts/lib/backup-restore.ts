// Reading a weekly backup back (src/domain/platform/backups.ts): the private key unwraps the backup's AES key,
// which decrypts each table, and the tables become SQL that loads into an empty database.

import { gunzipSync } from "node:zlib";
import { z } from "zod";
import { parentsFirst } from "../../src/lib/parents-first.ts";
import type { ForeignKey } from "./restore-carry.ts";
import { keysOf } from "./schema-keys.ts";

export const Manifest = z.object({
  format: z.literal(1),
  environment: z.string(),
  created_at: z.string(),
  wrapped_key: z.string(),
  schema: z.array(z.object({ name: z.string(), sql: z.string() })),
  after_rows: z.array(z.object({ name: z.string(), sql: z.string() })).default([]),
  tables: z.array(z.object({ name: z.string(), rows: z.number(), object: z.string(), iv: z.string() })),
});
export type Manifest = z.infer<typeof Manifest>;

/** Refuses a backup another environment wrote: restoring it would carry that environment's rows here. */
export function assertBackupOf(manifest: Manifest, environment: string): void {
  if (manifest.environment !== environment) {
    throw new Error(`this backup is ${manifest.environment}'s, not ${environment}'s`);
  }
}

const fromBase64 = (text: string): Uint8Array => Uint8Array.from(atob(text), (char) => char.charCodeAt(0));

/** A key exported as SPKI or PKCS8, as base64; the API types an export as a JSON key too, which those never are. */
export function toBase64(bytes: ArrayBuffer | JsonWebKey): string {
  if (!(bytes instanceof ArrayBuffer)) throw new Error("a key exported as spki or pkcs8 is bytes");
  let text = "";
  for (const byte of new Uint8Array(bytes)) text += String.fromCharCode(byte);
  return btoa(text);
}

/** The private key's PEM, as backup-keys.ts wrote it, as a key that unwraps a backup's key. */
export function privateKeyOf(pem: string): Promise<CryptoKey> {
  const body = pem.replace(/-----(BEGIN|END) PRIVATE KEY-----/g, "").replace(/\s+/g, "");
  return crypto.subtle.importKey("pkcs8", fromBase64(body), { name: "RSA-OAEP", hash: "SHA-256" }, false, [
    "unwrapKey",
  ]);
}

/** The backup's AES key, unwrapped. */
export function backupKeyOf(manifest: Manifest, privateKey: CryptoKey): Promise<CryptoKey> {
  return crypto.subtle.unwrapKey(
    "raw",
    fromBase64(manifest.wrapped_key),
    privateKey,
    { name: "RSA-OAEP" },
    "AES-GCM",
    false,
    ["decrypt"],
  );
}

/** One table's object, decrypted and unzipped, as its rows. */
export async function rowsIn(key: CryptoKey, iv: string, data: Uint8Array): Promise<Record<string, unknown>[]> {
  const zipped = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromBase64(iv) }, key, data);
  const text = new TextDecoder().decode(gunzipSync(new Uint8Array(zipped)));
  return text === "" ? [] : text.split("\n").map((line) => JSON.parse(line) as Record<string, unknown>);
}

const quoted = (name: string): string => `"${name.replaceAll('"', '""')}"`;

function literal(value: unknown): string {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "NULL";
  if (typeof value === "boolean") return value ? "1" : "0";
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return `'${text.replaceAll("'", "''")}'`;
}

type Row = Readonly<Record<string, unknown>>;

/** A table's rows, each after any row of the same table it points at. */
function selfOrdered(rows: readonly Row[], keys: readonly ForeignKey[]): readonly Row[] {
  if (keys.length === 0) return rows;
  const targets = keys.map((key) => new Map(rows.map((row) => [row[key.to], row])));
  const seen = new Set<Row>();
  const ordered: Row[] = [];
  const place = (row: Row): void => {
    if (seen.has(row)) return;
    seen.add(row);
    keys.forEach((key, index) => {
      const target = row[key.from] === null ? undefined : targets[index]?.get(row[key.from]);
      if (target !== undefined) place(target);
    });
    ordered.push(row);
  };
  for (const row of rows) place(row);
  return ordered;
}

/**
 * SQL that rebuilds the backup in an empty database: every table as it was made; the rows, each after the rows it
 * points at, since D1 loads a long file as several transactions and checks foreign keys at the end of each; then the
 * indexes, triggers and views, which a load would otherwise slow or set off.
 */
export function sqlFor(manifest: Manifest, rows: ReadonlyMap<string, readonly Row[]>): string {
  const keys = new Map(
    [...keysOf(manifest.schema.map((table) => table.sql))].map(([name, { foreignKeys }]) => [name, foreignKeys]),
  );
  const order = parentsFirst(
    manifest.tables.map(({ name }) => ({ name, parents: (keys.get(name) ?? []).map((key) => key.table) })),
  );
  const lines = ["PRAGMA defer_foreign_keys = TRUE;"];
  for (const table of manifest.schema) lines.push(`${table.sql};`);
  for (const name of order) {
    const own = (keys.get(name) ?? []).filter((key) => key.table === name);
    for (const row of selfOrdered(rows.get(name) ?? [], own)) {
      const columns = Object.keys(row);
      lines.push(
        `INSERT INTO ${quoted(name)} (${columns.map(quoted).join(", ")}) VALUES (${columns.map((column) => literal(row[column])).join(", ")});`,
      );
    }
  }
  for (const each of manifest.after_rows) lines.push(`${each.sql};`);
  return `${lines.join("\n")}\n`;
}
