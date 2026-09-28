import { createStubPayments } from "../../src/providers/payments.ts";
import { env } from "cloudflare:workers";
import { vi, type MockInstance } from "vitest";
import { createApp } from "../../src/app.ts";
import type { App } from "../../src/http/context.ts";
import { EXPECTED_DATABASE_NAME, type EnvironmentName, type Surface } from "../../src/config/environments.ts";
import type { Settings } from "../../src/config/settings.ts";
import type { Dependencies } from "../../src/dependencies.ts";
import { createAlertOnce, createResolveAlert } from "../../src/domain/alerts.ts";
import { erasePerson, personWithMobile, type ErasureSummary } from "../../src/domain/erasure.ts";
import type { StaticConfig } from "../../src/guard.ts";
import { createAccessVerifier } from "../../src/providers/cloudflare-access.ts";
import { createLogger } from "../../src/log.ts";
import { createStubCrm, type CrmProvider } from "../../src/providers/crm.ts";
import { createImageProvider } from "../../src/providers/image.ts";
import type { CodeChannel } from "../../src/providers/codes.ts";
import { createStubBooks } from "../../src/providers/books.ts";
import { createGeocodeProvider } from "../../src/providers/geocode.ts";
import { createStubFsm } from "../../src/providers/fsm.ts";
import { createStubMessaging } from "../../src/providers/messaging.ts";

export const TURNSTILE_TEST_SECRET = "1x0000000000000000000000000000000AA";

export const LOCAL_SETTINGS: Settings = {
  visitLeadDays: 2,
  leadMobileDailyLimit: 5,
  leadIpDailyLimit: 20,
  turnstileSecret: TURNSTILE_TEST_SECRET,
  acceptTurnstileTestToken: false,
  selfServeBooking: true,
  referrerNameOnInvite: true,
  fsmCataloguePush: false,
  ipHashSalt: "test-salt-that-is-long-enough-000000",
  alertWebhookUrl: null,
  leadWebhookUrl: null,
  erasureSecret: "test-erasure-secret-that-is-long-enough",
  zoho: null,
  zohoFsm: null,
  razorpay: null,
  geocode: { apiKey: null, dailyCeiling: 200 },
  access: null,
  login: {
    codePepper: "test-login-code-pepper-that-is-long-enough",
    codeMobileDailyLimit: 5,
    codeIpHourlyLimit: 10,
    codeDailyCeiling: 300,
    fixedCode: null,
  },
  tryon: {
    uploadIpHourlyLimit: 5,
    generateIpHourlyLimit: 5,
    claimMobileDailyLimit: 3,
    resultMessageMobileDailyLimit: 3,
    renderDailyCeiling: 20,
    uploadDailyCeiling: 40,
    resultReadDailyCeiling: 400,
    resultRetentionDays: 30,
    unknownColorRoute: "premium_original",
    creditFloor: 200,
    linkSigningKey: "test-link-signing-key-that-is-long-enough",
    ailabApiKey: null,
  },
  messaging: { enabled: true, resultTemplate: "tryon_result_v1", allowlist: [], evolution: null },
  devRoutes: false,
};

export const LOCAL_CONFIG: StaticConfig = {
  environment: "local",
  providers: {
    IMAGE_PROVIDER: "stub",
    CRM_PROVIDER: "stub",
    MESSAGING_PROVIDER: "stub",
    ACCESS_PROVIDER: "stub",
    SMS_PROVIDER: "stub",
    FSM_PROVIDER: "stub",
    BOOKS_PROVIDER: "stub",
    PAYMENTS_PROVIDER: "stub",
    GEOCODE_PROVIDER: "stub",
  },
  settings: LOCAL_SETTINGS,
};

/** Erases whoever has this number, as POST /api/erasure does, without the route's checks. */
export async function eraseByMobile(mobileE164: string, now: Date = NOW): Promise<ErasureSummary | null> {
  const personId = await personWithMobile(env.DB, mobileE164);
  return personId === null ? null : erasePerson(env, personId, now, createLogger());
}

export async function markDatabase(databaseName: string = EXPECTED_DATABASE_NAME.local): Promise<void> {
  await env.DB.prepare("INSERT INTO deployment_identity (id, database_name) VALUES (1, ?)").bind(databaseName).run();
}

/** Counts every row D1 says each statement read, however the statement was run. */
export function countRowsRead(): () => number {
  let read = 0;
  const counted = <T extends D1Result>(result: T): T => {
    read += result.meta.rows_read;
    return result;
  };
  const statement = Object.getPrototypeOf(env.DB.prepare("SELECT 1")) as D1PreparedStatement;
  const database = Object.getPrototypeOf(env.DB) as D1Database;
  // The real methods, each called below on the statement or database it belongs to.
  const real = {
    all: Reflect.get(statement, "all") as (this: D1PreparedStatement) => Promise<D1Result>,
    run: Reflect.get(statement, "run") as (this: D1PreparedStatement) => Promise<D1Result>,
    batch: Reflect.get(database, "batch") as (
      this: D1Database,
      statements: D1PreparedStatement[],
    ) => Promise<D1Result[]>,
  };
  vi.spyOn(statement, "all").mockImplementation(async function (this: D1PreparedStatement) {
    return counted(await real.all.call(this));
  });
  vi.spyOn(statement, "run").mockImplementation(async function (this: D1PreparedStatement) {
    return counted(await real.run.call(this));
  });
  // first() carries no meta, so it is answered from all().
  vi.spyOn(statement, "first").mockImplementation(async function (this: D1PreparedStatement, column?: string) {
    const [row] = counted(await real.all.call(this)).results as Record<string, unknown>[];
    if (row === undefined) return null;
    return column === undefined ? row : (row[column] ?? null);
  });
  vi.spyOn(database, "batch").mockImplementation(async function (this: D1Database, statements) {
    const results = await real.batch.call(this, statements);
    for (const result of results) counted(result);
    return results;
  });
  return () => read;
}

