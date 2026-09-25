// Cloudflare Access on the ops surface: the token is checked against the
// team's published keys, and every call is audited under its identity before
// it runs (docs/decisions/0031-access-and-audit.md). The keys are generated
// here, so no real token or key is involved.

import { env } from "cloudflare:workers";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { AccessSettings } from "../../src/config/settings.ts";
import { ACCESS_TOKEN_HEADER, createAccessVerifier, type AccessVerifier } from "../../src/http/access.ts";
import { appFor, captureLogs, fakeDependencies, fakeFetch, json, markDatabase, NOW, request } from "./helpers.ts";

const TEAM = "summer-math-0275.cloudflareaccess.com";
const CERTS = `https://${TEAM}/cdn-cgi/access/certs`;
const AUDIENCE = "ops-audience-tag";
const SETTINGS: AccessSettings = { teamDomain: TEAM, opsAudience: AUDIENCE };
const NOW_SECONDS = Math.floor(NOW.getTime() / 1000);

interface SigningKey {
  readonly kid: string;
  readonly privateKey: CryptoKey;
  readonly jwk: JsonWebKey;
}

async function signingKey(kid: string): Promise<SigningKey> {
  const pair = (await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["sign", "verify"],
  )) as CryptoKeyPair;
  const jwk = (await crypto.subtle.exportKey("jwk", pair.publicKey)) as JsonWebKey;
  return { kid, privateKey: pair.privateKey, jwk: { ...jwk, kid, alg: "RS256", use: "sig" } as JsonWebKey };
}

function base64Url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

const encodeJson = (value: unknown): string => base64Url(new TextEncoder().encode(JSON.stringify(value)));

async function tokenFor(key: SigningKey, claims: object, header: object = {}): Promise<string> {
  const head = encodeJson({ alg: "RS256", kid: key.kid, typ: "JWT", ...header });
  const body = encodeJson(claims);
  const signed = new TextEncoder().encode(`${head}.${body}`);
  const signature = new Uint8Array(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key.privateKey, signed));
  return `${head}.${body}.${base64Url(signature)}`;
}

/** A member of staff's token, as Access issues it, valid for the next hour. */
function staffClaims(overrides: object = {}): object {
  return {
    iss: `https://${TEAM}`,
    aud: [AUDIENCE],
    email: "Ops.Lead@ManeMan.in",
    sub: "5f4b0c2e-0000-4000-8000-000000000001",
    type: "app",
    iat: NOW_SECONDS - 60,
    nbf: NOW_SECONDS - 60,
    exp: NOW_SECONDS + 3600,
    ...overrides,
  };
}

let published: SigningKey;
let other: SigningKey;

beforeAll(async () => {
  published = await signingKey("key-1");
  other = await signingKey("key-2");
});

/** A verifier whose clock is `now` and whose Access team publishes `keys`. */
function verifierWith(keys: readonly SigningKey[], now: () => Date = () => NOW) {
  const outbound = fakeFetch({ [CERTS]: () => json({ keys: keys.map((key) => key.jwk) }) });
  return { verifier: createAccessVerifier(SETTINGS, { fetch: outbound.fetch, now }), calls: outbound.calls };
}

const withToken = (token: string) =>
  new Request("https://ops.maneman.test/api/health", { headers: { [ACCESS_TOKEN_HEADER]: token } });

