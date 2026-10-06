// One requester for every Zoho client (docs/decisions/0070-vendor-correctness.md):
// the CRM and Books each on a client of its own. Each request goes through
// vendorFetch, and a failed one becomes a ZohoError.
//
// The access token lasts an hour and is kept in D1 (`zoho_access_tokens`), so
// every invocation uses the same one. Zoho mints at most 10 per 10 minutes per
// refresh token (docs/archive/fsm-trial.md), and staging and production share
// the CRM's (ADR 0050), so a token is asked for sparingly:
//   - only when the one held is out of date, or Zoho says it is invalid; a 401
//     for anything else, such as a scope Zoho will not grant, is not answered
//     with a new token;
//   - by one caller at a time, under a lease; another waits for its token;
//   - not at all for ten minutes after Zoho refuses one ("Access Denied"),
//     during which every call fails at once.

import { z } from "zod";
import type { Logger } from "../log.ts";
import { ProviderError } from "./provider-error.ts";
import { MINUTE_MS } from "../lib/durations.ts";
import { parseAnswer, shapeOf, vendorAnswerOf, type VendorAnswer } from "./vendor-answer.ts";
import { vendorFetch, VendorUnreachable, type Vendor } from "./vendor-fetch.ts";

/**
 * Nobody waits on most calls; queue consumers and the cron make them. On
 * staging a token refresh once took over 10 s, and a slow answer beats a retry
 * that may duplicate a record Zoho did create. See docs/decisions/0012-zoho-sync.md.
 */
export const BACKGROUND_TIMEOUT_MS = 20_000;
/** A call a person waits on, a document opened or a visit moved, gives up sooner. */
export const WAITED_TIMEOUT_MS = 8_000;
/** Refresh a token this long before Zoho would expire it. */
const TOKEN_MARGIN_MS = MINUTE_MS;
/** After Zoho refuses a new token, none is asked for this long. */
export const TOKEN_COOL_DOWN_MS = 10 * MINUTE_MS;
/** A caller waiting for another's token looks again this often. */
const LEASE_POLL_MS = 250;

/** The 401 codes that say the access token itself is no good; any other 401 a new token would not change. */
const INVALID_TOKEN_CODES: ReadonlySet<string> = new Set([
  "INVALID_TOKEN",
  "INVALID_OAUTHTOKEN",
  "AUTHENTICATION_FAILURE",
  // Books' own code for an access token it does not accept.
  "14",
]);

/** A failed Zoho call. The message never includes record data. */
export class ZohoError extends ProviderError {
  override readonly name = "ZohoError";

  constructor(status: number, code: string, message: string, refusal?: boolean) {
    super(status, code, `Zoho ${String(status)} ${code}: ${message}`, { refusal, said: message });
  }
}

/** The Zoho clients, each with its own access token. */
export type ZohoClientName = "crm" | "books";

const vendorOf = (name: ZohoClientName): Vendor => `zoho-${name}`;

interface ZohoClient {
  readonly clientId: string;
  readonly clientSecret: string;
  readonly refreshToken: string;
  /** e.g. accounts.zoho.in */
  readonly accountsHost: string;
  /** e.g. www.zohoapis.in */
  readonly apiHost: string;
}

export interface ZohoRequesterDependencies {
  readonly db: D1Database;
  readonly fetch: typeof fetch;
  readonly now: () => Date;
  readonly log: Logger;
  /** How long one call may take; BACKGROUND_TIMEOUT_MS unless a person waits on it. */
  readonly timeoutMs?: number;
}

/** A write: JSON for a module call, with any headers of the vendor's own; multipart for a file upload; or a delete. */
export type ZohoWrite =
  | { method: "POST" | "PUT"; body: unknown; headers?: Readonly<Record<string, string>> }
  | { method: "POST"; form: FormData }
  | { method: "DELETE" };

/** A write's body: a multipart form as it is, which sets its own Content-Type, JSON, or none for a delete. */
function bodyOf(write: ZohoWrite): FormData | string | undefined {
  if ("form" in write) return write.form;
  if ("body" in write) return JSON.stringify(write.body);
  return undefined;
}

/** The headers a write adds: JSON's Content-Type and the vendor's own. */
function headersOf(write: ZohoWrite | undefined): Record<string, string> {
  if (write === undefined || !("body" in write)) return {};
  return { "Content-Type": "application/json", ...write.headers };
}

/** One authorised call to a path on the API host. A failed one throws a ZohoError. */
export type ZohoRequest = (step: string, path: string, write?: ZohoWrite) => Promise<Response>;