/** The address a client saved in the app, which they must have before any slot is held (ADR 0079). */
export async function savedAddress(personId: string, pincode = "122018"): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO addresses (id, person_id, created_at, line1, locality, city, pincode)
     VALUES (?1, ?2, ?3, 'House 4417, Tower C', 'Sector 65', 'Gurgaon', ?4)`,
  )
    .bind(crypto.randomUUID(), personId, NOW.toISOString(), pincode)
    .run();
}

// ---------------------------------------------------------------------------
// Fake outbound HTTP
// ---------------------------------------------------------------------------

export interface RecordedCall {
  readonly method: string;
  readonly url: string;
  readonly body: string;
  readonly headers: Headers;
}

type Handler = (call: RecordedCall) => Response | Promise<Response>;

/**
 * A fetch that answers by URL prefix and records every call. A URL with no
 * matching route fails the test rather than reaching the internet.
 */
export function fakeFetch(routes: Readonly<Record<string, Handler>>): { fetch: typeof fetch; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  const fetchImpl = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const request = new Request(input, init);
    const call: RecordedCall = {
      method: request.method,
      url: request.url,
      body: request.method === "GET" ? "" : await request.text(),
      headers: request.headers,
    };
    calls.push(call);
    const prefix = Object.keys(routes).find((candidate) => call.url.startsWith(candidate));
    const handler = prefix === undefined ? undefined : routes[prefix];
    if (handler === undefined) throw new Error(`unexpected outbound request: ${call.method} ${call.url}`);
    return handler(call);
  };
  return { fetch: fetchImpl, calls };
}

export const TURNSTILE_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

export const turnstilePasses: Handler = () => json({ success: true });

// ---------------------------------------------------------------------------
// App and dependencies
// ---------------------------------------------------------------------------

export const NOW = new Date("2026-09-21T06:30:00Z"); // 12:00 on Monday 21 September in India

export interface SentCode {
  readonly channel: CodeChannel;
  readonly to: string;
  readonly code: string;
}

export interface TestDependencies extends Dependencies {
  readonly alerts: string[];
  readonly leadNotices: string[];
  /** Every login code sent, as the phone would receive it. */
  readonly sentCodes: SentCode[];
}

export function fakeDependencies(overrides: Partial<Dependencies> = {}): TestDependencies {
  const alerts: string[] = [];
  const leadNotices: string[] = [];
  const sentCodes: SentCode[] = [];
  const now = overrides.now ?? (() => NOW);
  const alert =
    overrides.alert ??
    ((message: string) => {
      alerts.push(message);
      return Promise.resolve();
    });
  return {
    fetch: fakeFetch({ [TURNSTILE_URL]: turnstilePasses }).fetch,
    now,
    crm: createStubCrm(createLogger()),
    image: createImageProvider(null, { fetch, now }),
    geocode: createGeocodeProvider("stub", null, { fetch }),
    messaging: createStubMessaging(createLogger()),
    alert,
    alertOnce: createAlertOnce({ db: env.DB, alert, now, environment: "local", log: createLogger() }),
    resolveAlert: createResolveAlert({ db: env.DB, now }),
    alerts,
    notifyLead: (message) => {
      leadNotices.push(message);
      return Promise.resolve();
    },
    leadNotices,
    access: createAccessVerifier(null, { fetch, now }),
    codes: {
      smsAvailable: true,
      send: (channel, to, code) => {
        sentCodes.push({ channel, to, code });
        return Promise.resolve({ ok: true, providerMessageId: `code-${String(sentCodes.length)}` });
      },
    },
    sentCodes,
    fsm: createStubFsm(),
    books: createStubBooks(),
    payments: createStubPayments(),
    ...overrides,
  };
}

/** A fresh app (and so a fresh identity cache) per test. */
export function appFor(
  environment: EnvironmentName = "local",
  deps: Dependencies = fakeDependencies(),
  settings: Partial<Settings> = {},
  surface: Surface = "public",
): App {
  return createApp({ ...LOCAL_CONFIG, environment, settings: { ...LOCAL_SETTINGS, ...settings } }, () => deps, surface);
}

export function request(app: App, path: string, init?: RequestInit, bindings: Partial<Env> = {}): Promise<Response> {
  return Promise.resolve(app.request(`https://maneman.test${path}`, init, { ...env, ...bindings }));
}

/** A queue binding that keeps what is sent, instead of delivering it. */
export function fakeQueue(): Queue & { sent: unknown[] } {
  const sent: unknown[] = [];
  return {
    sent,
    send: (body: unknown) => {
      sent.push(body);
      return Promise.resolve();
    },
    sendBatch: (messages: Iterable<MessageSendRequest>) => {
      for (const message of messages) sent.push(message.body);
      return Promise.resolve();
    },
  } as unknown as Queue & { sent: unknown[] };
}

export function stubCrmThatFails(message: string): CrmProvider {
  const fails = () => Promise.reject(new Error(message));
  return { syncLead: fails, erasePerson: fails, updateContact: fails };
}

/** Captures every JSON log line written through console.*. */
export function captureLogs(): { lines: () => Record<string, unknown>[]; spies: MockInstance[] } {
  const spies = (["debug", "log", "warn", "error"] as const).map((method) => {
    const spy = vi.spyOn(console, method).mockImplementation(() => undefined);
    spy.mockClear(); // spyOn returns an existing spy, calls and all
    return spy;
  });
  return {
    spies,
    lines: () =>
      spies.flatMap((spy) => spy.mock.calls.map((call) => JSON.parse(String(call[0])) as Record<string, unknown>)),
  };
}
