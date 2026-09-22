// What every Zoho client shares: one timed, logged request, the error a
// failed call becomes, and the access token, which lasts an hour and is kept
// in D1 so every invocation uses the same one. Zoho mints at most 10 tokens
// per 10 minutes per refresh token (docs/decisions/fsm-trial.md), so a token
// per call would soon be refused.

import type { Logger } from "../log.ts";

/**
 * No one waits on these calls; queue consumers make them. On staging a token
 * refresh once took over 10 s, and a slow answer beats a retry that may
 * duplicate a record Zoho did create. See docs/decisions/0012-zoho-sync.md.
 */
const TIMEOUT_MS = 20_000;
/** Refresh a token this long before Zoho would expire it. */
const TOKEN_MARGIN_MS = 60_000;

/** A failed Zoho call. The message never includes record data. */
export class ZohoError extends Error {
  override readonly name = "ZohoError";
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(`Zoho ${String(status)} ${code}: ${message}`);
    this.status = status;
    this.code = code;
  }
}

export interface ZohoHttpDependencies {
  readonly fetch: typeof fetch;
  readonly now: () => Date;
  readonly log: Logger;
}

/**
 * One HTTP request to Zoho, timed and logged by step. The URL is never logged:
 * the token URL carries the client secret. A timeout becomes a ZohoError that
 * names the step, so an error says which call was slow.
 */
export async function zohoSend(
  deps: ZohoHttpDependencies,
  step: string,
  url: string,
  init: RequestInit,
): Promise<Response> {
  const started = Date.now();
  try {
    const response = await deps.fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
    deps.log.info("zoho_call", { step, status: response.status, duration_ms: Date.now() - started });
    return response;
  } catch (error) {
    const reason = error instanceof Error ? error.name : "unknown";
    deps.log.warn("zoho_call", { step, status: 0, reason, duration_ms: Date.now() - started });
    if (reason === "TimeoutError") {
      throw new ZohoError(0, "TIMEOUT", `${step} got no answer within ${String(TIMEOUT_MS / 1000)} s`);
    }
    throw error;
  }
}

export interface ZohoClient {
  readonly clientId: string;
  readonly clientSecret: string;
  readonly refreshToken: string;
  /** e.g. accounts.zoho.in */
  readonly accountsHost: string;
}

/** Where a client's access token is kept between invocations. */
export interface TokenStore {
  read(): Promise<{ accessToken: string; expiresAt: string } | null>;
  write(accessToken: string, expiresAt: string): Promise<void>;
}

/** Access tokens live an hour; one is shared by every invocation through the store. */
export function createTokenCache(client: ZohoClient, store: TokenStore, deps: ZohoHttpDependencies) {
  return {
    async get(forceRefresh: boolean): Promise<string> {
      if (!forceRefresh) {
        const cached = await store.read();
        if (cached !== null && Date.parse(cached.expiresAt) - deps.now().getTime() > TOKEN_MARGIN_MS) {
          return cached.accessToken;
        }
      }

      const query = new URLSearchParams({
        refresh_token: client.refreshToken,
        client_id: client.clientId,
        client_secret: client.clientSecret,
        grant_type: "refresh_token",
      });
      const response = await zohoSend(
        deps,
        "token",
        `https://${client.accountsHost}/oauth/v2/token?${query.toString()}`,
        {
          method: "POST",
        },
      );
      const json = (await response.json().catch(() => null)) as {
        access_token?: string;
        expires_in?: number;
        error?: string;
      } | null;
      if (typeof json?.access_token !== "string") {
        throw new ZohoError(
          response.status,
          json?.error ?? "TOKEN_REFRESH_FAILED",
          "could not refresh the access token",
        );
      }

      const expiresAt = new Date(deps.now().getTime() + (json.expires_in ?? 3600) * 1000).toISOString();
      await store.write(json.access_token, expiresAt);
      return json.access_token;
    },
  };
}

/** Zoho's error body, as a ZohoError: the code and message of the first record, else of the body. */
export function zohoErrorFrom(status: number, json: unknown): ZohoError {
  const body = json as { code?: unknown; message?: unknown; data?: { code?: unknown; message?: unknown }[] } | null;
  const detail = Array.isArray(body?.data) ? (body.data[0] ?? body) : body;
  const code = typeof detail?.code === "string" ? detail.code : "HTTP_ERROR";
  const message = typeof detail?.message === "string" ? detail.message : "request failed";
  return new ZohoError(status, code, message);
}
