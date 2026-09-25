// Who is calling the ops surface, from the token Cloudflare Access adds to
// every request it lets through (docs/decisions/0031-access-and-audit.md).
//
// Access already stops anyone without a login at the edge. The Worker checks
// the token again, so a request that reached it some other way is refused, and
// so every call can be audited under the person or service token behind it.

import { createMiddleware } from "hono/factory";
import type { AppEnv } from "../app.ts";
import type { AccessSettings } from "../config/settings.ts";
import { errorBody } from "./errors.ts";

export const ACCESS_TOKEN_HEADER = "Cf-Access-Jwt-Assertion";

/** Keys are fetched again after an hour; Access rotates them with weeks of overlap. */
const KEY_TTL_MS = 60 * 60 * 1000;
/** A token naming an unknown key may refetch the keys, but at most once a minute. */
const UNKNOWN_KEY_REFETCH_MS = 60 * 1000;
/** Every ops request waits on the keys when they are due, so a slow Access fails it rather than holding it. */
const KEYS_TIMEOUT_MS = 5_000;

export type AccessIdentity =
  { readonly kind: "staff"; readonly email: string } | { readonly kind: "service"; readonly clientId: string };

export type AccessRefusal =
  | "missing"
  | "malformed"
  | "wrong_algorithm"
  | "unknown_key"
  | "bad_signature"
  | "wrong_issuer"
  | "wrong_audience"
  | "expired"
  | "not_yet_valid"
  | "no_identity";

export type AccessResult =
  | { readonly ok: true; readonly identity: AccessIdentity }
  | { readonly ok: false; readonly reason: AccessRefusal }
  | { readonly ok: false; readonly reason: "keys_unavailable"; readonly error: unknown };

export interface AccessVerifier {
  verify(request: Request): Promise<AccessResult>;
}

/** Local development only: everyone is the same member of staff. The guard refuses it elsewhere. */
export const STUB_IDENTITY: AccessIdentity = { kind: "staff", email: "ops@localhost" };

export function createAccessVerifier(
  settings: AccessSettings | null,
  deps: { fetch: typeof fetch; now: () => Date },
): AccessVerifier {
  if (settings === null) return { verify: () => Promise.resolve({ ok: true, identity: STUB_IDENTITY }) };
  const { opsAudience } = settings;
  if (opsAudience === null) {
    // The ops surface is switched off in this environment, so nothing asks.
    return { verify: () => Promise.reject(new Error("ACCESS_OPS_AUD is not set")) };
  }
  const keys = createKeyCache(`https://${settings.teamDomain}/cdn-cgi/access/certs`, deps);
  const issuer = `https://${settings.teamDomain}`;
  return {
    verify: (request) => verifyToken(request.headers.get(ACCESS_TOKEN_HEADER), keys, issuer, opsAudience, deps),
  };
}

/** Refuses a request without a valid Access token; otherwise sets c.var.accessIdentity. */
export const requireAccess = createMiddleware<AppEnv>(async (c, next) => {
  const result = await c.var.deps.access.verify(c.req.raw);
  if (result.ok) {
    c.set("accessIdentity", result.identity);
    return next();
  }
  if (result.reason === "keys_unavailable") {
    c.var.log.error("access_keys_unavailable", { error: result.error });
    return c.json(errorBody("unavailable", c.var.requestId), 503);
  }
  c.var.log.warn("access_refused", { reason: result.reason });
  return c.json(errorBody("access_required", c.var.requestId), 403);
});