describe("the Access token", () => {
  it("names the member of staff, by e-mail in lower case", async () => {
    const { verifier } = verifierWith([published]);
    const result = await verifier.verify(withToken(await tokenFor(published, staffClaims())));
    expect(result).toEqual({ ok: true, identity: { kind: "staff", email: "ops.lead@maneman.in" } });
  });

  it("names a service token by its client ID", async () => {
    const { verifier } = verifierWith([published]);
    const claims = staffClaims({ email: "", sub: "", common_name: "a1b2c3.access" });
    const result = await verifier.verify(withToken(await tokenFor(published, claims)));
    expect(result).toEqual({ ok: true, identity: { kind: "service", clientId: "a1b2c3.access" } });
  });

  it("accepts an audience given as a single string", async () => {
    const { verifier } = verifierWith([published]);
    const result = await verifier.verify(withToken(await tokenFor(published, staffClaims({ aud: AUDIENCE }))));
    expect(result.ok).toBe(true);
  });

  it.each<[string, object, string]>([
    ["is for another application", { aud: ["another-audience"] }, "wrong_audience"],
    ["is from another team", { iss: "https://someone-else.cloudflareaccess.com" }, "wrong_issuer"],
    ["has expired", { exp: NOW_SECONDS }, "expired"],
    ["carries no expiry", { exp: undefined }, "expired"],
    ["is not valid yet", { nbf: NOW_SECONDS + 120 }, "not_yet_valid"],
    ["names nobody", { email: "", common_name: undefined }, "no_identity"],
  ])("is refused when it %s", async (_label, overrides, reason) => {
    const { verifier } = verifierWith([published]);
    const result = await verifier.verify(withToken(await tokenFor(published, staffClaims(overrides))));
    expect(result).toEqual({ ok: false, reason });
  });

  it("is refused when it is missing", async () => {
    const { verifier, calls } = verifierWith([published]);
    expect(await verifier.verify(new Request("https://ops.maneman.test/api/health"))).toEqual({
      ok: false,
      reason: "missing",
    });
    expect(calls).toHaveLength(0);
  });

  it.each(["not-a-token", "a.b", "a.b.c.d", "!!!.???.***", `${encodeJson({ alg: "RS256" })}.bm90IGpzb24.c2ln`])(
    "is refused when it is malformed: %s",
    async (token) => {
      const { verifier } = verifierWith([published]);
      expect(await verifier.verify(withToken(token))).toEqual({ ok: false, reason: "malformed" });
    },
  );

  it("is refused when it is signed by a key Access does not publish", async () => {
    const { verifier } = verifierWith([published]);
    const result = await verifier.verify(withToken(await tokenFor(other, staffClaims())));
    expect(result).toEqual({ ok: false, reason: "unknown_key" });
  });

  it("is refused when another key signed it under a published key's ID", async () => {
    const { verifier } = verifierWith([published]);
    const forged = await tokenFor({ ...other, kid: published.kid }, staffClaims());
    expect(await verifier.verify(withToken(forged))).toEqual({ ok: false, reason: "bad_signature" });
  });

  it("is refused when its claims were changed after signing", async () => {
    const { verifier } = verifierWith([published]);
    const [head, , signature] = (await tokenFor(published, staffClaims())).split(".");
    const altered = `${head ?? ""}.${encodeJson(staffClaims({ email: "someone.else@maneman.in" }))}.${signature ?? ""}`;
    expect(await verifier.verify(withToken(altered))).toEqual({ ok: false, reason: "bad_signature" });
  });

  it.each([{ alg: "none" }, { alg: "HS256" }, { kid: 7 }])("is refused when its header is %o", async (header) => {
    const { verifier } = verifierWith([published]);
    const token = await tokenFor(published, staffClaims(), header);
    expect(await verifier.verify(withToken(token))).toEqual({ ok: false, reason: "wrong_algorithm" });
  });
});

