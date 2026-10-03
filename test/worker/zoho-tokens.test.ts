// One requester for every Zoho client (src/providers/zoho-http.ts), and the
// access token it keeps: asked for only when the one held is invalid, by one
// caller at a time, and not at all for ten minutes after Zoho refuses one.
// Staging and production share the CRM's refresh token (ADR 0050), whose ten
// tokens in ten minutes a loop on either would use up for both.

import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NO_GST } from "../../src/config/gst.ts";
import { productionDependencies } from "../../src/dependencies.ts";
import { createLogger } from "../../src/log.ts";
import { isRefusal } from "../../src/providers/provider-error.ts";
import {
  createZohoRequester,
  TOKEN_COOL_DOWN_MS,
  ZohoError,
  type ZohoClientName,
} from "../../src/providers/zoho-http.ts";
import { fakeFetch, json, LOCAL_CONFIG, LOCAL_SETTINGS, NOW } from "./helpers.ts";

const CLIENT = {
  clientId: "1000.CLIENT",
  clientSecret: "client-secret",
  refreshToken: "1000.refresh",
  accountsHost: "accounts.zoho.in",
  apiHost: "www.zohoapis.in",
};
const TOKEN_URL = "https://accounts.zoho.in/oauth/v2/token";
const LEADS_URL = "https://www.zohoapis.in/crm/v8/Leads";

const issued = (token: string) => json({ access_token: token, expires_in: 3600, token_type: "Bearer" });
const accessDenied = () =>
  json(
    {
      error_description: "You have made too many requests continuously. Please try again after some time.",
      error: "Access Denied",
      status: "failure",
    },
    400,
  );

let clock: Date;
function requester(routes: Parameters<typeof fakeFetch>[0], client: ZohoClientName = "crm") {
  const http = fakeFetch(routes);
  const request = createZohoRequester(client, CLIENT, {
    db: env.DB,
    fetch: http.fetch,
    now: () => clock,
    log: createLogger(),
  });
  const tokenCalls = () => http.calls.filter((call) => call.url.startsWith(TOKEN_URL)).length;
  return { request, calls: http.calls, tokenCalls };
}

async function held(client: ZohoClientName, token: string, expiresAt = new Date(NOW.getTime() + 3600_000)) {
  await env.DB.prepare(
    `INSERT INTO zoho_access_tokens (client, access_token, expires_at) VALUES (?1, ?2, ?3)
     ON CONFLICT (client) DO UPDATE SET access_token = excluded.access_token, expires_at = excluded.expires_at`,
  )
    .bind(client, token, expiresAt.toISOString())
    .run();
}

beforeEach(() => {
  clock = NOW;
});

describe("the access token", () => {
  it("is kept per client in one table, CRM, FSM and Books each their own", async () => {
    for (const client of ["crm", "fsm", "books"] as const) {
      const { request } = requester(
        { [TOKEN_URL]: () => issued(`${client}-1`), [LEADS_URL]: () => json({ data: [] }) },
        client,
      );
      await request("search", "/crm/v8/Leads");
    }

    const rows = await env.DB.prepare("SELECT client, access_token FROM zoho_access_tokens ORDER BY client").all();
    expect(rows.results).toEqual([
      { client: "books", access_token: "books-1" },
      { client: "crm", access_token: "crm-1" },
      { client: "fsm", access_token: "fsm-1" },
    ]);
  });

  it("is not replaced for a 401 a new token would not change, such as a scope Zoho will not grant", async () => {
    await held("crm", "good");
    const { request, tokenCalls } = requester({
      [TOKEN_URL]: () => issued("another"),
      [LEADS_URL]: () => json({ code: "OAUTH_SCOPE_MISMATCH", message: "invalid oauth scope to access this URL" }, 401),
    });
    const error = await request("search", "/crm/v8/Leads").catch((caught: unknown) => caught);
    expect(String(error)).toContain("Zoho 401 OAUTH_SCOPE_MISMATCH");
    expect(tokenCalls()).toBe(0);
    // Our access, not the record: a pass tries the record again rather than leaving it for a person.
    expect(isRefusal(error)).toBe(false);
  });

  it("is replaced once, and the call repeated, when Zoho says it is invalid", async () => {
    await held("crm", "stale");
    const { request, calls, tokenCalls } = requester({
      [TOKEN_URL]: () => issued("fresh"),
      [LEADS_URL]: (call) =>
        call.headers.get("Authorization") === "Zoho-oauthtoken stale"
          ? json({ code: "INVALID_TOKEN", message: "invalid oauth token" }, 401)
          : json({ data: [] }),
    });
    expect((await request("search", "/crm/v8/Leads")).status).toBe(200);
    expect(tokenCalls()).toBe(1);
    expect(calls.at(-1)?.headers.get("Authorization")).toBe("Zoho-oauthtoken fresh");
  });

  it("is not replaced again when another caller has replaced it since", async () => {
    await held("crm", "stale");
    const { request, tokenCalls } = requester({
      [TOKEN_URL]: () => issued("mine"),
      [LEADS_URL]: async (call) => {
        if (call.headers.get("Authorization") !== "Zoho-oauthtoken stale") return json({ data: [] });
        // Meanwhile another invocation found the token invalid and replaced it.
        await held("crm", "theirs");
        return json({ code: "INVALID_TOKEN", message: "invalid oauth token" }, 401);
      },
    });
    await request("search", "/crm/v8/Leads");
    expect(tokenCalls()).toBe(0);
  });

  it("is asked for by one caller at a time; another waits for it rather than asking for its own", async () => {
    let answer: (response: Response) => void = () => undefined;
    const { request, tokenCalls } = requester({
      [TOKEN_URL]: () =>
        new Promise<Response>((resolve) => {
          answer = resolve;
        }),
      [LEADS_URL]: () => json({ data: [] }),
    });
    const first = request("search", "/crm/v8/Leads");
    const second = request("search", "/crm/v8/Leads");
    await new Promise((resolve) => setTimeout(resolve, 50));
    answer(issued("only"));

    await Promise.all([first, second]);
    expect(tokenCalls()).toBe(1);
  });
});

