import { beforeEach, describe, expect, it } from "vitest";
import { createLogger } from "../../src/log.ts";
import { createAlert } from "../../src/providers/alerts.ts";
import { createStubCrm } from "../../src/providers/crm/stub.ts";
import { verifyTurnstile } from "../../src/providers/turnstile.ts";
import { crmLead } from "./crm-rules.test.ts";
import { TURNSTILE_URL, captureLogs, fakeFetch, json } from "./helpers.ts";

beforeEach(() => {
  captureLogs();
});

describe("verifyTurnstile", () => {
  const check = (fetchImpl: typeof fetch) =>
    verifyTurnstile({ secret: "s", token: "t", ip: null, hosts: null, fetch: fetchImpl, log: createLogger() });

  it("passes only when Cloudflare says success", async () => {
    expect(await check(fakeFetch({ [TURNSTILE_URL]: () => json({ success: true }) }).fetch)).toEqual({
      result: "passed",
    });
    expect(await check(fakeFetch({ [TURNSTILE_URL]: () => json({ success: false }) }).fetch)).toEqual({
      result: "rejected",
    });
    expect(await check(fakeFetch({ [TURNSTILE_URL]: () => new Response("not json") }).fetch)).toEqual({
      result: "rejected",
    });
  });

  it("refuses a token solved on a page not ours, though Cloudflare passed it", async () => {
    const answer = (hostname?: string) => fakeFetch({ [TURNSTILE_URL]: () => json({ success: true, hostname }) }).fetch;
    const ours = (fetchImpl: typeof fetch) =>
      verifyTurnstile({
        secret: "s",
        token: "t",
        ip: null,
        hosts: ["maneman.in"],
        fetch: fetchImpl,
        log: createLogger(),
      });

    expect(await ours(answer("maneman.in"))).toEqual({ result: "passed" });
    expect(await ours(answer("maneman.in.example.com"))).toEqual({ result: "rejected" });
    expect(await ours(answer())).toEqual({ result: "rejected" });
  });

  it("reports unavailable, and why, when Cloudflare cannot be reached or answers an error", async () => {
    const unreachable = (() => Promise.reject(new TypeError("network down"))) as typeof fetch;
    expect(await check(unreachable)).toEqual({ result: "unavailable", detail: "unreachable: TypeError" });
    expect(await check(fakeFetch({ [TURNSTILE_URL]: () => new Response("", { status: 502 }) }).fetch)).toEqual({
      result: "unavailable",
      detail: "siteverify 502",
    });
  });

  it.each(["internal-error", "invalid-input-secret", "missing-input-secret"])(
    "reports unavailable, not a rejected visitor, when Cloudflare says %s: no token could pass",
    async (code) => {
      const answer = json({ success: false, "error-codes": [code] });
      expect(await check(fakeFetch({ [TURNSTILE_URL]: () => answer }).fetch)).toEqual({
        result: "unavailable",
        detail: `siteverify said ${code}`,
      });
    },
  );
});

describe("createAlert", () => {
  const log = createLogger();

  it("posts {text} to Slack or Google Chat, and {content} to Discord", async () => {
    const chat = fakeFetch({ "https://chat.example/": () => new Response("ok") });
    await createAlert({ webhookUrl: "https://chat.example/hook", environment: "staging", fetch: chat.fetch, log })("x");
    expect(JSON.parse(chat.calls[0]?.body ?? "")).toEqual({ text: "[mm-api staging] x" });

    const discord = fakeFetch({ "https://discord.com/": () => new Response(null, { status: 204 }) });
    await createAlert({
      webhookUrl: "https://discord.com/api/webhooks/1",
      environment: "production",
      fetch: discord.fetch,
      log,
    })("y");
    expect(JSON.parse(discord.calls[0]?.body ?? "")).toEqual({ content: "[mm-api production] y" });
  });

  it("scrubs phone numbers and e-mail addresses from the message", async () => {
    const chat = fakeFetch({ "https://chat.example/": () => new Response("ok") });
    await createAlert({ webhookUrl: "https://chat.example/hook", environment: "staging", fetch: chat.fetch, log })(
      "failed for 9810000001 and a@b.in",
    );
    expect(chat.calls[0]?.body).not.toMatch(/9810000001|a@b\.in/);
  });

  it("never throws, even when the webhook is down or missing", async () => {
    const down = (() => Promise.reject(new Error("down"))) as typeof fetch;
    const failing = fakeFetch({ "https://chat.example/": () => new Response("no", { status: 500 }) });
    await expect(
      createAlert({ webhookUrl: "https://chat.example/hook", environment: "staging", fetch: down, log })("x"),
    ).resolves.toBeUndefined();
    await expect(
      createAlert({ webhookUrl: "https://chat.example/hook", environment: "staging", fetch: failing.fetch, log })("x"),
    ).resolves.toBeUndefined();
    await expect(
      createAlert({ webhookUrl: null, environment: "local", fetch: down, log })("x"),
    ).resolves.toBeUndefined();
  });
});

describe("the stub CRM", () => {
  it("returns a fake ID and applies the same consent rules as Zoho", async () => {
    const crm = createStubCrm(createLogger());
    expect(await crm.syncLead(crmLead(), null)).toEqual({ crmLeadId: "stub-person-1", created: true });
    expect(await crm.syncLead(crmLead(), "stub-person-1")).toEqual({ crmLeadId: "stub-person-1", created: false });
  });
});
