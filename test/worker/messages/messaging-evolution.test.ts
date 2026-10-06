import { beforeEach, describe, expect, it } from "vitest";
import { createEvolutionMessaging, SEND_TIMEOUT_MS } from "../../../src/providers/messaging/evolution.ts";
import type { MessagingProvider } from "../../../src/providers/messaging/index.ts";
import { captureLogs, fakeFetch, json, markDatabase } from "../helpers.ts";
import { log } from "./messaging-fixtures.ts";

beforeEach(async () => {
  await markDatabase();
  captureLogs();
});

describe("Evolution API", () => {
  const settings = { baseUrl: "https://bridge.example", apiKey: "evo-key", instance: "mane man", webhookToken: null };
  const SEND_MEDIA = "https://bridge.example/message/sendMedia/mane%20man";
  const SEND_TEXT = "https://bridge.example/message/sendText/mane%20man";

  it("sends an image with the template's text as its caption, to the digits of the number", async () => {
    const http = fakeFetch({ [SEND_MEDIA]: () => json({ key: { id: "3EB0ABC" }, status: "PENDING" }, 201) });
    const evolution = createEvolutionMessaging(settings, { fetch: http.fetch, log });

    const result = await evolution.send({
      to: "+919810000001",
      template: "tryon_result_v1",
      params: ["Arjun", "https://maneman.in/book"],
      media: { url: "https://x.test/r.png", type: "image/png" },
    });

    expect(result).toEqual({ ok: true, providerMessageId: "3EB0ABC" });
    expect(http.calls[0]?.headers.get("apikey")).toBe("evo-key");
    expect(JSON.parse(http.calls[0]?.body ?? "{}")).toEqual({
      number: "919810000001",
      mediatype: "image",
      mimetype: "image/png",
      caption: expect.stringMatching(/^Hi Arjun, here's your new look from Mane Man\./) as string,
      media: "https://x.test/r.png",
      fileName: "mane-man.png",
    });
  });

  // A render the provider returned as a JPEG was declared a PNG, which WhatsApp then refused or showed broken.
  it("declares the image as the type it was stored as", async () => {
    const http = fakeFetch({ [SEND_MEDIA]: () => json({ key: { id: "3EB0ABC" } }) });
    const evolution = createEvolutionMessaging(settings, { fetch: http.fetch, log });
    await evolution.send({
      to: "+919810000001",
      template: "tryon_result_v1",
      params: ["Arjun", "https://maneman.in/book"],
      media: { url: "https://x.test/r.jpg", type: "image/jpeg" },
    });
    expect(JSON.parse(http.calls[0]?.body ?? "{}")).toMatchObject({ mimetype: "image/jpeg", fileName: "mane-man.jpg" });
  });

  it("sends plain text when there is no image, and refuses an unknown template without calling out", async () => {
    const http = fakeFetch({ [SEND_TEXT]: () => json({ key: { id: "T1" } }) });
    const evolution = createEvolutionMessaging(settings, { fetch: http.fetch, log });
    expect(
      await evolution.send({
        to: "+919810000001",
        template: "tryon_result_v1",
        params: ["Arjun", "https://maneman.in/book"],
      }),
    ).toMatchObject({ ok: true });
    expect(await evolution.send({ to: "+919810000001", template: "tryon_result_v1", params: ["Arjun"] })).toMatchObject(
      {
        ok: false,
        transient: false,
      },
    );
    expect(http.calls).toHaveLength(1);
  });

  it("ends the text with the link that stops it, when the message carries one", async () => {
    const http = fakeFetch({ [SEND_TEXT]: () => json({ key: { id: "T1" } }) });
    const evolution = createEvolutionMessaging(settings, { fetch: http.fetch, log });
    await evolution.send({
      to: "+919810000001",
      template: "launch_alert_v1",
      params: ["Arjun", "Sector 65", "https://maneman.in/book"],
      stopLink: "https://maneman.in/stop#token",
    });
    const { text } = JSON.parse(http.calls[0]?.body ?? "{}") as { text: string };
    expect(text).toMatch(/^Hi Arjun, Mane Man now comes to Sector 65\./);
    expect(text).toMatch(/\n\nStop these messages: https:\/\/maneman\.in\/stop#token$/);
  });

  const sendImage = (evolution: MessagingProvider) =>
    evolution.send({
      to: "+919810000001",
      template: "tryon_result_v1",
      params: ["A", "https://maneman.in/book"],
      media: { url: "https://x.test/r.png", type: "image/png" },
    });

  it.each([
    [500, { error: { code: "INTERNAL_SERVER_ERROR" } }, true, "HTTP 500 INTERNAL_SERVER_ERROR"],
    [429, {}, true, "HTTP 429 "],
    [400, { error: "number 919810000001 does not exist" }, false, "HTTP 400 number ############ does not exist"],
  ])("classifies HTTP %i", async (status, body, transient, detail) => {
    const http = fakeFetch({ [SEND_MEDIA]: () => json(body, status) });
    const evolution = createEvolutionMessaging(settings, { fetch: http.fetch, log });
    expect(await sendImage(evolution)).toEqual({ ok: false, transient, detail });
  });

  it.each([
    [
      404,
      { status: 404, error: "Not Found", response: { message: ['The "mane man" instance does not exist'] } },
      'the bridge has no instance named "mane man": wrong URL or port, or the instance was deleted',
    ],
    [401, { error: { code: "UNAUTHORIZED" } }, "HTTP 401 UNAUTHORIZED"],
    [403, { error: "Forbidden" }, "HTTP 403 Forbidden"],
    [400, { error: "Connection Closed" }, "HTTP 400 Connection Closed"],
  ])("reads HTTP %i as the bridge being down, which is no fault of the message", async (status, body, detail) => {
    const http = fakeFetch({ [SEND_MEDIA]: () => json(body, status) });
    const evolution = createEvolutionMessaging(settings, { fetch: http.fetch, log });
    expect(await sendImage(evolution)).toEqual({ ok: false, transient: false, bridgeDown: true, detail });
  });

  it("treats an unreachable bridge as transient", async () => {
    const http = fakeFetch({
      [SEND_MEDIA]: () => {
        throw new TypeError("fetch failed");
      },
    });
    const evolution = createEvolutionMessaging(settings, { fetch: http.fetch, log });
    expect(
      await evolution.send({
        to: "+919810000001",
        template: "tryon_result_v1",
        params: ["A", "https://maneman.in/book"],
        media: { url: "https://x.test/r.png", type: "image/png" },
      }),
    ).toEqual({
      ok: false,
      transient: true,
      detail: "unreachable: TypeError",
    });
  });

  it("never retries a send that timed out, because it may already have been delivered", async () => {
    const http = fakeFetch({
      [SEND_MEDIA]: () => {
        throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
      },
    });
    const evolution = createEvolutionMessaging(settings, { fetch: http.fetch, log });
    expect(
      await evolution.send({
        to: "+919810000001",
        template: "tryon_result_v1",
        params: ["A", "https://maneman.in/book"],
        media: { url: "https://x.test/r.png", type: "image/png" },
      }),
    ).toEqual({
      ok: false,
      transient: false,
      detail: "no reply within 60 s: delivery unconfirmed",
    });
  });

  it("gives a text 20 s, so a login code sent after the response is answered inside its 30 s", async () => {
    expect(SEND_TIMEOUT_MS.sendText).toBeLessThanOrEqual(20_000);
    const http = fakeFetch({
      [SEND_TEXT]: () => {
        throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
      },
    });
    const evolution = createEvolutionMessaging(settings, { fetch: http.fetch, log });
    expect(await evolution.send({ to: "+919810000001", template: "login_code_v1", params: ["123456"] })).toEqual({
      ok: false,
      transient: false,
      detail: "no reply within 20 s: delivery unconfirmed",
    });
  });

  describe("the bridge's connection to WhatsApp", () => {
    const STATE = "https://bridge.example/instance/connectionState/mane%20man";

    it.each([
      [json({ instance: { instanceName: "mane man", state: "open" } }), { open: true }],
      [
        json({ instance: { instanceName: "mane man", state: "close" } }),
        { open: false, fault: "logged_out", detail: "state close" },
      ],
      [json({ state: "connecting" }), { open: false, fault: "logged_out", detail: "state connecting" }],
      [json({ error: "Unauthorized" }, 401), { open: false, fault: "key_refused", detail: "HTTP 401" }],
      [
        json({ status: 404, error: "Not Found" }, 404),
        {
          open: false,
          fault: "no_instance",
          detail: 'the bridge has no instance named "mane man": wrong URL or port, or the instance was deleted',
        },
      ],
      [json({}, 502), { open: false, fault: "unreachable", detail: "HTTP 502" }],
    ])("is read, never written, from its connection state", async (answer, connection) => {
      const http = fakeFetch({ [STATE]: () => answer });
      const evolution = createEvolutionMessaging(settings, { fetch: http.fetch, log });
      expect(await evolution.connection()).toEqual(connection);
      expect(http.calls.map((call) => [call.method, call.headers.get("apikey")])).toEqual([["GET", "evo-key"]]);
    });

    it("is not open when the bridge cannot be reached", async () => {
      const http = fakeFetch({
        [STATE]: () => {
          throw new TypeError("fetch failed");
        },
      });
      const evolution = createEvolutionMessaging(settings, { fetch: http.fetch, log });
      expect(await evolution.connection()).toEqual({
        open: false,
        fault: "unreachable",
        detail: "unreachable: TypeError",
      });
    });
  });
});
