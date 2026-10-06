// Signed tokens: the photo upload link, the result links, the mm_look
// cookie, the links to a client's own photographs and try-ons, and the link that stops a reminder or alert. Each
// purpose signs with its own key, derived from RESULT_SIGNING_KEY (HKDF), and the purpose is in what is signed too, so
// a token made for one use cannot open another.
//
//   <subject, base64url>.<expiry, Unix seconds>.<HMAC-SHA256, base64url>

import { fromBase64Url, toBase64Url } from "./base64url.ts";
import { hmacKey } from "./hash.ts";

export type TokenPurpose =
  | "upload"
  | "result"
  | "look"
  | "photo"
  | "photo_small"
  | "tech_photo"
  | "tryon_photo"
  | "tryon_look"
  | "stop_messages";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export async function signToken(
  secret: string,
  purpose: TokenPurpose,
  subject: string,
  expiresAt: Date,
): Promise<string> {
  const expires = String(Math.floor(expiresAt.getTime() / 1000));
  const signature = await crypto.subtle.sign(
    "HMAC",
    await purposeKey(secret, purpose),
    message(purpose, subject, expires),
  );
  return `${toBase64Url(encoder.encode(subject))}.${expires}.${toBase64Url(new Uint8Array(signature))}`;
}

/** The subject, or null if the token is malformed, forged, for another purpose or expired. */
export async function verifyToken(
  secret: string,
  purpose: TokenPurpose,
  token: string,
  now: Date,
): Promise<string | null> {
  const [encodedSubject, expires, encodedSignature, ...rest] = token.split(".");
  if (encodedSubject === undefined || expires === undefined || encodedSignature === undefined || rest.length > 0) {
    return null;
  }
  if (!/^\d{1,12}$/.test(expires) || Number(expires) * 1000 <= now.getTime()) return null;

  const subjectBytes = fromBase64Url(encodedSubject);
  const signature = fromBase64Url(encodedSignature);
  if (subjectBytes === null || signature === null) return null;

  const subject = decoder.decode(subjectBytes);
  // crypto.subtle.verify compares in constant time.
  const signed = message(purpose, subject, expires);
  if (await crypto.subtle.verify("HMAC", await purposeKey(secret, purpose), signature, signed)) return subject;
  // A token signed with the secret itself, before each purpose had its key, holds until its own expiry or this day.
  const legacy =
    now.getTime() < LEGACY_KEY_UNTIL && (await crypto.subtle.verify("HMAC", await hmacKey(secret), signature, signed));
  return legacy ? subject : null;
}

/**
 * The last moment a token signed with the secret itself is taken: 30 days from the release that gave each purpose its
 * key, the longest any but a stop link lives; staging's stop links from before then lapse with it.
 */
const LEGACY_KEY_UNTIL = Date.parse("2026-11-04T00:00:00Z");

/** The purpose's own key: HKDF-SHA256 of the secret, with the purpose as its info, so no two purposes share a key. */
async function purposeKey(secret: string, purpose: TokenPurpose): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey("raw", encoder.encode(secret), "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: new Uint8Array(0), info: encoder.encode(`mm-token:${purpose}`) },
    base,
    { name: "HMAC", hash: "SHA-256", length: 256 },
    false,
    ["sign", "verify"],
  );
}

function message(purpose: TokenPurpose, subject: string, expires: string): Uint8Array {
  return encoder.encode(`${purpose}\n${subject}\n${expires}`);
}