describe("after Zoho refuses a new token", () => {
  it("asks for none for ten minutes, failing every call at once, and then asks again", async () => {
    let refusing = true;
    const { request, tokenCalls } = requester({
      [TOKEN_URL]: () => (refusing ? accessDenied() : issued("after")),
      [LEADS_URL]: () => json({ data: [] }),
    });
    await expect(request("search", "/crm/v8/Leads")).rejects.toThrow("Access Denied");
    expect(tokenCalls()).toBe(1);

    refusing = false;
    clock = new Date(NOW.getTime() + TOKEN_COOL_DOWN_MS - 1000);
    await expect(request("search", "/crm/v8/Leads")).rejects.toThrow(/no token asked for until/);
    expect(tokenCalls()).toBe(1);

    clock = new Date(NOW.getTime() + TOKEN_COOL_DOWN_MS + 1000);
    expect((await request("search", "/crm/v8/Leads")).status).toBe(200);
    expect(tokenCalls()).toBe(2);
  });

  // A pass reads a refusal as the record's fault, not asked about again (ADR 0067): a token is nobody's record.
  it("is a failure a pass tries again, never a refusal of the record the call was about", async () => {
    const { request } = requester({ [TOKEN_URL]: accessDenied });
    const error = await request("search", "/crm/v8/Leads").catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ZohoError);
    expect(isRefusal(error)).toBe(false);
  });
});

/** FSM and Books on Zoho, each on a client of its own, as the Worker builds its providers. */
const connected = {
  ...LOCAL_CONFIG,
  providers: { ...LOCAL_CONFIG.providers, FSM_PROVIDER: "zoho" as const, BOOKS_PROVIDER: "zoho" as const },
  settings: {
    ...LOCAL_SETTINGS,
    zohoFsm: { ...CLIENT, clientId: "1000.FSMCLIENT", refreshToken: "1000.fsm-refresh", webhookToken: null },
    zohoBooks: {
      ...CLIENT,
      clientId: "1000.BOOKSCLIENT",
      refreshToken: "1000.books-refresh",
      orgId: "60088931635",
      refundAccountId: null,
      gst: NO_GST,
    },
  },
};

describe("how long a call may take, as the Worker builds its providers", () => {
  beforeEach(() => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(
      new DOMException("The operation was aborted due to timeout", "TimeoutError"),
    );
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("gives FSM and Books 8 s inside a request someone waits on, and 20 s in a queue or the cron", async () => {
    const make = productionDependencies(connected);
    await expect(make(env, createLogger(), "request").fsm.contact("c-1")).rejects.toThrow("within 8 s");
    await expect(make(env, createLogger()).fsm.contact("c-1")).rejects.toThrow("within 20 s");
    await expect(make(env, createLogger(), "request").books.invoice("inv-1")).rejects.toThrow("within 8 s");
    await expect(make(env, createLogger()).books.invoice("inv-1")).rejects.toThrow("within 20 s");
  });
});

describe("Books' own client, as the Worker builds its providers", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("mints Books' token from Books' client, never FSM's, and keeps it as Books'", async () => {
    const minted: { clientId: string | null; refreshToken: string | null }[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      if (url.href.startsWith(TOKEN_URL)) {
        minted.push({
          clientId: url.searchParams.get("client_id"),
          refreshToken: url.searchParams.get("refresh_token"),
        });
        return Promise.resolve(issued("books-1"));
      }
      const invoice = {
        invoice_id: "inv-1",
        invoice_number: "INV-000041",
        date: "2026-09-24",
        total: 1,
        status: "sent",
      };
      return Promise.resolve(json({ invoice }));
    });

    const books = productionDependencies(connected)(env, createLogger()).books;
    expect((await books.invoice("inv-1"))?.number).toBe("INV-000041");

    expect(minted).toEqual([{ clientId: "1000.BOOKSCLIENT", refreshToken: "1000.books-refresh" }]);
    const kept = await env.DB.prepare("SELECT client FROM zoho_access_tokens WHERE access_token = 'books-1'").all();
    expect(kept.results).toEqual([{ client: "books" }]);
  });
});

describe("how long a call may take", () => {
  it("is 20 s where nobody waits on it, and what the caller says where a person does", async () => {
    const timingOut = () => {
      throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
    };
    const background = requester({ [TOKEN_URL]: timingOut });
    await expect(background.request("search", "/crm/v8/Leads")).rejects.toThrow("token got no answer within 20 s");

    const http = fakeFetch({ [TOKEN_URL]: timingOut });
    const waited = createZohoRequester("crm", CLIENT, {
      db: env.DB,
      fetch: http.fetch,
      now: () => clock,
      log: createLogger(),
      timeoutMs: 8_000,
    });
    await expect(waited("search", "/crm/v8/Leads")).rejects.toThrow("token got no answer within 8 s");
  });
});