export function createZohoRequester(
  name: ZohoClientName,
  client: ZohoClient,
  deps: ZohoRequesterDependencies,
): ZohoRequest {
  const timeoutMs = deps.timeoutMs ?? BACKGROUND_TIMEOUT_MS;
  const tokens = createTokenKeeper(name, client, { ...deps, timeoutMs });

  async function send(step: string, path: string, token: string, write: ZohoWrite | undefined): Promise<Response> {
    // A multipart upload sets its own Content-Type, with the boundary.
    return zohoSend(deps, { vendor: vendorOf(name), step, timeoutMs }, `https://${client.apiHost}${path}`, {
      headers: { Authorization: `Zoho-oauthtoken ${token}`, ...headersOf(write) },
      ...(write === undefined ? {} : { method: write.method, body: bodyOf(write) }),
    });
  }

  return async (step, path, write) => {
    const token = await tokens.current();
    const response = await send(step, path, token, write);
    if (response.status !== 401) return checked(response);

    const error = zohoErrorFrom(401, await response.json().catch(() => null));
    if (!INVALID_TOKEN_CODES.has(error.code)) throw error;
    return checked(await send(step, path, await tokens.renew(token), write));
  };
}

async function checked(response: Response): Promise<Response> {
  if (response.ok) return response;
  throw zohoErrorFrom(response.status, await response.json().catch(() => null));
}

/** One HTTP request to Zoho. A call that gets no answer throws a VendorUnreachable naming the step. */
async function zohoSend(
  deps: ZohoRequesterDependencies,
  call: { vendor: Vendor; step: string; timeoutMs: number },
  url: string,
  init: RequestInit,
): Promise<Response> {
  const sent = await vendorFetch(deps, { ...call, codeOf: zohoCodeOf }, url, init);
  if (sent instanceof VendorUnreachable) throw sent;
  return sent;
}

// ---------------------------------------------------------------------------
// The access token
// ---------------------------------------------------------------------------

interface Held {
  access_token: string | null;
  expires_at: string | null;
  refreshing_until: string | null;
  cool_down_until: string | null;
}

/** What Zoho's token endpoint answers: a token, or an error, sometimes under a 200. */
const TokenAnswer = z.object({
  access_token: z.string().optional(),
  expires_in: z.number().optional(),
  error: z.string().optional(),
});

function createTokenKeeper(
  name: ZohoClientName,
  client: ZohoClient,
  deps: ZohoRequesterDependencies & { timeoutMs: number },
) {
  const { db, now } = deps;
  /** A caller holds the lease for as long as its token call may take, and a little over. */
  const leaseMs = deps.timeoutMs + 5_000;

  const read = async (): Promise<Held | null> =>
    db
      .prepare(
        `SELECT access_token, expires_at, refreshing_until, cool_down_until FROM zoho_access_tokens
         WHERE client = ?1`,
      )
      .bind(name)
      .first<Held>();

  /** The token held, while it has more than a minute to run; null when there is none such. */
  function usableToken(held: Held | null): string | null {
    if (held === null) return null;
    const { access_token: token, expires_at: expiresAt } = held;
    if (token === null || expiresAt === null) return null;
    return Date.parse(expiresAt) - now().getTime() > TOKEN_MARGIN_MS ? token : null;
  }

  function refuseWhileCooling(held: Held | null): void {
    const until = held?.cool_down_until ?? null;
    if (until === null || Date.parse(until) <= now().getTime()) return;
    throw new ZohoError(
      0,
      "TOKEN_COOLING_DOWN",
      `Zoho refused a new access token; no token asked for until ${until}`,
      false,
    );
  }

  /** True when this caller now holds the lease to ask for a token. */
  async function takeLease(): Promise<boolean> {
    const at = now();
    const leased = await db
      .prepare(
        `INSERT INTO zoho_access_tokens (client, refreshing_until) VALUES (?1, ?2)
         ON CONFLICT (client) DO UPDATE SET refreshing_until = excluded.refreshing_until
           WHERE refreshing_until IS NULL OR refreshing_until <= ?3
         RETURNING client`,
      )
      .bind(name, new Date(at.getTime() + leaseMs).toISOString(), at.toISOString())
      .first();
    return leased !== null;
  }

  async function mint(): Promise<string> {
    const query = new URLSearchParams({
      refresh_token: client.refreshToken,
      client_id: client.clientId,
      client_secret: client.clientSecret,
      grant_type: "refresh_token",
    });
    const url = `https://${client.accountsHost}/oauth/v2/token?${query.toString()}`;
    let response: Response;
    try {
      const call = { vendor: vendorOf(name), step: "token", timeoutMs: deps.timeoutMs };
      response = await zohoSend(deps, call, url, { method: "POST" });
    } catch (error) {
      await release();
      throw error;
    }
    const answer = TokenAnswer.safeParse(await response.json().catch(() => null));
    const { access_token: token, expires_in: expiresIn = 3600, error } = answer.success ? answer.data : {};
    if (token === undefined) {
      const code = error ?? "TOKEN_REFRESH_FAILED";
      await (code === "Access Denied" ? coolDown() : release());
      throw new ZohoError(response.status, code, "could not refresh the access token", false);
    }

    await db
      .prepare(
        `UPDATE zoho_access_tokens SET access_token = ?2, expires_at = ?3, refreshing_until = NULL,
           cool_down_until = NULL
         WHERE client = ?1`,
      )
      .bind(name, token, new Date(now().getTime() + expiresIn * 1000).toISOString())
      .run();
    return token;
  }

  async function release(): Promise<void> {
    await db.prepare("UPDATE zoho_access_tokens SET refreshing_until = NULL WHERE client = ?1").bind(name).run();
  }

  async function coolDown(): Promise<void> {
    await db
      .prepare("UPDATE zoho_access_tokens SET refreshing_until = NULL, cool_down_until = ?2 WHERE client = ?1")
      .bind(name, new Date(now().getTime() + TOKEN_COOL_DOWN_MS).toISOString())
      .run();
  }

  /**
   * A token other than `rejected`: one another caller has put in D1 since, or a
   * new one, asked for under the lease. A caller that finds the lease taken
   * waits for the token it brings, until the lease runs out.
   */
  async function renew(rejected: string | null): Promise<string> {
    for (let waited = 0; ; waited += LEASE_POLL_MS) {
      const held = await read();
      refuseWhileCooling(held);
      const token = usableToken(held);
      if (token !== null && token !== rejected) return token;
      if (await takeLease()) return mint();
      if (waited >= leaseMs) {
        throw new ZohoError(0, "TOKEN_BUSY", "another caller's token request never finished", false);
      }
      await new Promise((resolve) => setTimeout(resolve, LEASE_POLL_MS));
    }
  }

  return {
    /** The token held, or a new one when it is out of date. */
    async current(): Promise<string> {
      const held = await read();
      refuseWhileCooling(held);
      return usableToken(held) ?? renew(null);
    },
    renew,
  };
}

