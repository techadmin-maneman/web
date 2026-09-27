// Signed tokens: the photo upload link, the result links, the mm_look
// cookie, and the links to a client's own photographs and try-ons. Signed with RESULT_SIGNING_KEY, and bound to a
// purpose so a token made for one use cannot open another.
//
//   <subject, base64url>.<expiry, Unix seconds>.<HMAC-SHA256, base64url>

import { fromBase64Url, toBase64Url } from "./base64url.ts";

export type TokenPurpose = "upload" | "result" | "look" | "photo" | "tech_photo" | "tryon_photo" | "tryon_look";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export async function signToken(
  secret: string,
  purpose: TokenPurpose,
  subject: string,
  expiresAt: Date,
): Promise<string> {
  const expires = String(Math.floor(expiresAt.getTime() / 1000));
  const signature = await crypto.subtle.sign("HMAC", await importKey(secret), message(purpose, subject, expires));
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
  const valid = await crypto.subtle.verify(
    "HMAC",
    await importKey(secret),
    signature,
    message(purpose, subject, expires),
  );
  return valid ? subject : null;
}

function message(purpose: TokenPurpose, subject: string, expires: string): Uint8Array {
  return encoder.encode(`${purpose}\n${subject}\n${expires}`);
}

function importKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
    "verify",
  ]);
}
