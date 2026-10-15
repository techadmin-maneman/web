// Every call to Zoho counted by India's day, each client its own (src/providers/zoho-http.ts), and ops told when
// Books' day nears its allowance (src/domain/books/books-calls.ts).

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { BOOKS_DAILY_CALLS, tellOfBooksCalls } from "../../../src/domain/books/books-calls.ts";
import { createLogger } from "../../../src/log.ts";
import { createZohoRequester, ZOHO_CALLS_SCOPE } from "../../../src/providers/zoho-http.ts";
import { fakeDependencies, fakeFetch, json, markDatabase, NOW } from "../helpers.ts";

const CLIENT = {
  clientId: "1000.CLIENT",
  clientSecret: "client-secret",
  refreshToken: "1000.refresh",
  accountsHost: "accounts.zoho.in",
  apiHost: "www.zohoapis.in",
};
const INVOICES_URL = "https://www.zohoapis.in/books/v3/invoices";

/** NOW is 12 noon in India on 21 September 2026. */
const TODAY = "2026-09-21";

const callsOn = async (client: string, day: string) =>
  env.DB.prepare("SELECT count FROM counters WHERE scope = ?1 AND key = ?2 AND window_start = ?3")
    .bind(ZOHO_CALLS_SCOPE, client, day)
    .first<number>("count");

const callsToday = (calls: number) =>
  env.DB.prepare("INSERT INTO counters (scope, key, window_start, count) VALUES (?1, 'books', ?2, ?3)")
    .bind(ZOHO_CALLS_SCOPE, TODAY, calls)
    .run();

beforeEach(async () => {
  await markDatabase();
  await env.DB.prepare("INSERT INTO zoho_access_tokens (client, access_token, expires_at) VALUES ('books', 'held', ?1)")
    .bind(new Date(NOW.getTime() + 3_600_000).toISOString())
    .run();
});

describe("Zoho's calls a day", () => {
  it("are counted for each call by India's day, one Zoho refused too", async () => {
    let answer = json({ invoices: [] });
    const http = fakeFetch({ [INVOICES_URL]: () => answer });
    const request = createZohoRequester("books", CLIENT, {
      db: env.DB,
      fetch: http.fetch,
      now: () => NOW,
      log: createLogger(),
    });
    await request("list", "/books/v3/invoices");
    await request("list", "/books/v3/invoices");
    answer = json({ code: 1002, message: "Invoice does not exist." }, 404);
    await request("list", "/books/v3/invoices").catch(() => null);
    expect(await callsOn("books", TODAY)).toBe(3);
    expect(await callsOn("crm", TODAY)).toBeNull();
  });
});

describe("Books' calls against its allowance", () => {
  it("say nothing below 70% of the day's allowance", async () => {
    const deps = fakeDependencies();
    await callsToday((BOOKS_DAILY_CALLS * 70) / 100 - 1);
    expect(await tellOfBooksCalls(env.DB, deps, NOW)).toBe(3499);
    expect(deps.alerts).toEqual([]);
  });

  it("tell ops once at 70%, and close once the day's count starts again", async () => {
    const deps = fakeDependencies();
    await callsToday((BOOKS_DAILY_CALLS * 70) / 100);
    await tellOfBooksCalls(env.DB, deps, NOW);
    await tellOfBooksCalls(env.DB, deps, NOW);
    expect(deps.alerts).toEqual([expect.stringContaining("3500 of its 5000 API calls a day used today") as string]);

    await tellOfBooksCalls(env.DB, deps, new Date(NOW.getTime() + 24 * 3_600_000));
    const open = await env.DB.prepare("SELECT resolved_at FROM alerts WHERE key = 'books_calls_high'").first(
      "resolved_at",
    );
    expect(open).not.toBeNull();
  });
});
