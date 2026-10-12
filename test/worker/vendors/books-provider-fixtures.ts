// What the Books provider tests share (books-provider*.test.ts): the settings, Zoho's token and Books' API faked, the
// calls they record, and a client with an address and a Books customer.

import { env } from "cloudflare:workers";
import { NO_GST } from "../../../src/config/gst.ts";
import type { ZohoBooksSettings } from "../../../src/config/settings.ts";
import { createLogger } from "../../../src/log.ts";
import { createBooksProvider, type NewBooksCustomer } from "../../../src/providers/books/index.ts";
import { NOW, fakeFetch, json, type RecordedCall } from "../helpers.ts";
import contactAdded from "../../fixtures/vendors/books/contact-added.json";

export const SETTINGS: ZohoBooksSettings = {
  clientId: "1000.BOOKSCLIENT",
  clientSecret: "books-client-secret",
  refreshToken: "1000.books-refresh",
  accountsHost: "accounts.zoho.in",
  apiHost: "www.zohoapis.in",
  orgId: "60088931635",
  refundAccountId: null,
  gst: NO_GST,
};

export const ZOHO_TOKEN_URL = "https://accounts.zoho.in/oauth/v2/token";

export const BOOKS_API = "https://www.zohoapis.in/books/v3";

export const tokenIssued = () => json({ access_token: "books-access-1", expires_in: 3600, token_type: "Bearer" });

export function zohoBooks(routes: Parameters<typeof fakeFetch>[0]) {
  const http = fakeFetch(routes);
  const deps = { db: env.DB, fetch: http.fetch, now: () => NOW, log: createLogger() };
  return { books: createBooksProvider("zoho", SETTINGS, deps), calls: http.calls };
}

/** What a call sent, as JSON; null for a call that sent nothing. */
export const sent = (call: RecordedCall | undefined): unknown => (call?.body ? JSON.parse(call.body) : null);

/** The calls after the first, which mints the access token. */
export const booksCalls = (calls: readonly RecordedCall[]) => calls.slice(1);

export const PERSON_ID = contactAdded.contact.custom_fields[0]?.value ?? "";

export const ADDRESS = {
  street1: "Flat 1, Staging test",
  street2: "Near the park",
  city: "Gurgaon",
  state: "Haryana",
  pincode: "122002",
};

export const CUSTOMER: NewBooksCustomer = {
  personId: PERSON_ID,
  name: "Staging test",
  mobile: "+919000000001",
  email: null,
  stateCode: null,
  address: ADDRESS,
};
