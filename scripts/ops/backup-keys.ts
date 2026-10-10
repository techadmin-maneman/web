// node scripts/ops/backup-keys.ts --private <file>
//
// Makes the key pair the weekly backup is encrypted to: prints the public key, for each environment's
// BACKUP_PUBLIC_KEY, and writes the private key to <file>, which must not exist yet. Keep the private key offline, in
// a password manager, and delete the file: without it no backup can be read, and with it every one can.

import { existsSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { toBase64 } from "../lib/backup-restore.ts";

const { values } = parseArgs({ options: { private: { type: "string" } } });
const file = values.private;
if (file === undefined) {
  console.error("usage: node scripts/ops/backup-keys.ts --private <file>");
  process.exit(2);
}
if (existsSync(file)) {
  console.error(`${file} exists already: choose another file rather than overwrite a key`);
  process.exit(1);
}

const pair = await crypto.subtle.generateKey(
  { name: "RSA-OAEP", modulusLength: 4096, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
  true,
  ["wrapKey", "unwrapKey"],
);
if (!("publicKey" in pair)) throw new Error("RSA-OAEP makes a key pair");
const publicKey = toBase64(await crypto.subtle.exportKey("spki", pair.publicKey));
const privateKey = toBase64(await crypto.subtle.exportKey("pkcs8", pair.privateKey));
const pem = `-----BEGIN PRIVATE KEY-----\n${(privateKey.match(/.{1,64}/g) ?? []).join("\n")}\n-----END PRIVATE KEY-----\n`;
writeFileSync(file, pem, { mode: 0o600 });

console.log(`The private key is in ${file}. Move it to the password manager, then delete the file.`);
console.log("The public key, for `W secret put BACKUP_PUBLIC_KEY --env <env>`:\n");
console.log(publicKey);
