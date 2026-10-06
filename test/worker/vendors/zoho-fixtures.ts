// What the Zoho tests share (zoho*.test.ts): the settings, Zoho's token, Leads and search addresses, its answers faked,
// and the body of a call it was sent.

import { env } from "cloudflare:workers";
import type { ZohoSettings } from "../../../src/config/settings.ts";
import { createLogger } from "../../../src/log.ts";
import { createZohoCrm } from "../../../src/providers/crm/zoho.ts";
import { NOW, fakeFetch, json, type RecordedCall } from "../helpers.ts";

export const SETTINGS: ZohoSettings = {
  clientId: "1000.CLIENT",
  clientSecret: "client-secret",
  refreshToken: "1000.refresh",
  accountsHost: "accounts.zoho.in",
  apiHost: "www.zohoapis.in",
  larId: "lar-123",
};

export const TOKEN_URL = "https://accounts.zoho.in/oauth/v2/token";

export const LEADS_URL = "https://www.zohoapis.in/crm/v8/Leads";

export const SEARCH_URL = "https://www.zohoapis.in/crm/v8/Leads/search";

export const updated = (id: string) => json({ data: [{ code: "SUCCESS", status: "success", details: { id } }] });

export const noMatch = () => new Response(null, { status: 204 });

export const tokenIssued = (token = "access-1") =>
  json({ access_token: token, expires_in: 3600, token_type: "Bearer" });

export function zoho(routes: Parameters<typeof fakeFetch>[0]) {
  const http = fakeFetch(routes);
  const crm = createZohoCrm(SETTINGS, { db: env.DB, fetch: http.fetch, now: () => NOW, log: createLogger() });
  return { crm, calls: http.calls };
}

export function bodyOf(call: RecordedCall | undefined): Record<string, unknown> {
  return JSON.parse(call?.body ?? "{}") as Record<string, unknown>;
}