async function verifyToken(
  token: string | null,
  keys: KeyCache,
  issuer: string,
  audience: string,
  deps: { now: () => Date },
): Promise<AccessResult> {
  if (token === null || token === "") return { ok: false, reason: "missing" };
  const parts = token.split(".");
  const [headerPart, payloadPart, signaturePart] = parts;
  if (parts.length !== 3 || headerPart === undefined || payloadPart === undefined || signaturePart === undefined) {
    return { ok: false, reason: "malformed" };
  }
  const header = decodeJson(headerPart);
  const claims = decodeJson(payloadPart);
  const signature = decodeBase64Url(signaturePart);
  if (header === null || claims === null || signature === null) return { ok: false, reason: "malformed" };
  if (header.alg !== "RS256" || typeof header.kid !== "string") return { ok: false, reason: "wrong_algorithm" };

  let key: CryptoKey | undefined;
  try {
    key = await keys.get(header.kid);
  } catch (error) {
    return { ok: false, reason: "keys_unavailable", error };
  }
  if (key === undefined) return { ok: false, reason: "unknown_key" };

  const signed = new TextEncoder().encode(`${headerPart}.${payloadPart}`);
  if (!(await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, signature, signed))) {
    return { ok: false, reason: "bad_signature" };
  }

  const nowSeconds = deps.now().getTime() / 1000;
  if (claims.iss !== issuer) return { ok: false, reason: "wrong_issuer" };
  const audiences: unknown[] = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!audiences.includes(audience)) return { ok: false, reason: "wrong_audience" };
  if (typeof claims.exp !== "number" || claims.exp <= nowSeconds) return { ok: false, reason: "expired" };
  if (typeof claims.nbf === "number" && claims.nbf > nowSeconds) return { ok: false, reason: "not_yet_valid" };

  // A person's token carries their e-mail; a service token's carries its client ID as common_name.
  if (typeof claims.email === "string" && claims.email !== "") {
    return { ok: true, identity: { kind: "staff", email: claims.email.toLowerCase() } };
  }
  if (typeof claims.common_name === "string" && claims.common_name !== "") {
    return { ok: true, identity: { kind: "service", clientId: claims.common_name } };
  }
  return { ok: false, reason: "no_identity" };
}

interface KeyCache {
  /** The key with this ID, or undefined if Access publishes none. Throws if the keys cannot be fetched. */
  get(kid: string): Promise<CryptoKey | undefined>;
}

/** The team's signing keys, kept for the life of the isolate and fetched again after KEY_TTL_MS. */
function createKeyCache(url: string, deps: { fetch: typeof fetch; now: () => Date }): KeyCache {
  let keys = new Map<string, CryptoKey>();
  let fetchedAt = Number.NEGATIVE_INFINITY;

  async function refresh(): Promise<void> {
    const res = await deps.fetch(url, { signal: AbortSignal.timeout(KEYS_TIMEOUT_MS) });
    if (!res.ok) throw new Error(`Access keys answered ${String(res.status)}`);
    const body = await res.json<{ keys?: unknown }>();
    const fresh = new Map<string, CryptoKey>();
    for (const jwk of Array.isArray(body.keys) ? (body.keys as JsonWebKey[]) : []) {
      const kid = (jwk as { kid?: unknown }).kid;
      if (typeof kid !== "string" || jwk.kty !== "RSA") continue;
      const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, [
        "verify",
      ]);
      fresh.set(kid, key);
    }
    keys = fresh;
    fetchedAt = deps.now().getTime();
  }

  return {
    async get(kid) {
      const age = deps.now().getTime() - fetchedAt;
      if (age > KEY_TTL_MS || (!keys.has(kid) && age > UNKNOWN_KEY_REFETCH_MS)) await refresh();
      return keys.get(kid);
    },
  };
}

function decodeBase64Url(part: string): Uint8Array<ArrayBuffer> | null {
  if (!/^[A-Za-z0-9_-]*$/.test(part)) return null;
  const base64 = part.replace(/-/g, "+").replace(/_/g, "/");
  try {
    return Uint8Array.from(atob(base64 + "=".repeat((4 - (base64.length % 4)) % 4)), (char) => char.charCodeAt(0));
  } catch {
    return null;
  }
}

function decodeJson(part: string): Record<string, unknown> | null {
  const bytes = decodeBase64Url(part);
  if (bytes === null) return null;
  try {
    const value: unknown = JSON.parse(new TextDecoder().decode(bytes));
    return typeof value === "object" && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}
