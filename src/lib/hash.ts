const encoder = new TextEncoder();

function toHex(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function sha256Hex(value: string): Promise<string> {
  return toHex(await crypto.subtle.digest("SHA-256", encoder.encode(value)));
}

/**
 * A keyed hash. Used for IP addresses and for the mobile numbers in rate-limit
 * keys, so neither is stored in the clear and neither can be reversed without
 * the salt.
 */
export async function saltedHash(salt: string, value: string): Promise<string> {
  return toHex(await crypto.subtle.sign("HMAC", await hmacKey(salt), encoder.encode(value)));
}

/** A secret as an HMAC-SHA256 key, to sign with and verify by. */
export function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
    "verify",
  ]);
}

/**
 * Whether a secret someone sent matches ours, in constant time: both are
 * hashed first, so neither their length nor their content leaks through timing.
 * An unset secret matches nothing.
 */
export async function secretsMatch(given: string, expected: string): Promise<boolean> {
  if (expected === "") return false;
  const [a, b] = await Promise.all(
    [given, expected].map((value) => crypto.subtle.digest("SHA-256", encoder.encode(value))),
  );
  return a !== undefined && b !== undefined && crypto.subtle.timingSafeEqual(a, b);
}
