// Reading a weekly backup back (src/domain/platform/backups.ts): the owner's private key unwraps the backup's AES key,
// which decrypts each table, and the tables become SQL that loads into an empty database.

import { gunzipSync } from "node:zlib";
import { z } from "zod";

export const Manifest = z.object({
  format: z.literal(1),
  environment: z.string(),
  created_at: z.string(),
  wrapped_key: z.string(),
  schema: z.array(z.object({ name: z.string(), sql: z.string() })),
  tables: z.array(z.object({ name: z.string(), rows: z.number(), object: z.string(), iv: z.string() })),
});
export type Manifest = z.infer<typeof Manifest>;

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

/**
 * SQL that rebuilds the backup in an empty database: every table as it was made, then its rows. Foreign keys are
 * checked once the file has loaded, as in D1's own exports, since the tables come in name order rather than the order
 * they point at each other; D1 loads a file as one transaction.
 */
export function sqlFor(manifest: Manifest, rows: ReadonlyMap<string, readonly Record<string, unknown>[]>): string {
  const lines = ["PRAGMA defer_foreign_keys = TRUE;"];
  for (const table of manifest.schema) lines.push(`${table.sql};`);
  for (const table of manifest.tables) {
    for (const row of rows.get(table.name) ?? []) {
      const columns = Object.keys(row);
      lines.push(
        `INSERT INTO ${quoted(table.name)} (${columns.map(quoted).join(", ")}) VALUES (${columns.map((column) => literal(row[column])).join(", ")});`,
      );
    }
  }
  return `${lines.join("\n")}\n`;
}
