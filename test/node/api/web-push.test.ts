// A push to a technician's phone (src/providers/web-push.ts), against a fake push service: each is signed with our
// VAPID key for that service alone and carries no payload; a gone subscription is told apart from a failure; and no
// push goes anywhere but a push service. The keys are made for the test; every endpoint is made up.

import { describe, expect, it } from "vitest";
import { fromBase64Url, toBase64Url } from "../../../src/lib/base64url.ts";
import { createLogger } from "../../../src/log.ts";
import type { VapidKeys } from "../../../src/config/web-push.ts";
import { createPush, isPushEndpoint } from "../../../src/providers/web-push.ts";

const ENDPOINT = "https://fcm.googleapis.com/fcm/send/abc123";
const NOW = new Date("2026-11-11T09:00:00Z");

async function makeKeys(): Promise<VapidKeys> {
  const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  if (!("publicKey" in pair)) throw new Error("ECDSA makes a key pair");
  const raw: unknown = await crypto.subtle.exportKey("raw", pair.publicKey);
  const jwk: unknown = await crypto.subtle.exportKey("jwk", pair.privateKey);
  if (!(raw instanceof ArrayBuffer)) throw new Error("a raw key is its bytes");
  const d = typeof jwk === "object" && jwk !== null && "d" in jwk && typeof jwk.d === "string" ? jwk.d : "";
  return { publicKey: toBase64Url(new Uint8Array(raw)), privateKey: d, subject: "https://maneman.in" };
}

interface Received {
  readonly url: string;
  readonly headers: Headers;
  readonly body: BodyInit | null | undefined;
}

/** A push service answering each push with `status`, keeping what it was sent. */
function pushService(status: number | "unreachable") {
  const received: Received[] = [];
  const fetch: typeof globalThis.fetch = (url, init) => {
    received.push({
      url: url instanceof Request ? url.url : url.toString(),
      headers: new Headers(init?.headers),
      body: init?.body,
    });
    if (status === "unreachable") return Promise.reject(new TypeError("fetch failed"));
    return Promise.resolve(new Response(null, { status }));
  };
  return { fetch, received };
}

const decoded = (part: string): unknown =>
  JSON.parse(new TextDecoder().decode(fromBase64Url(part) ?? new Uint8Array()));

/** The token's claims, once its signature checks against the key the header names. */
async function verifiedClaims(authorization: string, publicKey: string): Promise<unknown> {
  const [, token = "", key = ""] = /^vapid t=([^,]+), k=(.+)$/.exec(authorization) ?? [];
  expect(key).toBe(publicKey);
  const [header = "", claims = "", signature = ""] = token.split(".");
  expect(decoded(header)).toEqual({ typ: "JWT", alg: "ES256" });
  const verifier = await crypto.subtle.importKey(
    "raw",
    fromBase64Url(key) ?? new Uint8Array(),
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["verify"],
  );
  const valid = await crypto.subtle.verify(
    { name: "ECDSA", hash: "SHA-256" },
    verifier,
    fromBase64Url(signature) ?? new Uint8Array(),
    new TextEncoder().encode(`${header}.${claims}`),
  );
  expect(valid).toBe(true);
  return decoded(claims);
}

describe("a push to a phone", () => {
  it("is signed with our key for that push service alone, a day or less ahead, and carries nothing", async () => {
    const keys = await makeKeys();
    const service = pushService(201);
    const push = createPush({ keys, fetch: service.fetch, log: createLogger(), now: () => NOW });

    expect(await push(ENDPOINT, 600)).toBe("sent");

    const [sent] = service.received;
    expect(sent?.url).toBe(ENDPOINT);
    expect(sent?.body ?? null).toBeNull();
    expect(sent?.headers.get("TTL")).toBe("600");
    expect(sent?.headers.get("Urgency")).toBe("high");
    const claims = await verifiedClaims(sent?.headers.get("Authorization") ?? "", keys.publicKey);
    expect(claims).toEqual({
      aud: "https://fcm.googleapis.com",
      exp: NOW.getTime() / 1000 + 12 * 60 * 60,
      sub: keys.subject,
    });
  });

  it("says a subscription the push service no longer has is gone, and any other failure failed", async () => {
    const keys = await makeKeys();
    const answers = await Promise.all(
      ([404, 410, 429, 500, 400, "unreachable"] as const).map((status) =>
        createPush({ keys, fetch: pushService(status).fetch, log: createLogger(), now: () => NOW })(ENDPOINT, 60),
      ),
    );
    expect(answers).toEqual(["gone", "gone", "failed", "failed", "failed", "failed"]);
  });

  it("sends nothing anywhere but a push service, and says the subscription is gone", async () => {
    const service = pushService(201);
    const push = createPush({ keys: await makeKeys(), fetch: service.fetch, log: createLogger(), now: () => NOW });

    for (const endpoint of [
      "http://fcm.googleapis.com/fcm/send/abc",
      "https://example.com/push",
      "https://fcm.googleapis.com.example.com/push",
      "https://fcm.googleapis.com:8443/push",
      "https://user:pass@fcm.googleapis.com/push",
      "not a url",
    ]) {
      expect(isPushEndpoint(endpoint)).toBe(false);
      expect(await push(endpoint, 60)).toBe("gone");
    }
    expect(service.received).toEqual([]);
  });

  it("takes each browser's push service", () => {
    expect(isPushEndpoint("https://fcm.googleapis.com/fcm/send/abc")).toBe(true);
    expect(isPushEndpoint("https://updates.push.services.mozilla.com/wpush/v2/abc")).toBe(true);
    expect(isPushEndpoint("https://web.push.apple.com/QGuQyavXutnMH")).toBe(true);
    expect(isPushEndpoint("https://wns2-pn1p.notify.windows.com/w/?token=abc")).toBe(true);
  });

  it("with no keys set, as in local work, logs the push and sends nothing", async () => {
    const service = pushService(201);
    const push = createPush({ keys: null, fetch: service.fetch, log: createLogger(), now: () => NOW });
    expect(await push(ENDPOINT, 60)).toBe("sent");
    expect(service.received).toEqual([]);
  });
});
