// Every adapter's calls go through vendorFetch, so each leaves one `vendor_call` line naming its vendor and step
// (PLAT-44). During the 69-hour WhatsApp outage and the Google key's refusal the logs held no such line for those
// vendors, and the cause had to be found from outside. Google's own calls are pinned in test/node/google-places.test.ts.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { NO_GST } from "../../src/config/gst.ts";
import { PRESETS } from "../../src/config/presets.ts";
import type { ZohoBooksSettings } from "../../src/config/settings.ts";
import { createLogger } from "../../src/log.ts";
import {
  API_BASE_URL,
  CREDITS_PATH,
  ENDPOINT_PATHS,
  POLL_PATH,
  createAilabtoolsProvider,
} from "../../src/providers/ailabtools.ts";
import { createAlert, createLeadNotice } from "../../src/providers/alerts.ts";
import { createBooksProvider } from "../../src/providers/books.ts";
import { createAccessVerifier, ACCESS_TOKEN_HEADER } from "../../src/providers/cloudflare-access.ts";
import { readDailyUsage } from "../../src/providers/cloudflare-usage.ts";
import { createEvolutionMessaging } from "../../src/providers/evolution.ts";
import { pingHeartbeat } from "../../src/providers/heartbeat.ts";
import { createPaymentsProvider } from "../../src/providers/payments.ts";
import { verifyTurnstile } from "../../src/providers/turnstile.ts";
import { createZohoRequester } from "../../src/providers/zoho-http.ts";
import { captureLogs, fakeFetch, json, NOW, TURNSTILE_URL } from "./helpers.ts";
import { syntheticJpeg } from "./tryon-fixtures.ts";

const log = createLogger();

let logs: ReturnType<typeof captureLogs>;
beforeEach(() => {
  logs = captureLogs();
});

/** Each vendor_call line, as vendor, step and status. */
const vendorCalls = () =>
  logs
    .lines()
    .filter((line) => line.event === "vendor_call")
    .map(({ vendor, step, status }) => ({ vendor, step, status }));

const timedOut: typeof fetch = () =>
  Promise.reject(new DOMException("The operation was aborted due to timeout", "TimeoutError"));

describe("the WhatsApp bridge", () => {
  const settings = { baseUrl: "https://bridge.example", apiKey: "evo-key", instance: "mane man", webhookToken: null };
  const SEND_TEXT = "https://bridge.example/message/sendText/mane%20man";
  const STATE = "https://bridge.example/instance/connectionState/mane%20man";

  it("logs a send and a look at its connection, and the bridge's code on a refusal", async () => {
    let refusing = false;
    const http = fakeFetch({
      [SEND_TEXT]: () =>
        refusing ? json({ error: { code: "INTERNAL_SERVER_ERROR" } }, 500) : json({ key: { id: "T1" } }),
      [STATE]: () => json({ instance: { state: "open" } }),
    });
    const evolution = createEvolutionMessaging(settings, { fetch: http.fetch, log });

    await evolution.send({ to: "+919810000001", template: "login_code_v1", params: ["123456"] });
    await evolution.connection();
    refusing = true;
    await evolution.send({ to: "+919810000001", template: "login_code_v1", params: ["123456"] });

    expect(vendorCalls()).toEqual([
      { vendor: "evolution", step: "sendText", status: 200 },
      { vendor: "evolution", step: "connection_state", status: 200 },
      { vendor: "evolution", step: "sendText", status: 500 },
    ]);
    expect(logs.lines().at(-1)).toMatchObject({ code: "INTERNAL_SERVER_ERROR" });
    expect(JSON.stringify(logs.lines())).not.toMatch(/9810000001|evo-key/);
  });
});