describe("Access's signing keys", () => {
  it("are fetched once and kept, not fetched for every request", async () => {
    const { verifier, calls } = verifierWith([published]);
    for (let i = 0; i < 3; i += 1) await verifier.verify(withToken(await tokenFor(published, staffClaims())));
    expect(calls.map((call) => call.url)).toEqual([CERTS]);
  });

  it("are fetched again after an hour, so a rotated key is picked up", async () => {
    let now = NOW;
    const { verifier, calls } = verifierWith([published], () => now);
    await verifier.verify(withToken(await tokenFor(published, staffClaims())));
    now = new Date(NOW.getTime() + 61 * 60 * 1000);
    const later = staffClaims({ iat: NOW_SECONDS + 3600, nbf: NOW_SECONDS + 3600, exp: NOW_SECONDS + 7200 });
    await verifier.verify(withToken(await tokenFor(published, later)));
    expect(calls).toHaveLength(2);
  });

  it("are fetched again for an unknown key at most once a minute, so forged key IDs cannot flood Access", async () => {
    let now = NOW;
    const { verifier, calls } = verifierWith([published], () => now);
    await verifier.verify(withToken(await tokenFor(published, staffClaims())));
    for (let i = 0; i < 5; i += 1) await verifier.verify(withToken(await tokenFor(other, staffClaims())));
    expect(calls).toHaveLength(1);
    now = new Date(NOW.getTime() + 61 * 1000);
    await verifier.verify(withToken(await tokenFor(other, staffClaims())));
    expect(calls).toHaveLength(2);
  });

  it("are never fetched where the ops surface is switched off, and a stray call fails loudly", async () => {
    const outbound = fakeFetch({});
    const verifier = createAccessVerifier(
      { teamDomain: TEAM, opsAudience: null },
      { fetch: outbound.fetch, now: () => NOW },
    );
    await expect(verifier.verify(withToken(await tokenFor(published, staffClaims())))).rejects.toThrow(
      "ACCESS_OPS_AUD is not set",
    );
    expect(outbound.calls).toHaveLength(0);
  });

  it("that cannot be fetched refuse the request as unavailable, not as unauthorised", async () => {
    const outbound = fakeFetch({ [CERTS]: () => json({ error: "down" }, 502) });
    const verifier = createAccessVerifier(SETTINGS, { fetch: outbound.fetch, now: () => NOW });
    const result = await verifier.verify(withToken(await tokenFor(published, staffClaims())));
    expect(result).toMatchObject({ ok: false, reason: "keys_unavailable" });
  });

  // A fetch that hangs would hold every ops request open until the Worker's own limit.
  it("are fetched with a time limit, which then refuses the request as unavailable", async () => {
    const signals: (AbortSignal | null | undefined)[] = [];
    const timedOut: typeof fetch = (_input, init) => {
      signals.push(init?.signal);
      return Promise.reject(new DOMException("The operation timed out.", "TimeoutError"));
    };
    const verifier = createAccessVerifier(SETTINGS, { fetch: timedOut, now: () => NOW });

    const result = await verifier.verify(withToken(await tokenFor(published, staffClaims())));

    expect(signals).toEqual([expect.any(AbortSignal)]);
    expect(result).toMatchObject({ ok: false, reason: "keys_unavailable" });
  });
});