interface ZohoErrorBody {
  code?: unknown;
  message?: unknown;
  details?: unknown;
}

/** The record a failed answer is about: the first in `data`, else the body itself. */
function failedRecord(json: unknown): ZohoErrorBody | null {
  const body = json as (ZohoErrorBody & { data?: ZohoErrorBody[] }) | null;
  return Array.isArray(body?.data) ? (body.data[0] ?? body) : body;
}

/** Zoho's code in a failed answer. Books' codes are numbers, the CRM's words. */
function zohoCodeOf(json: unknown): string {
  const code = failedRecord(json)?.code;
  return typeof code === "string" || typeof code === "number" ? String(code) : "HTTP_ERROR";
}

/**
 * Zoho's error body, as a ZohoError: the code and message of the first record, else of the body, and the field Zoho
 * names, e.g. "Zoho 400 INVALID_DATA: invalid data (field Mobile, expected phone, at $.data[0].Mobile)".
 */
function zohoErrorFrom(status: number, json: unknown): ZohoError {
  const detail = failedRecord(json);
  const message = typeof detail?.message === "string" ? detail.message : "request failed";
  const field = refusedField(detail?.details);
  return new ZohoError(status, zohoCodeOf(json), field === "" ? message : `${message} (${field})`);
}

/**
 * The field a refusal names: its API name, the type Zoho expected and where it sat. Details naming no field, as a
 * blueprint's refusal may, are told by their keys. Never the value sent.
 */
function refusedField(details: unknown): string {
  if (typeof details !== "object" || details === null) return "";
  const { api_name: name, expected_data_type: expected, json_path: path } = details as Record<string, unknown>;
  const parts: string[] = [];
  if (typeof name === "string") parts.push(`field ${name}`);
  if (typeof expected === "string") parts.push(`expected ${expected}`);
  if (typeof path === "string") parts.push(`at ${path}`);
  if (parts.length === 0 && Object.keys(details).length > 0) parts.push(`details has ${shapeOf(details)}`);
  return parts.join(", ");
}

// ---------------------------------------------------------------------------
// Reading an answer
// ---------------------------------------------------------------------------

/** What Zoho answered one step: the status, and the body as JSON, null for an empty 204. */
export type ZohoAnswer = VendorAnswer;

/** A successful call's answer. One that is not JSON fails as an unexpected answer naming the step. */
export function answerOf(step: string, response: Response): Promise<ZohoAnswer> {
  return vendorAnswerOf("Zoho", step, response);
}

/** The value under `at` in an answer, read by `schema`; a misfit names the step and where it differs. */
export function readAnswer<T extends z.ZodType>(
  answer: ZohoAnswer,
  schema: T,
  at: readonly PropertyKey[] = [],
): z.infer<T> {
  return parseAnswer(schema, answer, at);
}