describe("AILabTools", () => {
  const KEY = "live-key-that-must-never-leak";
  const RESULT_URL = "https://ailab-outputs.oss-accelerate.aliyuncs.com/abc.png";
  const preset = PRESETS[0];

  function ailab(routes: Parameters<typeof fakeFetch>[0]) {
    return createAilabtoolsProvider({ apiKey: KEY, fetch: fakeFetch(routes).fetch, log });
  }

  it("logs a submit, a poll, a download and a look at the credits, and never the key", async () => {
    const image = ailab({
      [`${API_BASE_URL}${ENDPOINT_PATHS.pro}`]: () => json({ error_code: 422, error_msg: "No face detected" }, 422),
      [`${API_BASE_URL}${POLL_PATH}`]: () => json({ error_code: 0, task_status: 1 }),
      [RESULT_URL]: () => new Response("not an image"),
      [`${API_BASE_URL}${CREDITS_PATH}`]: () => json({ data: [{ balance: 10 }] }),
    });

    await image.submit(syntheticJpeg(800, 800), preset, "black", "pro");
    await image.poll("task-1", "pro");
    await image.download(RESULT_URL);
    await image.credits();

    expect(vendorCalls()).toEqual([
      { vendor: "ailabtools", step: "submit", status: 422 },
      { vendor: "ailabtools", step: "poll", status: 200 },
      { vendor: "ailabtools", step: "download", status: 200 },
      { vendor: "ailabtools", step: "credits", status: 200 },
    ]);
    expect(logs.lines().find((line) => line.step === "submit")).toMatchObject({ code: "422" });
    expect(JSON.stringify(logs.lines())).not.toContain(KEY);
  });

  it("tries a result again whose body stopped arriving, and answers no credits where none could be asked", async () => {
    const brokenBody = () =>
      new Response(
        new ReadableStream({
          start(controller) {
            controller.error(new TypeError("stream broke"));
          },
        }),
      );
    const image = createAilabtoolsProvider({ apiKey: KEY, fetch: timedOut, log });

    expect(await ailab({ [RESULT_URL]: brokenBody }).download(RESULT_URL)).toEqual({
      ok: false,
      detail: "download failed after 3 tries: TypeError",
      transient: true,
    });
    expect(await image.credits()).toBeNull();
    expect(await image.poll("task-1", "pro")).toMatchObject({
      state: "failed",
      failure: { transient: true, detail: "AILabTools 0 TIMEOUT: poll got no answer within 15 s" },
    });
  });
});

describe("Turnstile", () => {
  it("logs the check of a visitor's token, and never the token or the secret", async () => {
    const http = fakeFetch({ [TURNSTILE_URL]: () => json({ success: true }) });
    await verifyTurnstile({ secret: "turnstile-secret", token: "visitor-token", ip: null, fetch: http.fetch, log });
    expect(vendorCalls()).toEqual([{ vendor: "turnstile", step: "siteverify", status: 200 }]);
    expect(JSON.stringify(logs.lines())).not.toMatch(/turnstile-secret|visitor-token/);
  });
});

