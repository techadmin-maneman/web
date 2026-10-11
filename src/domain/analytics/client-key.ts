// A client as the reporting copy knows them (docs/decisions/0146-the-nightly-analytics-copy.md): a key made from our
// ID with a secret only the API holds, the same every night, so the copy can follow a client over time and neither
// Supabase nor Zoho can turn it back into a person.

const encoder = new TextEncoder();

/** The key for each person, made once a night: an HMAC of their ID, 32 hex characters. */
export async function clientKeys(secret: string, personIds: Iterable<string>): Promise<Map<string, string>> {
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
  ]);
  const keys = new Map<string, string>();
  for (const id of new Set(personIds)) {
    const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(id)));
    keys.set(id, [...mac.slice(0, 16)].map((byte) => byte.toString(16).padStart(2, "0")).join(""));
  }
  return keys;
}
