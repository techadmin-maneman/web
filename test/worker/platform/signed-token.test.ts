// The signed tokens (src/lib/signed-token.ts): each purpose signs with its own key, derived from the one secret, and a
// token signed with the secret itself, before purposes had keys, is taken only until the day its last one lapses.

import { describe, expect, it } from "vitest";
import { signToken, verifyToken } from "../../../src/lib/signed-token.ts";
import { toBase64Url } from "../../../src/lib/base64url.ts";

const SECRET = "a-signing-secret-for-the-tests-that-is-long-enough";
const NOW = new Date("2026-10-04T06:30:00Z");
const IN_A_DAY = new Date(NOW.getTime() + 24 * 60 * 60 * 1000);

/** A token as it was signed before each purpose had its key: with the secret itself. */
async function signedTheOldWay(purpose: string, subject: string, expiresAt: Date): Promise<string> {
  const encoder = new TextEncoder();
  const expires = String(Math.floor(expiresAt.getTime() / 1000));
  const key = await crypto.subtle.importKey("raw", encoder.encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
  ]);
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(`${purpose}\n${subject}\n${expires}`));
  return `${toBase64Url(encoder.encode(subject))}.${expires}.${toBase64Url(new Uint8Array(signature))}`;
}

describe("a signed token", () => {
  it("opens what it was made for, and nothing else", async () => {
    const token = await signToken(SECRET, "photo", "photo-1", IN_A_DAY);
    expect(await verifyToken(SECRET, "photo", token, NOW)).toBe("photo-1");
    expect(await verifyToken(SECRET, "photo_small", token, NOW)).toBeNull();
    expect(await verifyToken(`${SECRET}-other`, "photo", token, NOW)).toBeNull();
  });

  it("is signed with its purpose's own key, not the secret itself", async () => {
    const token = await signToken(SECRET, "stop_messages", "whatsapp_visits p1", IN_A_DAY);
    expect(token).not.toBe(await signedTheOldWay("stop_messages", "whatsapp_visits p1", IN_A_DAY));
  });

  it("is still taken signed the old way until 4 November 2026, so no link already sent breaks at the release", async () => {
    const lateLink = new Date("2026-12-01T00:00:00Z");
    const old = await signedTheOldWay("stop_messages", "whatsapp_visits p1", lateLink);
    expect(await verifyToken(SECRET, "stop_messages", old, NOW)).toBe("whatsapp_visits p1");
    expect(await verifyToken(SECRET, "stop_messages", old, new Date("2026-11-04T00:00:00Z"))).toBeNull();
  });
});