describe("the ops surface", () => {
  let logs: ReturnType<typeof captureLogs>;
  let verifier: AccessVerifier;

  beforeEach(async () => {
    logs = captureLogs();
    await markDatabase();
    verifier = verifierWith([published]).verifier;
  });

  const opsApp = () => appFor("local", fakeDependencies({ access: verifier }), {}, "ops");

  it("refuses a call without an Access token, and writes nothing to the audit log", async () => {
    const res = await request(opsApp(), "/api/health");

    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: { code: "access_required" } });
    expect(logs.lines()).toContainEqual(expect.objectContaining({ event: "access_refused", reason: "missing" }));
    expect(await auditRows()).toEqual([]);
  });

  it("answers a member of staff, having audited the call under their e-mail", async () => {
    const res = await request(opsApp(), "/api/health", {
      headers: { [ACCESS_TOKEN_HEADER]: await tokenFor(published, staffClaims()) },
    });

    expect(res.status).toBe(200);
    const [row, ...rest] = await auditRows();
    expect(rest).toEqual([]);
    expect(row).toMatchObject({
      surface: "ops",
      actor_kind: "staff",
      actor: "ops.lead@maneman.in",
      action: "ops.call",
      request_id: res.headers.get("X-Request-Id"),
    });
    expect(JSON.parse(row?.detail ?? "null")).toEqual({ method: "GET", route: "/api/health" });
  });

  it("audits the call before the route runs, and refuses it if the audit cannot be written", async () => {
    const app = opsApp();
    const broken = { ...env, DB: failingInserts(env.DB) };
    const res = await request(
      app,
      "/api/health",
      {
        headers: { [ACCESS_TOKEN_HEADER]: await tokenFor(published, staffClaims()) },
      },
      broken,
    );

    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ error: { code: "unavailable" } });
    expect(logs.lines()).toContainEqual(expect.objectContaining({ event: "audit_write_failed" }));
  });

  it("answers 503, not 403, while Access's keys cannot be fetched", async () => {
    const outbound = fakeFetch({ [CERTS]: () => json({}, 500) });
    const app = appFor(
      "local",
      fakeDependencies({ access: createAccessVerifier(SETTINGS, { fetch: outbound.fetch, now: () => NOW }) }),
      {},
      "ops",
    );
    const res = await request(app, "/api/health", {
      headers: { [ACCESS_TOKEN_HEADER]: await tokenFor(published, staffClaims()) },
    });
    expect(res.status).toBe(503);
    expect(logs.lines()).toContainEqual(expect.objectContaining({ event: "access_keys_unavailable" }));
  });

  it("is the only surface that asks for Access", async () => {
    for (const surface of ["public", "client", "tech"] as const) {
      const app = appFor("local", fakeDependencies({ access: verifier }), {}, surface);
      expect((await request(app, "/api/health")).status, surface).toBe(200);
    }
    expect(await auditRows()).toEqual([]);
  });
});

describe("the audit log", () => {
  beforeEach(async () => {
    await env.DB.prepare(
      "INSERT INTO audit_log (at, surface, actor_kind, actor, action) VALUES ('2026-09-22T00:00:00Z', 'ops', 'staff', 'a@maneman.in', 'ops.call')",
    ).run();
  });

  it("refuses to change an entry", async () => {
    await expect(env.DB.prepare("UPDATE audit_log SET actor = 'b@maneman.in'").run()).rejects.toThrow(/append-only/);
  });

  it("refuses to delete an entry", async () => {
    await expect(env.DB.prepare("DELETE FROM audit_log").run()).rejects.toThrow(/append-only/);
    expect(await auditRows()).toHaveLength(1);
  });

  it.each<[string, string, string]>([
    ["detail that is not JSON", "actor_kind, subject_kind, subject_id, detail", "'staff', NULL, NULL, 'not json'"],
    ["a subject kind without an ID", "actor_kind, subject_kind, subject_id, detail", "'staff', 'person', NULL, NULL"],
    ["an unknown kind of actor", "actor_kind, subject_kind, subject_id, detail", "'anyone', NULL, NULL, NULL"],
  ])("refuses %s", async (_label, columns, values) => {
    const insert = env.DB.prepare(
      `INSERT INTO audit_log (at, surface, actor, action, ${columns}) VALUES ('2026-09-22T00:00:00Z', 'ops', 'a@maneman.in', 'ops.call', ${values})`,
    );
    await expect(insert.run()).rejects.toThrow(/CHECK constraint failed/);
  });
});

interface AuditRow {
  surface: string;
  actor_kind: string;
  actor: string;
  action: string;
  request_id: string | null;
  detail: string | null;
}

async function auditRows(): Promise<AuditRow[]> {
  return (await env.DB.prepare("SELECT * FROM audit_log ORDER BY id").all<AuditRow>()).results;
}

/** The database, except that every INSERT fails. */
function failingInserts(db: D1Database): D1Database {
  return new Proxy(db, {
    get(target, property, receiver) {
      if (property !== "prepare") return Reflect.get(target, property, receiver) as unknown;
      return (sql: string) => {
        if (/^\s*INSERT/i.test(sql)) throw new Error("D1_ERROR: simulated write failure");
        return target.prepare(sql);
      };
    },
  });
}
