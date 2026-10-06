// The one Zoho client the scripts use (scripts/lib/zoho-script-client.ts), against a stand-in for Zoho: what it sends,
// and how it reads what Zoho answers. Every ID, host and secret is made up.

import { describe, expect, it } from "vitest";
import { z } from "zod";
import { zohoScriptClient } from "../../../scripts/lib/zoho-script-client.ts";

const CRM_ENV = {
  ZOHO_API_HOST: "www.zohoapis.test",
  ZOHO_ACCOUNTS_HOST: "accounts.zoho.test",
  ZOHO_CLIENT_ID: "crm-id",
  ZOHO_CLIENT_SECRET: "crm-secret",
  ZOHO_SCRIPTS_REFRESH_TOKEN: "crm-scripts",
};
const BOOKS_ENV = {
  ZOHO_BOOKS_API_HOST: "www.zohoapis.test",
  ZOHO_BOOKS_ACCOUNTS_HOST: "accounts.zoho.test",
  ZOHO_BOOKS_CLIENT_ID: "books-id",
  ZOHO_BOOKS_CLIENT_SECRET: "books-secret",
  ZOHO_BOOKS_SCRIPTS_REFRESH_TOKEN: "books-scripts",
  ZOHO_BOOKS_ORG_ID: "60001",
};

/** Zoho, answering the token refresh and then each call with what `answer` gives; every request it had. */
function standIn(answer: (url: URL) => Response = () => Response.json({ ok: true })) {
  const asked: { url: URL; init: RequestInit | undefined }[] = [];
  const fetch = (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : input);
    asked.push({ url, init });
    if (url.pathname === "/oauth/v2/token") return Promise.resolve(Response.json({ access_token: "minted" }));
    return Promise.resolve(answer(url));
  };
  return { asked, fetch: fetch };
}

describe("a script's Zoho client", () => {
  it("mints one access token from the scripts' own refresh token, and sends it with every call", async () => {
    const zoho = standIn();
    const crm = await zohoScriptClient("crm", { env: CRM_ENV, argv: [], fetch: zoho.fetch });
    await crm.call("GET", "/crm/v8/Leads");
    await crm.call("GET", "/crm/v8/Contacts");

    const [token, ...calls] = zoho.asked;
    expect(token?.url.host).toBe("accounts.zoho.test");
    expect(Object.fromEntries(token?.url.searchParams ?? [])).toEqual({
      refresh_token: "crm-scripts",
      client_id: "crm-id",
      client_secret: "crm-secret",
      grant_type: "refresh_token",
    });
    expect(calls.map((call) => call.url.href)).toEqual([
      "https://www.zohoapis.test/crm/v8/Leads",
      "https://www.zohoapis.test/crm/v8/Contacts",
    ]);
    for (const call of calls) expect(call.init?.headers).toMatchObject({ Authorization: "Zoho-oauthtoken minted" });
  });

  it("calls Books below /books/v3, in the business's organisation", async () => {
    const zoho = standIn();
    const books = await zohoScriptClient("books", { env: BOOKS_ENV, argv: [], fetch: zoho.fetch });
    await books.call("GET", "/contacts");
    await books.call("GET", "/contacts?page=2");
    expect(zoho.asked.slice(1).map((call) => call.url.href)).toEqual([
      "https://www.zohoapis.test/books/v3/contacts?organization_id=60001",
      "https://www.zohoapis.test/books/v3/contacts?page=2&organization_id=60001",
    ]);
  });

  it("sends a body as JSON, and reads an empty answer as none", async () => {
    const zoho = standIn(() => new Response(null, { status: 204 }));
    const crm = await zohoScriptClient("crm", { env: CRM_ENV, argv: [], fetch: zoho.fetch });
    expect(await crm.call("POST", "/crm/v8/settings/fields", { fields: [] })).toEqual({ status: 204, json: null });
    expect(zoho.asked[1]?.init).toMatchObject({
      method: "POST",
      body: JSON.stringify({ fields: [] }),
      headers: { "Content-Type": "application/json" },
    });
  });

  it("reads an answer through its schema, and refuses one of another shape, naming the path", async () => {
    const zoho = standIn((url) =>
      Response.json(url.pathname.endsWith("/good") ? { fields: [{ api_name: "Lead_Status" }] } : { fields: "none" }),
    );
    const crm = await zohoScriptClient("crm", { env: CRM_ENV, argv: [], fetch: zoho.fetch });
    const FIELDS = z.object({ fields: z.array(z.object({ api_name: z.string() })) });
    expect(await crm.get("/crm/v8/good", FIELDS)).toEqual({ fields: [{ api_name: "Lead_Status" }] });
    await expect(crm.get("/crm/v8/bad", FIELDS)).rejects.toThrow("/crm/v8/bad answered 200 in a shape");
  });
});