describe("Cloudflare Access", () => {
  const TEAM = "summer-math-0275.cloudflareaccess.com";
  const SETTINGS = { teamDomain: TEAM, opsAudience: "ops-audience-tag" };
  const encode = (value: unknown) =>
    btoa(JSON.stringify(value)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const withToken = new Request("https://ops.maneman.test/api/health", {
    headers: { [ACCESS_TOKEN_HEADER]: `${encode({ alg: "RS256", kid: "key-1" })}.${encode({})}.c2ln` },
  });

  it("logs the fetch of the team's signing keys", async () => {
    const http = fakeFetch({ [`https://${TEAM}/cdn-cgi/access/certs`]: () => json({ keys: [] }) });
    const verifier = createAccessVerifier(SETTINGS, { fetch: http.fetch, now: () => NOW, log });

    expect(await verifier.verify(withToken)).toEqual({ ok: false, reason: "unknown_key" });
    expect(vendorCalls()).toEqual([{ vendor: "cloudflare-access", step: "signing_keys", status: 200 }]);
  });

  it("says the keys got no answer, naming the step and the limit", async () => {
    const verifier = createAccessVerifier(SETTINGS, { fetch: timedOut, now: () => NOW, log });
    const result = await verifier.verify(withToken);
    expect(result).toMatchObject({ ok: false, reason: "keys_unavailable" });
    expect("error" in result ? String(result.error) : "").toContain(
      "Cloudflare Access 0 TIMEOUT: signing_keys got no answer within 5 s",
    );
  });
});

describe("the chat webhook and the heartbeat", () => {
  const HOOK = "https://chat.example/hook/secret-path";
  const CHECK = "https://hc-ping.com/0b9f1a52-7c0b-4f5b-9a0e-2f4f6f2b1a01";

  it("logs each alert, lead notice and heartbeat, and never the webhook's address", async () => {
    const http = fakeFetch({ [HOOK]: () => new Response("ok"), [CHECK]: () => new Response("OK") });
    await createAlert({ webhookUrl: HOOK, environment: "staging", fetch: http.fetch, log })("x");
    await createLeadNotice({ webhookUrl: HOOK, environment: "staging", fetch: http.fetch, log })("y");
    await pingHeartbeat({ url: CHECK, fetch: http.fetch, log }, []);

    expect(vendorCalls()).toEqual([
      { vendor: "chat-webhook", step: "alert", status: 200 },
      { vendor: "chat-webhook", step: "lead_notice", status: 200 },
      { vendor: "healthchecks", step: "heartbeat", status: 200 },
    ]);
    expect(JSON.stringify(logs.lines())).not.toContain("secret-path");
  });

  it("logs an alert the webhook never answered as not delivered, naming why", async () => {
    await createAlert({ webhookUrl: HOOK, environment: "staging", fetch: timedOut, log })("x");
    expect(logs.lines()).toContainEqual(
      expect.objectContaining({
        event: "alert_not_delivered",
        error: expect.objectContaining({
          message: "Chat webhook 0 TIMEOUT: alert got no answer within 5 s",
        }) as unknown,
      }),
    );
  });
});

describe("Cloudflare's usage figures", () => {
  const GRAPHQL = "https://api.cloudflare.com/client/v4/graphql";
  const query = (fetch: typeof globalThis.fetch) =>
    readDailyUsage({ token: "analytics-read-token", accountId: "account", date: "2026-10-02", fetch, log });

  it("logs the read, and never the token", async () => {
    await query(fakeFetch({ [GRAPHQL]: () => json({ data: { viewer: { accounts: [] } } }) }).fetch);
    expect(vendorCalls()).toEqual([{ vendor: "cloudflare-analytics", step: "daily_usage", status: 200 }]);
    expect(JSON.stringify(logs.lines())).not.toContain("analytics-read-token");
  });

  it("says where an answer differs from what is read, an answer that is not JSON, and one that never came", async () => {
    expect(await query(fakeFetch({ [GRAPHQL]: () => json({ data: { viewer: {} } }) }).fetch)).toEqual({
      unreadable:
        "Cloudflare analytics 200 UNEXPECTED_ANSWER: daily_usage: data.viewer.accounts: Invalid input: expected " +
        "array, received undefined; data.viewer has no keys",
    });
    expect(await query(fakeFetch({ [GRAPHQL]: () => new Response("<html>") }).fetch)).toEqual({
      unreadable: "Cloudflare analytics 200 UNEXPECTED_ANSWER: daily_usage: the answer is not JSON",
    });
    expect(await query(timedOut)).toEqual({
      unreadable: "analytics did not answer: Cloudflare analytics 0 TIMEOUT: daily_usage got no answer within 10 s",
    });
  });
});

describe("Zoho", () => {
  const CLIENT = {
    clientId: "1000.CLIENT",
    clientSecret: "client-secret",
    refreshToken: "1000.refresh",
    accountsHost: "accounts.zoho.in",
    apiHost: "www.zohoapis.in",
  };

  it("names the client whose call it logs, so Books' token is told from the CRM's", async () => {
    const http = fakeFetch({
      "https://accounts.zoho.in/oauth/v2/token": () => json({ access_token: "books-token", expires_in: 3600 }),
      "https://www.zohoapis.in/books/v3/items": () => json({ code: 57, message: "not authorised" }, 403),
    });
    const request = createZohoRequester("books", CLIENT, { db: env.DB, fetch: http.fetch, now: () => NOW, log });

    await expect(request("items", "/books/v3/items")).rejects.toThrow("Zoho 403 57: not authorised");

    expect(vendorCalls()).toEqual([
      { vendor: "zoho-books", step: "token", status: 200 },
      { vendor: "zoho-books", step: "items", status: 403 },
    ]);
    expect(logs.lines().at(-1)).toMatchObject({ code: "57" });
    expect(JSON.stringify(logs.lines())).not.toMatch(/client-secret|1000\.refresh|books-token/);
  });
});

describe("Razorpay", () => {
  const API = "https://api.razorpay.com/v1";
  const SETTINGS = { keyId: "rzp_test_abc", keySecret: "key-secret", webhookSecret: null };
  const ORDER = { amount: 200000, receipt: "hold-1", notes: { hold_id: "hold-1" } };
  const razorpay = (fetch: typeof globalThis.fetch) => createPaymentsProvider("razorpay", SETTINGS, { fetch, log });

  it("logs an order, and a refusal with Razorpay's code, and never the keys", async () => {
    let refusing = false;
    const payments = razorpay(
      fakeFetch({
        [`${API}/orders`]: () =>
          refusing
            ? json({ error: { code: "BAD_REQUEST_ERROR", description: "The amount must be at least INR 1.00" } }, 400)
            : json({ id: "order_9" }),
      }).fetch,
    );

    await payments.createOrder(ORDER);
    refusing = true;
    await expect(payments.createOrder(ORDER)).rejects.toThrow("Razorpay 400 BAD_REQUEST_ERROR");

    expect(vendorCalls()).toEqual([
      { vendor: "razorpay", step: "create_order", status: 200 },
      { vendor: "razorpay", step: "create_order", status: 400 },
    ]);
    expect(logs.lines().at(-1)).toMatchObject({ code: "BAD_REQUEST_ERROR" });
    expect(JSON.stringify(logs.lines())).not.toMatch(/key-secret|rzp_test_abc/);
  });

  // CQ-03: Razorpay's answers were read with a bare parse, whose ZodError named neither the step nor the answer.
  it("names where an order it cannot read differs, and the step that got no answer", async () => {
    const unreadable = razorpay(fakeFetch({ [`${API}/orders`]: () => json({ entity: "order" }) }).fetch);
    await expect(unreadable.createOrder(ORDER)).rejects.toThrow(
      "Razorpay 200 UNEXPECTED_ANSWER: create_order: id: Invalid input: expected string, received undefined; " +
        "the answer has keys entity",
    );
    await expect(razorpay(timedOut).createOrder(ORDER)).rejects.toThrow(
      "Razorpay 0 TIMEOUT: create_order got no answer within 10 s",
    );
  });
});

describe("Zoho Books", () => {
  const SETTINGS: ZohoBooksSettings = {
    clientId: "1000.BOOKSCLIENT",
    clientSecret: "books-client-secret",
    refreshToken: "1000.books-refresh",
    accountsHost: "accounts.zoho.in",
    apiHost: "www.zohoapis.in",
    orgId: "60088931635",
    refundAccountId: null,
    gst: NO_GST,
  };
  const BOOKS_API = "https://www.zohoapis.in/books/v3";
  const PAYMENT = {
    customerId: "customer-1",
    amount: 200000,
    date: "2026-10-02",
    reference: "MM-2026-0841",
    description: "Advance for a visit",
  };

  function zohoBooks(routes: Parameters<typeof fakeFetch>[0]) {
    const http = fakeFetch({
      "https://accounts.zoho.in/oauth/v2/token": () => json({ access_token: "books-access-1", expires_in: 3600 }),
      ...routes,
    });
    return createBooksProvider("zoho", SETTINGS, { db: env.DB, fetch: http.fetch, now: () => NOW, log });
  }

  // CQ-03: Books' payments, refunds and invoices were read with a bare parse.
  it("names where a recorded payment's or refund's answer differs from what is read, and none of its values", async () => {
    const books = zohoBooks({
      [`${BOOKS_API}/customerpayments/payment-1/refunds`]: () =>
        json({ code: 0, payment_refund: { amount: 2000, reference_number: "rfnd_9" } }, 201),
      [`${BOOKS_API}/customerpayments`]: () =>
        json({ code: 0, message: "The payment has been recorded.", payment: { amount: 2000 } }, 201),
    });

    await expect(books.recordPayment(PAYMENT)).rejects.toThrow(
      "Zoho 201 UNEXPECTED_ANSWER: record_payment: payment.payment_id: Invalid input: expected string, received " +
        "undefined; payment has keys amount",
    );
    const refund = {
      amount: 200000,
      date: "2026-10-02",
      reference: "rfnd_9",
      description: "Cancelled",
      fromAccountId: "a-1",
    };
    await expect(books.recordRefund("payment-1", refund)).rejects.toThrow(
      "Zoho 201 UNEXPECTED_ANSWER: record_refund: payment_refund.payment_refund_id: Invalid input: expected " +
        "string, received undefined; payment_refund has keys amount, reference_number",
    );
  });

  it("names where an invoice's answer differs, and still answers none for an invoice Books does not have", async () => {
    const books = zohoBooks({
      [`${BOOKS_API}/invoices/invoice-1`]: () => json({ code: 0, invoice: { invoice_id: "invoice-1" } }),
      [`${BOOKS_API}/invoices/invoice-2`]: () => json({ code: 1002, message: "Invoice does not exist." }, 404),
    });

    await expect(books.invoice("invoice-1")).rejects.toThrow(
      "Zoho 200 UNEXPECTED_ANSWER: invoice: invoice.invoice_number: Invalid input: expected string, received " +
        "undefined; invoice has keys invoice_id",
    );
    expect(await books.invoice("invoice-2")).toBeNull();
  });
});
