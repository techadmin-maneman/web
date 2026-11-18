// What an alert posts to each kind of webhook (src/providers/alerts.ts): an ntfy topic gets the text itself at urgent
// priority, a phone push for the urgent space; Google Chat and Slack get JSON text. Every URL here is made up.

import { describe, expect, it } from "vitest";
import { createLogger } from "../../../src/log.ts";
import { createAlert } from "../../../src/providers/alerts.ts";

function posted(webhookUrl: string) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetch: typeof globalThis.fetch = (url, init) => {
    calls.push({ url: url instanceof Request ? url.url : url.toString(), init: init ?? {} });
    return Promise.resolve(new Response("ok"));
  };
  const alert = createAlert({ webhookUrl, environment: "staging", fetch, log: createLogger() });
  return { alert, calls };
}

const textOf = (init: RequestInit | undefined): string => (typeof init?.body === "string" ? init.body : "");

describe("an alert's post", () => {
  it("is the text itself, at urgent priority, for an ntfy topic", async () => {
    const { alert, calls } = posted("https://ntfy.sh/mm-urgent-test");
    await alert("WhatsApp bridge closed");
    expect(textOf(calls[0]?.init)).toBe("[mm-api staging] WhatsApp bridge closed");
    expect(calls[0]?.init.headers).toMatchObject({ Title: "Mane Man staging", Priority: "urgent" });
  });

  it("is JSON text for Google Chat", async () => {
    const { alert, calls } = posted("https://chat.googleapis.com/v1/spaces/x/messages?key=k");
    await alert("Stock is low");
    expect(JSON.parse(textOf(calls[0]?.init))).toEqual({ text: "[mm-api staging] Stock is low" });
  });
});

// A burst of alerts hit the chat's limit, and each then waited for a post of its own (docs/decisions/0277).
describe("a chat that refuses a post as too many", () => {
  it("is left alone for as long as its Retry-After asks, the rest left to the retell pass", async () => {
    const calls: string[] = [];
    let answer = new Response("slow down", { status: 429, headers: { "Retry-After": "30" } });
    const fetch: typeof globalThis.fetch = () => {
      calls.push("post");
      return Promise.resolve(answer);
    };
    const webhookUrl = "https://chat.googleapis.com/v1/spaces/busy/messages?key=k";
    const alert = createAlert({ webhookUrl, environment: "staging", fetch, log: createLogger() });
    expect(await alert("First")).toBe(false);
    expect(await alert("Second")).toBe(false);
    expect(calls).toEqual(["post"]);

    answer = new Response("ok");
    const later = Date.now() + 31_000;
    const realNow = Date.now;
    Date.now = () => later;
    try {
      expect(await alert("Third")).toBe(true);
    } finally {
      Date.now = realNow;
    }
    expect(calls).toEqual(["post", "post"]);
  });
});
