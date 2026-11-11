// Web push to a technician's phone: a push with no payload, signed with the server's VAPID key (RFC 8292), which wakes
// the app's service worker to read its alerts from us and show the newest. Nothing about a client goes through the
// browser's push service, so there is nothing to encrypt. A subscription the push service says is gone comes back as
// `gone`, for the caller to delete; any other failure is left, since the alert waits in the inbox either way.

import type { VapidKeys } from "../config/web-push.ts";
import { fromBase64Url, toBase64Url } from "../lib/base64url.ts";
import type { Logger } from "../log.ts";
import { vendorFetch, VendorUnreachable } from "./vendor-fetch.ts";

const TIMEOUT_MS = 5_000;
/** How long a signature holds: half the standard's ceiling of a day. */
const SIGNED_FOR_S = 12 * 60 * 60;

/** The push services the phones' browsers subscribe with: Chrome and Android, Firefox, Safari, Edge. */
const PUSH_HOSTS = [
  /^fcm\.googleapis\.com$/,
  /^updates\.push\.services\.mozilla\.com$/,
  /\.push\.apple\.com$/,
  /\.notify\.windows\.com$/,
];

/** Whether a subscription's endpoint is one of the push services': https, on a host they serve from. */
export function isPushEndpoint(endpoint: string): boolean {
  if (!URL.canParse(endpoint)) return false;
  const url = new URL(endpoint);
  if (url.protocol !== "https:" || url.port !== "" || url.username !== "" || url.password !== "") return false;
  return PUSH_HOSTS.some((host) => host.test(url.hostname));
}

type PushAnswer = "sent" | "gone" | "failed";

/** Wakes the phone behind a subscription; `ttlSeconds` is how long the push service keeps it for a phone that is off. */
export type Push = (endpoint: string, ttlSeconds: number) => Promise<PushAnswer>;

interface PushOptions {
  /** Null where no keys are set, as in local work: the push is logged and not sent. */
  readonly keys: VapidKeys | null;
  readonly fetch: typeof fetch;
  readonly log: Logger;
  readonly now: () => Date;
}

/** The private key as WebCrypto takes it: a JWK of the point and the scalar. */
async function signingKey(keys: VapidKeys): Promise<CryptoKey> {
  const point = fromBase64Url(keys.publicKey);
  if (point?.length !== 65 || point[0] !== 4) throw new Error("VAPID public key is not an uncompressed P-256 point");
  const jwk: JsonWebKey = {
    kty: "EC",
    crv: "P-256",
    x: toBase64Url(point.slice(1, 33)),
    y: toBase64Url(point.slice(33, 65)),
    d: keys.privateKey,
  };
  return crypto.subtle.importKey("jwk", jwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
}

const encoder = new TextEncoder();
const part = (value: object): string => toBase64Url(encoder.encode(JSON.stringify(value)));

/** The VAPID token for one push service: ES256 over its origin, an expiry and our subject. */
async function vapidToken(key: CryptoKey, audience: string, subject: string, now: Date): Promise<string> {
  const exp = Math.floor(now.getTime() / 1000) + SIGNED_FOR_S;
  const unsigned = `${part({ typ: "JWT", alg: "ES256" })}.${part({ aud: audience, exp, sub: subject })}`;
  const signature = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, encoder.encode(unsigned));
  return `${unsigned}.${toBase64Url(new Uint8Array(signature))}`;
}

export function createPush(options: PushOptions): Push {
  const { keys, fetch, log, now } = options;
  let key: Promise<CryptoKey> | undefined;

  return async (endpoint, ttlSeconds) => {
    if (!isPushEndpoint(endpoint)) return "gone";
    if (keys === null) {
      log.info("push_not_sent", { reason: "no_keys" });
      return "sent";
    }
    key ??= signingKey(keys);
    const audience = new URL(endpoint).origin;
    const token = await vapidToken(await key, audience, keys.subject, now());
    const answer = await vendorFetch(
      { fetch, log },
      { vendor: "web-push", step: "push", timeoutMs: TIMEOUT_MS },
      endpoint,
      {
        method: "POST",
        headers: {
          Authorization: `vapid t=${token}, k=${keys.publicKey}`,
          TTL: String(ttlSeconds),
          Urgency: "high",
          "Content-Length": "0",
        },
      },
    );
    if (answer instanceof VendorUnreachable) return "failed";
    // The subscription has expired or was taken back: the phone subscribes again when the app next opens.
    if (answer.status === 404 || answer.status === 410) return "gone";
    return answer.ok ? "sent" : "failed";
  };
}
